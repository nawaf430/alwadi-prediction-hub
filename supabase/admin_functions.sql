-- Run in Supabase SQL Editor — admin RPCs (PIN-protected, no service role key needed)

CREATE OR REPLACE FUNCTION admin_get_matches(admin_pin text)
RETURNS SETOF matches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF admin_pin IS DISTINCT FROM 'WADI2026' THEN
    RAISE EXCEPTION 'Invalid admin PIN';
  END IF;
  RETURN QUERY SELECT * FROM matches ORDER BY kickoff_time ASC;
END;
$$;

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

CREATE OR REPLACE FUNCTION admin_get_users(admin_pin text)
RETURNS TABLE (
  id uuid,
  username text,
  total_points int,
  exact_scores int,
  is_banned boolean,
  invite_code_used text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF admin_pin IS DISTINCT FROM 'WADI2026' THEN
    RAISE EXCEPTION 'Invalid admin PIN';
  END IF;
  RETURN QUERY
  SELECT p.id, p.username, p.total_points, p.exact_scores, p.is_banned, p.invite_code_used
  FROM profiles p
  ORDER BY p.username ASC;
END;
$$;

CREATE OR REPLACE FUNCTION admin_set_user_banned(
  admin_pin text,
  user_id uuid,
  banned boolean
)
RETURNS profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result profiles;
BEGIN
  IF admin_pin IS DISTINCT FROM 'WADI2026' THEN
    RAISE EXCEPTION 'Invalid admin PIN';
  END IF;
  UPDATE profiles SET is_banned = banned WHERE id = user_id RETURNING * INTO result;
  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_get_matches(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_update_match(text, uuid, int, int, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_get_users(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_set_user_banned(text, uuid, boolean) TO anon, authenticated;
