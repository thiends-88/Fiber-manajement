
-- Profiles
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  full_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read profiles" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "self update profile" ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- User roles
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'user', 'operator')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- has_role helper
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role TEXT)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE POLICY "auth read own or admin all" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- Auto-create profile + role on signup (first user = admin)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  is_first boolean;
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));

  SELECT NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') INTO is_first;
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, CASE WHEN is_first THEN 'admin' ELSE 'user' END);

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Tighten RLS on existing fiber tables: read for all authenticated, write for admin only
DROP POLICY IF EXISTS "public access olts" ON public.olts;
REVOKE ALL ON public.olts FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.olts TO authenticated;
CREATE POLICY "auth read olts" ON public.olts FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin write olts" ON public.olts FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "public access odcs" ON public.odcs;
REVOKE ALL ON public.odcs FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.odcs TO authenticated;
CREATE POLICY "auth read odcs" ON public.odcs FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin write odcs" ON public.odcs FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "public access odps" ON public.odps;
REVOKE ALL ON public.odps FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.odps TO authenticated;
CREATE POLICY "auth read odps" ON public.odps FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin write odps" ON public.odps FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "public access olt_cards" ON public.olt_cards;
REVOKE ALL ON public.olt_cards FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.olt_cards TO authenticated;
CREATE POLICY "auth read olt_cards" ON public.olt_cards FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin write olt_cards" ON public.olt_cards FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "public access olt_ports" ON public.olt_ports;
REVOKE ALL ON public.olt_ports FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.olt_ports TO authenticated;
CREATE POLICY "auth read olt_ports" ON public.olt_ports FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin write olt_ports" ON public.olt_ports FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "public access cores" ON public.core_assignments;
REVOKE ALL ON public.core_assignments FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.core_assignments TO authenticated;
CREATE POLICY "auth read core_assignments" ON public.core_assignments FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin write core_assignments" ON public.core_assignments FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
