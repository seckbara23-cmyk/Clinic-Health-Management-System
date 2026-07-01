#!/usr/bin/env python3
"""
Build the LNMPE 2025 medication catalog migration + validation report from the
manually-OCR'd rows in lnmpe_rows.json.

Read-only source → generates:
  - supabase/032_lnmpe_2025_medication_catalog.sql   (safe, additive, upsert)
  - a validation report (printed; also written to lnmpe_report.txt)

Design (matches medications schema from 029: name TEXT UNIQUE, strength,
dosage_form, is_active):
  - Each product's UNIQUE `name` is the composed canonical label
    "DCI strength form" (the same DCI recurs at different strengths/forms).
  - New ADDITIVE columns: source, therapeutic_class, normalized_name.
  - Dedup on normalized_name = fold(DCI | strength | form).
  - ON CONFLICT (name) DO UPDATE → preserves existing IDs, idempotent.
  - NEVER touches clinic_medication_inventory or medication_batches.
  - Rows with neither strength nor form are treated as non-medications
    (devices/consumables) and SKIPPED (counted), keeping this a drug catalog.
"""
import json, os, re, unicodedata, sys

import glob

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
ROWS_DIR = os.path.join(HERE, "rows")
META = os.path.join(HERE, "meta.json")
MIGRATION = os.path.join(ROOT, "supabase", "032_lnmpe_2025_medication_catalog.sql")
REPORT = os.path.join(HERE, "lnmpe_report.txt")
SOURCE_TAG = "LNMPE 2025"


def load_rows():
    rows = []
    for path in sorted(glob.glob(os.path.join(ROWS_DIR, "*.json"))):
        with open(path, encoding="utf-8") as f:
            rows.extend(json.load(f).get("rows", []))
    return rows


def collapse(s):
    return re.sub(r"\s+", " ", (s or "").strip())


def fold(s):
    """Accent-fold + lowercase + strip spaces — for the dedup key only."""
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"\s+", "", s.lower())


def compose_name(dci, strength, form):
    parts = [collapse(dci)]
    if strength:
        parts.append(collapse(strength))
    if form:
        parts.append(collapse(form))
    return " ".join(parts)


def sql_str(v):
    if v is None or v == "":
        return "NULL"
    return "'" + str(v).replace("'", "''") + "'"


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    with open(META, encoding="utf-8") as f:
        data = json.load(f)
    rows = load_rows()
    document_total = int(data.get("document_total") or 0)

    total = len(rows)
    uncertain = [r for r in rows if r.get("uncertain")]
    skipped = []      # non-medications (no strength AND no form)
    seen = {}         # normalized_name -> kept row
    duplicates = []
    catalog = []      # final unique medication rows

    for r in rows:
        dci = collapse(r.get("dci"))
        strength = collapse(r.get("strength")) or None
        form = collapse(r.get("form")) or None
        if not dci:
            skipped.append((r, "no DCI"))
            continue
        if not strength and not form:
            skipped.append((r, "non-medication (no strength/form)"))
            continue
        norm = fold(f"{dci}|{strength or ''}|{form or ''}")
        if norm in seen:
            duplicates.append(r)
            continue
        seen[norm] = r
        catalog.append({
            "name": compose_name(dci, strength, form),
            "strength": strength,
            "dosage_form": form,
            "therapeutic_class": collapse(r.get("class")) or None,
            "reference": collapse(r.get("reference")) or None,
            "normalized_name": norm,
        })

    # ── migration ────────────────────────────────────────────────
    lines = []
    lines.append("-- ════════════════════════════════════════════════════════════════")
    lines.append("-- 032 — LNMPE 2025 national medication catalog (global medications)")
    lines.append("-- ════════════════════════════════════════════════════════════════")
    lines.append("--")
    lines.append("-- Source: public/files/LNMPE-2025.pdf (scanned; manually OCR'd).")
    lines.append("-- GLOBAL medications table only. Does NOT touch clinic_medication_inventory")
    lines.append("-- or medication_batches; stores NO stock quantities. Additive + idempotent.")
    lines.append("--")
    lines.append(f"-- Rows extracted: {total} | medications upserted: {len(catalog)}"
                 f" | skipped(non-med): {len(skipped)} | duplicates: {len(duplicates)}"
                 f" | uncertain OCR: {len(uncertain)}")
    lines.append("")
    lines.append("-- ── Additive metadata columns (safe if already present) ──────────")
    lines.append("ALTER TABLE public.medications ADD COLUMN IF NOT EXISTS source            TEXT;")
    lines.append("ALTER TABLE public.medications ADD COLUMN IF NOT EXISTS therapeutic_class TEXT;")
    lines.append("ALTER TABLE public.medications ADD COLUMN IF NOT EXISTS normalized_name   TEXT;")
    lines.append("CREATE INDEX IF NOT EXISTS idx_medications_source ON public.medications(source);")
    lines.append("-- Enforce LNMPE dedup on the normalized key WITHOUT affecting other sources.")
    lines.append("CREATE UNIQUE INDEX IF NOT EXISTS uq_medications_lnmpe_norm")
    lines.append("  ON public.medications(normalized_name) WHERE source = 'LNMPE 2025';")
    lines.append("")
    lines.append("-- ── Upsert catalog (name is UNIQUE → ON CONFLICT preserves the id) ─")
    lines.append("INSERT INTO public.medications (name, strength, dosage_form, therapeutic_class, source, normalized_name, is_active) VALUES")
    values = []
    for c in catalog:
        values.append(
            f"  ({sql_str(c['name'])}, {sql_str(c['strength'])}, {sql_str(c['dosage_form'])}, "
            f"{sql_str(c['therapeutic_class'])}, {sql_str(SOURCE_TAG)}, {sql_str(c['normalized_name'])}, TRUE)"
        )
    lines.append(",\n".join(values))
    lines.append("ON CONFLICT (name) DO UPDATE SET")
    lines.append("  strength          = EXCLUDED.strength,")
    lines.append("  dosage_form       = EXCLUDED.dosage_form,")
    lines.append("  therapeutic_class = EXCLUDED.therapeutic_class,")
    lines.append("  source            = EXCLUDED.source,")
    lines.append("  normalized_name   = EXCLUDED.normalized_name,")
    lines.append("  is_active         = TRUE,")
    lines.append("  updated_at        = NOW();")
    lines.append("")
    lines.append("NOTIFY pgrst, 'reload schema';")
    lines.append("")

    with open(MIGRATION, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines))

    # ── report ───────────────────────────────────────────────────
    excluded_devices = max(0, document_total - total) if document_total else None
    rep = []
    rep.append("LNMPE 2025 — extraction & catalog validation report")
    rep.append("=" * 52)
    rep.append(f"Source PDF                         : {data.get('pdf')}")
    rep.append(f"Total items in LNMPE (highest N°)  : {document_total}")
    rep.append(f"Medication rows transcribed (OCR'd): {total}")
    rep.append(f"  → unique medications UPSERTED    : {len(catalog)}")
    rep.append(f"  → duplicate rows collapsed       : {len(duplicates)}")
    rep.append(f"  → uncertain OCR rows             : {len(uncertain)}")
    if skipped:
        rep.append(f"  → skipped (no strength/form)     : {len(skipped)}")
    if excluded_devices is not None:
        rep.append(f"Non-medication rows excluded (devices/consumables): {excluded_devices}")
    rep.append("")
    if uncertain:
        rep.append("Uncertain OCR rows (corrected to the standard DCI/brand):")
        for r in uncertain:
            rep.append(f"  - #{r.get('n')} {r.get('dci')} {r.get('strength','')} — {r.get('note','')}")
        rep.append("")
    if duplicates:
        rep.append("Duplicates dropped:")
        for r in duplicates:
            rep.append(f"  - #{r.get('n')} {r.get('dci')} {r.get('strength','')} {r.get('form','')}")
        rep.append("")
    if skipped:
        rep.append("Skipped rows:")
        for r, why in skipped:
            rep.append(f"  - #{r.get('n')} {r.get('dci','?')} — {why}")
        rep.append("")
    rep.append(f"Migration written: supabase/032_lnmpe_2025_medication_catalog.sql")
    text = "\n".join(rep)
    with open(REPORT, "w", encoding="utf-8", newline="\n") as f:
        f.write(text + "\n")
    print(text)


if __name__ == "__main__":
    main()
