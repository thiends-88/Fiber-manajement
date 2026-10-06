-- OLT
CREATE TABLE public.olts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  location TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.olts TO anon, authenticated;
GRANT ALL ON public.olts TO service_role;
ALTER TABLE public.olts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public access olts" ON public.olts FOR ALL USING (true) WITH CHECK (true);

-- ODC
CREATE TABLE public.odcs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  olt_id UUID NOT NULL REFERENCES public.olts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  location TEXT,
  cable_type TEXT NOT NULL CHECK (cable_type IN ('48_core_2_tube', '24_core_2_tube', '12_core_2_tube', 'figure8_12_core', 'figure8_6_core', '48_core_4_tube', '24_core_4_tube')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.odcs TO anon, authenticated;
GRANT ALL ON public.odcs TO service_role;
ALTER TABLE public.odcs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public access odcs" ON public.odcs FOR ALL USING (true) WITH CHECK (true);

-- ODP
CREATE TABLE public.odps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  odc_id UUID NOT NULL REFERENCES public.odcs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  location TEXT,
  cable_type TEXT NOT NULL CHECK (cable_type IN ('48_core_2_tube', '24_core_2_tube', '12_core_2_tube', 'figure8_12_core', 'figure8_6_core', '48_core_4_tube', '24_core_4_tube')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.odps TO anon, authenticated;
GRANT ALL ON public.odps TO service_role;
ALTER TABLE public.odps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public access odps" ON public.odps FOR ALL USING (true) WITH CHECK (true);

-- Core assignments (untuk kabel OLT->ODC atau ODC->ODP)
CREATE TABLE public.core_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL CHECK (source IN ('olt_to_odc', 'odc_to_odp')),
  odc_id UUID REFERENCES public.odcs(id) ON DELETE CASCADE,
  odp_id UUID REFERENCES public.odps(id) ON DELETE CASCADE,
  core_number INT NOT NULL CHECK (core_number BETWEEN 1 AND 48),
  color TEXT NOT NULL,
  tube_number INT,
  status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'used', 'reserved', 'damaged')),
  customer TEXT,
  destination TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_target CHECK (
    (source = 'olt_to_odc' AND odc_id IS NOT NULL AND odp_id IS NULL) OR
    (source = 'odc_to_odp' AND odp_id IS NOT NULL)
  )
);
CREATE UNIQUE INDEX uniq_core_olt_odc ON public.core_assignments (odc_id, core_number) WHERE source = 'olt_to_odc';
CREATE UNIQUE INDEX uniq_core_odc_odp ON public.core_assignments (odp_id, core_number) WHERE source = 'odc_to_odp';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.core_assignments TO anon, authenticated;
GRANT ALL ON public.core_assignments TO service_role;
ALTER TABLE public.core_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public access cores" ON public.core_assignments FOR ALL USING (true) WITH CHECK (true);

-- Updated-at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$BEGIN NEW.updated_at = now(); RETURN NEW; END;$$;

CREATE TRIGGER trg_olts_upd BEFORE UPDATE ON public.olts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_odcs_upd BEFORE UPDATE ON public.odcs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_odps_upd BEFORE UPDATE ON public.odps FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_cores_upd BEFORE UPDATE ON public.core_assignments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
