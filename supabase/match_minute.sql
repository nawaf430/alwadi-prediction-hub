-- Run once in Supabase SQL Editor (or via scripts/apply-match-minute-migration.ts)

ALTER TABLE matches ADD COLUMN IF NOT EXISTS match_minute text;

-- Callable migration helper (optional — same as ALTER above)
CREATE OR REPLACE FUNCTION admin_apply_match_minute_schema(admin_pin text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF admin_pin IS DISTINCT FROM 'WADI2026' THEN
    RAISE EXCEPTION 'Invalid admin PIN';
  END IF;
  ALTER TABLE matches ADD COLUMN IF NOT EXISTS match_minute text;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_apply_match_minute_schema(text) TO anon, authenticated, service_role;

-- Extend admin_update_match to persist live minute (optional param)
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
    END
  WHERE id = match_id
  RETURNING * INTO result;
  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_update_match(text, uuid, int, int, text, text) TO anon, authenticated;
