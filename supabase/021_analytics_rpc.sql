-- ============================================================
-- 021 — Analytics RPC
--
-- get_clinic_analytics(p_months INT DEFAULT 12) → JSONB
--
-- Replaces the five raw-row queries in useAnalytics.ts with a
-- single server-side aggregation. Benefits:
--   • One round-trip instead of five.
--   • PostgreSQL GROUP BY is orders of magnitude faster than
--     client-side .filter()/.reduce() over thousands of rows.
--   • generate_series fills zero-value months so the charts
--     never show missing buckets.
--
-- Returns JSONB:
--   revenue_by_month       — [{month, revenue, invoiced}]     (YYYY-MM-01)
--   appointments_by_month  — [{month, total, completed, cancelled}]
--   patients_by_month      — [{month, new}]
--   appt_status_breakdown  — [{name, value, fill}]  (zeroes excluded)
--   lab_status_breakdown   — [{name, value, fill}]  (zeroes excluded)
--   kpis                   — scalar KPIs object (camelCase keys)
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_clinic_analytics(p_months INT DEFAULT 12)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_clinic_id UUID;
  v_start     TIMESTAMPTZ;
BEGIN
  v_clinic_id := public.get_clinic_id();
  IF v_clinic_id IS NULL THEN
    RAISE EXCEPTION 'Accès refusé : clinique introuvable'
      USING ERRCODE = '42501';
  END IF;

  -- Start of the earliest month in the range.
  -- For p_months=12: the 1st of the month 11 months before today,
  -- so the result always contains exactly 12 calendar months.
  v_start := date_trunc('month', NOW() - ((p_months - 1) * INTERVAL '1 month'));

  RETURN (
    WITH
    -- ── Month spine ──────────────────────────────────────────
    month_series AS (
      SELECT generate_series(
        v_start,
        date_trunc('month', NOW()),
        INTERVAL '1 month'
      ) AS m
    ),

    -- ── Invoice aggregates ────────────────────────────────────
    inv_monthly AS (
      SELECT
        date_trunc('month', created_at)                           AS m,
        SUM(total_amount) FILTER (WHERE status = 'paid')          AS revenue,
        SUM(total_amount)                                          AS invoiced
      FROM invoices
      WHERE clinic_id = v_clinic_id AND created_at >= v_start
      GROUP BY 1
    ),
    inv_kpis AS (
      SELECT
        COALESCE(SUM(total_amount) FILTER (WHERE status = 'paid'), 0) AS total_revenue,
        COALESCE(SUM(total_amount),                                 0) AS total_invoiced
      FROM invoices
      WHERE clinic_id = v_clinic_id AND created_at >= v_start
    ),

    -- ── Appointment aggregates ────────────────────────────────
    appt_monthly AS (
      SELECT
        date_trunc('month', created_at)                        AS m,
        COUNT(*)                                               AS total,
        COUNT(*) FILTER (WHERE status = 'completed')           AS completed,
        COUNT(*) FILTER (WHERE status = 'cancelled')           AS cancelled
      FROM appointments
      WHERE clinic_id = v_clinic_id AND created_at >= v_start
      GROUP BY 1
    ),
    appt_kpis AS (
      SELECT
        COUNT(*)                                                          AS total,
        COUNT(*) FILTER (WHERE status = 'completed')                      AS completed,
        COUNT(*) FILTER (WHERE status = 'cancelled')                      AS cancelled,
        COUNT(*) FILTER (WHERE status = 'no_show')                        AS no_show,
        COUNT(*) FILTER (WHERE status = 'scheduled')                      AS scheduled,
        COUNT(*) FILTER (WHERE status IN (
          'in_queue','in_progress','waiting','called','in_consultation'))  AS active
      FROM appointments
      WHERE clinic_id = v_clinic_id AND created_at >= v_start
    ),

    -- ── Patient aggregates ────────────────────────────────────
    pat_monthly AS (
      SELECT
        date_trunc('month', created_at) AS m,
        COUNT(*)                        AS new_patients
      FROM patients
      WHERE clinic_id = v_clinic_id AND created_at >= v_start
      GROUP BY 1
    ),
    pat_kpis AS (
      SELECT COUNT(*) AS new_patients
      FROM patients
      WHERE clinic_id = v_clinic_id AND created_at >= v_start
    ),

    -- ── Lab & consultation counts ─────────────────────────────
    lab_kpis AS (
      SELECT
        COUNT(*) FILTER (WHERE status = 'ordered')    AS ordered,
        COUNT(*) FILTER (WHERE status = 'collected')  AS collected,
        COUNT(*) FILTER (WHERE status = 'processing') AS processing,
        COUNT(*) FILTER (WHERE status = 'resulted')   AS resulted,
        COUNT(*) FILTER (WHERE status = 'cancelled')  AS cancelled,
        COUNT(*)                                       AS total
      FROM lab_requests
      WHERE clinic_id = v_clinic_id AND created_at >= v_start
    ),
    consult_kpis AS (
      SELECT COUNT(*) AS total
      FROM consultations
      WHERE clinic_id = v_clinic_id AND created_at >= v_start
    )

    -- ── Final assembly ────────────────────────────────────────
    SELECT jsonb_build_object(

      'revenue_by_month', (
        SELECT COALESCE(jsonb_agg(
          jsonb_build_object(
            'month',    to_char(ms.m, 'YYYY-MM-01'),
            'revenue',  COALESCE(im.revenue,  0),
            'invoiced', COALESCE(im.invoiced, 0)
          ) ORDER BY ms.m
        ), '[]'::jsonb)
        FROM month_series ms
        LEFT JOIN inv_monthly im ON ms.m = im.m
      ),

      'appointments_by_month', (
        SELECT COALESCE(jsonb_agg(
          jsonb_build_object(
            'month',     to_char(ms.m, 'YYYY-MM-01'),
            'total',     COALESCE(am.total,     0),
            'completed', COALESCE(am.completed, 0),
            'cancelled', COALESCE(am.cancelled, 0)
          ) ORDER BY ms.m
        ), '[]'::jsonb)
        FROM month_series ms
        LEFT JOIN appt_monthly am ON ms.m = am.m
      ),

      'patients_by_month', (
        SELECT COALESCE(jsonb_agg(
          jsonb_build_object(
            'month', to_char(ms.m, 'YYYY-MM-01'),
            'new',   COALESCE(pm.new_patients, 0)
          ) ORDER BY ms.m
        ), '[]'::jsonb)
        FROM month_series ms
        LEFT JOIN pat_monthly pm ON ms.m = pm.m
      ),

      'appt_status_breakdown', (
        SELECT COALESCE(
          jsonb_agg(item) FILTER (WHERE (item->>'value')::INT > 0),
          '[]'::jsonb
        )
        FROM (
          SELECT jsonb_build_object('name','Terminé',  'value', completed, 'fill','#10b981') AS item FROM appt_kpis
          UNION ALL
          SELECT jsonb_build_object('name','Annulé',   'value', cancelled, 'fill','#ef4444') FROM appt_kpis
          UNION ALL
          SELECT jsonb_build_object('name','Absent',   'value', no_show,   'fill','#f59e0b') FROM appt_kpis
          UNION ALL
          SELECT jsonb_build_object('name','Planifié', 'value', scheduled, 'fill','#3b82f6') FROM appt_kpis
          UNION ALL
          SELECT jsonb_build_object('name','En cours', 'value', active,    'fill','#8b5cf6') FROM appt_kpis
        ) s
      ),

      'lab_status_breakdown', (
        SELECT COALESCE(
          jsonb_agg(item) FILTER (WHERE (item->>'value')::INT > 0),
          '[]'::jsonb
        )
        FROM (
          SELECT jsonb_build_object('name','Demandé',  'value', ordered,    'fill','#3b82f6') AS item FROM lab_kpis
          UNION ALL
          SELECT jsonb_build_object('name','Prélevé',  'value', collected,  'fill','#8b5cf6') FROM lab_kpis
          UNION ALL
          SELECT jsonb_build_object('name','En cours', 'value', processing, 'fill','#f59e0b') FROM lab_kpis
          UNION ALL
          SELECT jsonb_build_object('name','Résulté',  'value', resulted,   'fill','#10b981') FROM lab_kpis
          UNION ALL
          SELECT jsonb_build_object('name','Annulé',   'value', cancelled,  'fill','#ef4444') FROM lab_kpis
        ) s
      ),

      'kpis', (
        SELECT jsonb_build_object(
          'totalRevenue',          ik.total_revenue,
          'totalInvoiced',         ik.total_invoiced,
          'totalAppointments',     ak.total,
          'completedAppointments', ak.completed,
          'newPatients',           pk.new_patients,
          'totalConsultations',    ck.total,
          'totalLabs',             lk.total,
          'completionRate', CASE
            WHEN ak.total > 0
            THEN ROUND(ak.completed * 100.0 / ak.total)
            ELSE 0
          END,
          'collectionRate', CASE
            WHEN ik.total_invoiced > 0
            THEN ROUND(ik.total_revenue * 100.0 / ik.total_invoiced)
            ELSE 0
          END
        )
        FROM inv_kpis ik, appt_kpis ak, pat_kpis pk, consult_kpis ck, lab_kpis lk
      )

    ) -- end jsonb_build_object
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_clinic_analytics(INT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_clinic_analytics(INT) TO authenticated;

NOTIFY pgrst, 'reload schema';
