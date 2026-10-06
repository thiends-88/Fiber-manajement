
-- OLTS
DROP POLICY IF EXISTS "admin write olts" ON public.olts;
CREATE POLICY "write olts" ON public.olts FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'operator'));
CREATE POLICY "update olts" ON public.olts FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'operator'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'operator'));
CREATE POLICY "delete olts" ON public.olts FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

-- OLT CARDS
DROP POLICY IF EXISTS "admin write olt_cards" ON public.olt_cards;
CREATE POLICY "write olt_cards" ON public.olt_cards FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'operator'));
CREATE POLICY "update olt_cards" ON public.olt_cards FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'operator'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'operator'));
CREATE POLICY "delete olt_cards" ON public.olt_cards FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

-- OLT PORTS
DROP POLICY IF EXISTS "admin write olt_ports" ON public.olt_ports;
CREATE POLICY "write olt_ports" ON public.olt_ports FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'operator'));
CREATE POLICY "update olt_ports" ON public.olt_ports FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'operator'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'operator'));
CREATE POLICY "delete olt_ports" ON public.olt_ports FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

-- ODCS
DROP POLICY IF EXISTS "admin write odcs" ON public.odcs;
CREATE POLICY "write odcs" ON public.odcs FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'operator'));
CREATE POLICY "update odcs" ON public.odcs FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'operator'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'operator'));
CREATE POLICY "delete odcs" ON public.odcs FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

-- ODPS
DROP POLICY IF EXISTS "admin write odps" ON public.odps;
CREATE POLICY "write odps" ON public.odps FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'operator'));
CREATE POLICY "update odps" ON public.odps FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'operator'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'operator'));
CREATE POLICY "delete odps" ON public.odps FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

-- CORE ASSIGNMENTS
DROP POLICY IF EXISTS "admin write core_assignments" ON public.core_assignments;
CREATE POLICY "write core_assignments" ON public.core_assignments FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'operator'));
CREATE POLICY "update core_assignments" ON public.core_assignments FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'operator'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'operator'));
CREATE POLICY "delete core_assignments" ON public.core_assignments FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

-- ODC POWER SOURCES
DROP POLICY IF EXISTS "Admins can insert odc power sources" ON public.odc_power_sources;
DROP POLICY IF EXISTS "Admins can update odc power sources" ON public.odc_power_sources;
DROP POLICY IF EXISTS "Admins can delete odc power sources" ON public.odc_power_sources;
CREATE POLICY "write odc_power_sources" ON public.odc_power_sources FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'operator'));
CREATE POLICY "update odc_power_sources" ON public.odc_power_sources FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'operator'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'operator'));
CREATE POLICY "delete odc_power_sources" ON public.odc_power_sources FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'));
