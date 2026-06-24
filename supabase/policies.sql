-- Run all of this in Supabase SQL Editor

-- 1. Leaderboard: authenticated users can read all profiles
DROP POLICY IF EXISTS "profiles_select_authenticated_leaderboard" ON public.profiles;
CREATE POLICY "profiles_select_authenticated_leaderboard"
ON public.profiles FOR SELECT TO authenticated USING (true);

-- 2. After deadline: everyone logged in can see all predictions for a match
DROP POLICY IF EXISTS "predictions_select_authenticated" ON public.predictions;
CREATE POLICY "predictions_select_authenticated"
ON public.predictions FOR SELECT TO authenticated USING (true);
