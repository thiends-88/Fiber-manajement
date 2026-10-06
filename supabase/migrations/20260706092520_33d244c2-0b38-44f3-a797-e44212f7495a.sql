
-- 1. Hapus policy publik lama pada core_assignments (namanya "public access cores")
DROP POLICY IF EXISTS "public access cores" ON public.core_assignments;
REVOKE ALL ON public.core_assignments FROM anon;

-- 2. Ubah has_role menjadi SECURITY INVOKER (aman karena RLS user_roles mengizinkan user membaca baris miliknya sendiri)
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role TEXT)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

-- 3. Cabut hak eksekusi publik pada handle_new_user (hanya dipanggil oleh trigger)
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated;

-- 4. Ketatkan pembacaan profiles: user hanya lihat miliknya, admin lihat semua
DROP POLICY IF EXISTS "auth read profiles" ON public.profiles;
CREATE POLICY "self or admin read profile" ON public.profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id OR public.has_role(auth.uid(), 'admin'));
