CREATE TABLE public.odc_power_sources (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  odc_id UUID NOT NULL REFERENCES public.odcs(id) ON DELETE CASCADE,
  port_id UUID NOT NULL REFERENCES public.olt_ports(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (odc_id, port_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.odc_power_sources TO authenticated;
GRANT ALL ON public.odc_power_sources TO service_role;

ALTER TABLE public.odc_power_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view odc power sources"
  ON public.odc_power_sources FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Admins can insert odc power sources"
  ON public.odc_power_sources FOR INSERT
  TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update odc power sources"
  ON public.odc_power_sources FOR UPDATE
  TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete odc power sources"
  ON public.odc_power_sources FOR DELETE
  TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_odc_power_sources_odc ON public.odc_power_sources(odc_id);
CREATE INDEX idx_odc_power_sources_port ON public.odc_power_sources(port_id);