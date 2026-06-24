-- Leaderboard: authenticated users can read all profiles
DROP POLICY IF EXISTS "profiles_select_authenticated_leaderboard" ON public.profiles;
CREATE POLICY "profiles_select_authenticated_leaderboard"
ON public.profiles FOR SELECT TO authenticated USING (true);
