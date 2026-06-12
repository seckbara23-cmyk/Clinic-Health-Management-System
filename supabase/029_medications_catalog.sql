-- ════════════════════════════════════════════════════════════════
-- 029 — Medications catalog (seed import)
-- ════════════════════════════════════════════════════════════════
--
-- Seeds the initial medication catalog from "BASE DE DONNEES MEDICAMENTS".
-- This is a GLOBAL reference formulary (no clinic_id): the shared list of
-- products a Senegal clinic pharmacy stocks. Per-clinic INVENTORY (stock,
-- per-clinic price) is intentionally OUT OF SCOPE here and will reference
-- medication_id in a separate table later — NO stock data is stored now.
--
-- Columns populated from the source list:
--   name         — the product designation (kept verbatim, canonical label)
--   strength     — parsed from the name when present (e.g. "10 mg", "2%")
--   dosage_form  — parsed from the name when recognizable (CP→Comprimé, …)
--   is_active    — true for every seeded row
--
-- The source mixes drugs with consumables/devices (gloves, syringes, …); the
-- whole list is seeded faithfully. Non-drug rows simply get NULL strength/form
-- and can be deactivated via is_active if a clinic wishes.
--
-- RLS: any authenticated clinic user may read the formulary (no PII, no
-- clinic scope); only super_admin may modify it. The seed below runs as the
-- migration executor (bypasses RLS). Re-runnable: ON CONFLICT (name) DO NOTHING.

-- ── Table ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.medications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  strength    TEXT,
  dosage_form TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_medications_active ON public.medications(is_active);
-- Case-insensitive name search for the prescription picker (future).
CREATE INDEX IF NOT EXISTS idx_medications_name_lower ON public.medications(lower(name));

CREATE OR REPLACE TRIGGER trg_medications_updated_at
  BEFORE UPDATE ON public.medications FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── RLS ───────────────────────────────────────────────────────────
ALTER TABLE public.medications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "medications_select" ON public.medications;
CREATE POLICY "medications_select" ON public.medications FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "medications_write" ON public.medications;
CREATE POLICY "medications_write" ON public.medications FOR ALL
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- ── Seed ──────────────────────────────────────────────────────────
INSERT INTO public.medications (name) VALUES
  ('MORPHINE 10 mg INJ'),
  ('TENSOCOLD SPRAY'),
  ('CIMETIDINE CP 400 mg CP'),
  ('GENTAMYCINE 80 mg INJ'),
  ('PAREGORIQUE CP'),
  ('RINOGRIP SACHETS'),
  ('FEBRILEX CP'),
  ('RINOMYCINE SACHET'),
  ('ATARAX 25MG CP'),
  ('INDOMETACINE 25mg CP'),
  ('RESTRIVA INJ'),
  ('BLOUSE BLANCHE'),
  ('CANTINE POUR MEDICAMENT'),
  ('INSECTICIDE POUR PULVERISATEUR'),
  ('MASQUE N95'),
  ('SAC A DOS D''URGENCE'),
  ('ANIOS (DECONTAMINANT)'),
  ('STETHOSCOPE LITMAN'),
  ('PROPHYLAXIE POST EXPOSITION (VIH)'),
  ('BRICANYL AEROSOL'),
  ('SOLUMEDROL 125mg INJ'),
  ('BENZOATE DE BENZYLE'),
  ('EPINEPHRINE OU ADRENALINE 1 mg INJ'),
  ('DOBUTAMINE 250 mg/20 ml INJ'),
  ('DOPAMINE INJ'),
  ('KETAMINE INJ'),
  ('FENTANYL AMP 500 GAMMA INJ'),
  ('RISORDAN 20 mg CP'),
  ('MECLON OVULES'),
  ('IMAZOLE OVULE'),
  ('NYSTATINE GYNECO CP'),
  ('BETADINE SCRUB'),
  ('CHARIOT DE SOINS'),
  ('TAMBOUR'),
  ('COTON CARDE'),
  ('ETHER 500 ml'),
  ('LARGACTIL 25 mg INJ'),
  ('LYSANXIA 100mg CP'),
  ('BACTYL COLLYRE'),
  ('CETHEXONIUM COLLYRE'),
  ('TETRACYCLINE POM OPHT'),
  ('GELUSIL CP 120mg/250mg CP'),
  ('CHLORURE DE MAGNESIUM 1g INJ'),
  ('CHLORURE DE SODIUM 1g INJ'),
  ('DYNAMOGEN AMP'),
  ('JUVAMINE CP'),
  ('VICOMBIL CP'),
  ('VITAMINE C 500mg INJ'),
  ('BIOFAR PLUS'),
  ('POLYVITA M'),
  ('AQUATABS'),
  ('INSULINE RAPIDE INJ'),
  ('VITAGEN INJ'),
  ('AZITHROMYCINE 500 mg CP'),
  ('MIOREL INJ'),
  ('TEMESTA 2,5mg CP'),
  ('SALBUTAMOL SPRAY'),
  ('SPASFON 40 mg/4ml INJ'),
  ('ACILOC INJ'),
  ('ISOLONE 20mg CP'),
  ('DARCYOSERUM'),
  ('DRENOXOL AMP'),
  ('XYLOCAINE 2%'),
  ('VOLINI GEL'),
  ('LASILIX 20mg INJ'),
  ('DAFLON 1000mg CP'),
  ('ANGIOSPRAY'),
  ('MALARIA TEST'),
  ('BAUME BALM'),
  ('LOVENOX 0,4 INJ'),
  ('R LUME 80/480 CP / ARTRIM GH'),
  ('BECOZYME 1 g INJ'),
  ('ULZOCER INJ'),
  ('AMOX-AC CLAV 1g/125 INJ'),
  ('ANOMEX SUPPOSITOIRE'),
  ('CYCLO 3 FORT'),
  ('NAAXIA COLLYRE'),
  ('LOCAPRED 0,1% CREME'),
  ('DRENOXOL SP'),
  ('GYNO MYCOLEX OVULE'),
  ('ACCU-CHECK BANDELETTES'),
  ('SERUM ANTI TETANIQUE'),
  ('MIGRETIL CP'),
  ('DOLEX COLLYRE'),
  ('FUMAFER CP'),
  ('RENERVE P'),
  ('CEFAMOR 500 mg CP'),
  ('DYNAPAR 50 mg INJ'),
  ('ATROPINE 0,25 mg INJ'),
  ('DEBRIDAT 100mg CP'),
  ('DESIREL SIROP'),
  ('CEFTRIAXONE 1g INJ'),
  ('METRONIDAZOL 500 mg PERF'),
  ('CODOLIPRANE (400mg/20mg) CP'),
  ('PARACETAMOL 1g PERF'),
  ('SOLUMEDROL 40mg INJ'),
  ('PRINCI B-FORT'),
  ('ADNA bain de bouche'),
  ('BRULEX POMMADE'),
  ('DAKIN SOLUTION'),
  ('AMOX-AC CLAV (1g/125) CP'),
  ('AMOXICILLINE 500mg GELULE'),
  ('FLUCITHALMIC POMMADE'),
  ('SUPRADYN EFF CP'),
  ('TERPINE CODEINE CP'),
  ('BETADINE DERMIQUE GM'),
  ('MOUSTIDOSE'),
  ('FLUCLOXACILLINE 500 mg CP'),
  ('DESLORATADINE 10mg CP'),
  ('GENSET 10mg CP'),
  ('PRIMALAN 10mg CP'),
  ('DICACILLINE INJ'),
  ('COTRIMOXAZOLE 500 mg CP'),
  ('OFLOXACINE 200 mg CP'),
  ('DOLEX 75mg LP CP'),
  ('DOLEX 50mg CP'),
  ('DOLEX 75 mg INJ'),
  ('VIT K1 INJ'),
  ('RENNIE'),
  ('SERUM GLUCOSE 30% AMP 10 ml'),
  ('CEFOTAXIME 1g INJ'),
  ('CIPROFLOXACINE 500 mg PERF'),
  ('IBUPROFENE 400mg CP'),
  ('RAMITHIAZIDE 5/25'),
  ('LOXEN 10 mg INJ'),
  ('GRIPEX SACHETS'),
  ('LITACOLD CP'),
  ('DUPHALAC SACHET'),
  ('CERULYSE'),
  ('GENTAMYCINE COLLYRE'),
  ('FUCIDINE 2% POMMADE'),
  ('ROIVIT C 1000 mg CP'),
  ('OMEPRAZOLE 20mg CP'),
  ('SERUM GLUCOSE 5%'),
  ('PARACETAMOL 500 mg CP'),
  ('TRAMAGEN CP'),
  ('FELDENE 20mg CP'),
  ('KINAL 500MG CP'),
  ('XYLO MEPHA SPRAY NASAL'),
  ('ECOREX SPRAY'),
  ('SERUM ANTI VENIMEUX'),
  ('CIPROFLOXACINE 750mg CP'),
  ('ALBENDAZOLE 400 mg CP'),
  ('NOSINAN 25mg CP'),
  ('MYCOSTER POUDRE'),
  ('ACUPAN 20 mg INJ'),
  ('MOTILLIUM'),
  ('VOGALENE INJ'),
  ('LARGACTIL 100 mg CP'),
  ('EOSINE DERMIQUE 500 ml'),
  ('METRONIDAZOL 500 mg CP'),
  ('HYDRXYCHOLOQUINE 200mg CP'),
  ('SALBUTAMOL 0,25 mg INJ'),
  ('SEDORRHEINE CREME'),
  ('OTIPAX GOUTTES'),
  ('DIPROSONE 0,05% POMMADE'),
  ('MIOREL 4 mg CP'),
  ('SERUM GLUCOSE 10%'),
  ('IMMARD'),
  ('DOXYCYCLINE 100mg CP'),
  ('CLARYTHROMYCINE 500mg CP'),
  ('FLUGEN 100 mg CP'),
  ('ARTEGEN INJ'),
  ('SALBUTAMOL ARROW NEBULISATION'),
  ('ZINC CP'),
  ('VOLTARENE EMUGEL'),
  ('LASILIX 40mg CP'),
  ('GRISEOFULVINE 500 mg CP'),
  ('GLUCOPHAGE 1000 mg CP'),
  ('DICYNONE CP'),
  ('BANEOCIN POMMADE'),
  ('GEL ANTISEPTIQUE (LAVE-MAIN)'),
  ('AMPICILLINE 1g INJ'),
  ('LOFNAC GEL'),
  ('ALPRAZ 0,4 mg CP'),
  ('SMECTA SACHETS'),
  ('SERUM SALE ISOTONIQUE 0,9%'),
  ('TEST DE GROSSESSE'),
  ('AUREOMYCINE 3% POMMADE'),
  ('VASELINE OFFICINALE'),
  ('GASTROGEL CP'),
  ('VISCODRIL SP'),
  ('MELEX CP'),
  ('CYTEAL SOLUTION'),
  ('AMLODIPINE 10 mg CP'),
  ('MEGAMILASE CP'),
  ('BONCIPRO AURICULAIRE'),
  ('PRESERVATIFS MASCULIN'),
  ('ECOREX POMMADE'),
  ('MEBENDAZOLE 100mg CP'),
  ('ACCU-CHECK LANCETTES'),
  ('POCHE POUR SONDE URINAIRE'),
  ('AUREOMYCINE 1% POMMADE'),
  ('VENOSMIL CP'),
  ('EUCARBON CP'),
  ('ISONE 20mg CP'),
  ('CHLORURE DE POTASSIUM 1g INJ'),
  ('DICYNONE INJ'),
  ('DISTEM'),
  ('DISLEP 25 mg INJ'),
  ('DISLEP CP'),
  ('ASCABIOL'),
  ('LEXOMIL'),
  ('IMODIUM CP'),
  ('PHENARGAN 25 mg CP'),
  ('SPASFON 80 mg CP'),
  ('TRAMADOL INJ'),
  ('PREDNISOLONE 20mg CP'),
  ('PALUJECT 0,4g INJ'),
  ('VALIUM INJ'),
  ('HALDOL'),
  ('GARDENAL 100mg CP'),
  ('OFLOXACINE GOUTTE AURICULLAIRE'),
  ('COLTRAMYL 4mg CP'),
  ('ALLOPURINOL 200 mg CP'),
  ('ABAISSE LANGUE'),
  ('ELASTOPLAST 10X5'),
  ('GENOULLIERE'),
  ('ATELLE CHEVILLE'),
  ('ATELLE POIGNET'),
  ('GANTS D''EXAMEN'),
  ('GANTS STERILES'),
  ('BANDE DE GAZE (GM)'),
  ('BANDE VELPEAU'),
  ('COMPRESSE STERILE 40X40'),
  ('BOITE INSTRUMENT COMPLET'),
  ('BOITE A AIGUILLE'),
  ('COTON HYDROPHILE'),
  ('EAU OXYGENEE'),
  ('FIL DE SUTURE 10/25'),
  ('ALCOOL 70° 500 ml'),
  ('LAME DE BISTOURI 21'),
  ('TULLE GRAS'),
  ('SPARADRAP 18cmX5'),
  ('GELOFUSINE 4%'),
  ('RINGER LACTATE'),
  ('CATHETER G18'),
  ('CATHETER G20'),
  ('CATHETER G22'),
  ('PERFUSEUR'),
  ('BANDELETTES URINAIRES'),
  ('POIRE'),
  ('LUNETTE A OXYGENE'),
  ('MASQUE CHIRURGICAL'),
  ('MASQUE OXYGENE A HAUTE CONCENTRATION'),
  ('MOUSTIQUAIRE IMPREGNE'),
  ('SERINGUE A INSULINE'),
  ('SERINGUE 60 CC'),
  ('SERINGUE 10CC'),
  ('SERINGUE 5CC'),
  ('SACHET PHARMACIE'),
  ('PESE PERSONNE (SECA)'),
  ('THERMOFLASH'),
  ('SONDE NASOGASTRIQUE'),
  ('HUILE DE CAMPHRE'),
  ('HUILE DE PARAFFINE')
ON CONFLICT (name) DO NOTHING;

-- ── Parse dosage_form from the name (best effort; NULL when ambiguous) ──
UPDATE public.medications SET dosage_form = CASE
  WHEN name ~* 'NEBULISATION'                              THEN 'Nébulisation'
  WHEN name ~* 'AEROSOL'                                   THEN 'Aérosol'
  WHEN name ~* 'SPRAY'                                     THEN 'Spray'
  WHEN name ~* 'COLLYRE'                                   THEN 'Collyre'
  WHEN name ~* 'POM OPHT'                                  THEN 'Pommade ophtalmique'
  WHEN name ~* 'POMMADE'                                   THEN 'Pommade'
  WHEN name ~* 'CREME'                                     THEN 'Crème'
  WHEN name ~* 'EMUGEL|(^|[[:space:]])GEL([[:space:]]|$)'  THEN 'Gel'
  WHEN name ~* 'SUPPOSITOIRE'                              THEN 'Suppositoire'
  WHEN name ~* 'OVULE'                                     THEN 'Ovule'
  WHEN name ~* 'SACHET'                                    THEN 'Sachet'
  WHEN name ~* 'GELULE'                                    THEN 'Gélule'
  WHEN name ~* '(^|[[:space:]])PERF([[:space:]]|$)'        THEN 'Perfusion'
  WHEN name ~* '(^|[[:space:]])CP([[:space:]]|$)'          THEN 'Comprimé'
  WHEN name ~* '(^|[[:space:]])INJl?([[:space:]]|$)'       THEN 'Injectable'
  WHEN name ~* '(^|[[:space:]])AMP([[:space:]]|$)'         THEN 'Ampoule'
  WHEN name ~* 'GOUTTE'                                    THEN 'Gouttes'
  WHEN name ~* 'AURICULAIRE'                               THEN 'Solution auriculaire'
  WHEN name ~* 'POUDRE'                                    THEN 'Poudre'
  WHEN name ~* '(^|[[:space:]])SP([[:space:]]|$)|SIROP'    THEN 'Sirop'
  WHEN name ~* 'BAIN DE BOUCHE'                            THEN 'Bain de bouche'
  WHEN name ~* 'SOLUTION'                                  THEN 'Solution'
  ELSE dosage_form
END
WHERE dosage_form IS NULL;

-- ── Parse strength from the name (number + mg/g/ml/%, optional ratio) ──
UPDATE public.medications
SET strength = substring(
  name from '(?i)([0-9]+([.,][0-9]+)?[[:space:]]*(mg|g|ml|%)([[:space:]]*/[[:space:]]*[0-9]+([.,][0-9]+)?[[:space:]]*(mg|g|ml)?)?)'
)
WHERE strength IS NULL;

NOTIFY pgrst, 'reload schema';
