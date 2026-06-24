-- Allow public (anon) read access to live + upcoming matches for LiveMatchCard
DROP POLICY IF EXISTS "matches_select_public_live_upcoming" ON public.matches;
CREATE POLICY "matches_select_public_live_upcoming"
ON public.matches FOR SELECT TO anon, authenticated
USING (status IN ('live', 'not_started'));
