-- ============================================================
-- SEED DATA for development
-- ============================================================

-- Demo clinics
INSERT INTO clinics (id, name, location, phone, email, subscription_plan) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Clinique Sainte Marie', 'Dakar, Plateau', '+221 33 821 0000', 'contact@saintmarie.sn', 'pro'),
  ('22222222-2222-2222-2222-222222222222', 'Polyclinique du Sahel', 'Dakar, Almadies', '+221 33 869 0000', 'info@sahel.sn', 'basic')
ON CONFLICT DO NOTHING;
