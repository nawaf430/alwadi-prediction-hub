-- Run in Supabase SQL Editor — goal events for live match card
-- Array of { minute, player, side } where side is 'home' | 'away'

ALTER TABLE matches ADD COLUMN IF NOT EXISTS match_events jsonb;

-- Clear match_events when match is no longer live (same as match_minute)
CREATE OR REPLACE FUNCTION admin_update_match(
  admin_pin text,
  match_id uuid,
  p_home_score int,
  p_away_score int,
  p_status text,
  p_match_minute text DEFAULT NULL
)
RETURNS matches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result matches;
BEGIN
  IF admin_pin IS DISTINCT FROM 'WADI2026' THEN
    RAISE EXCEPTION 'Invalid admin PIN';
  END IF;
  UPDATE matches
  SET
    home_score = p_home_score,
    away_score = p_away_score,
    status = p_status,
    match_minute = CASE
      WHEN p_status = 'live' THEN p_match_minute
      ELSE NULL
    END,
    match_events = CASE
      WHEN p_status = 'live' THEN match_events
      ELSE NULL
    END
  WHERE id = match_id
  RETURNING * INTO result;
  RETURN result;
END;
$$;
