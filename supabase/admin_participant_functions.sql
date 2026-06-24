-- Run in Supabase SQL Editor after participants.sql

-- Add/delete participants
CREATE OR REPLACE FUNCTION admin_add_participant(admin_pin text, p_name text)
RETURNS participants
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE result participants;
BEGIN
  IF admin_pin IS DISTINCT FROM 'WADI2026' THEN RAISE EXCEPTION 'Invalid admin PIN'; END IF;
  INSERT INTO participants (name) VALUES (p_name) RETURNING * INTO result;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION admin_delete_participant(admin_pin text, p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF admin_pin IS DISTINCT FROM 'WADI2026' THEN RAISE EXCEPTION 'Invalid admin PIN'; END IF;
  DELETE FROM participants WHERE id = p_id;
END;
$$;

CREATE OR REPLACE FUNCTION admin_get_participants(admin_pin text)
RETURNS SETOF participants
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF admin_pin IS DISTINCT FROM 'WADI2026' THEN RAISE EXCEPTION 'Invalid admin PIN'; END IF;
  RETURN QUERY SELECT * FROM participants ORDER BY name ASC;
END;
$$;

-- Upsert predictions for a participant
CREATE OR REPLACE FUNCTION admin_upsert_participant_prediction(
  admin_pin text,
  p_participant_id uuid,
  p_match_id uuid,
  p_home int,
  p_away int
)
RETURNS participant_predictions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE result participant_predictions;
BEGIN
  IF admin_pin IS DISTINCT FROM 'WADI2026' THEN RAISE EXCEPTION 'Invalid admin PIN'; END IF;
  INSERT INTO participant_predictions (participant_id, match_id, predicted_home, predicted_away)
  VALUES (p_participant_id, p_match_id, p_home, p_away)
  ON CONFLICT (participant_id, match_id)
  DO UPDATE SET predicted_home = p_home, predicted_away = p_away
  RETURNING * INTO result;
  RETURN result;
END;
$$;

-- Get predictions for a match (with participant name)
CREATE OR REPLACE FUNCTION admin_get_match_predictions(admin_pin text, p_match_id uuid)
RETURNS TABLE (
  id uuid,
  participant_id uuid,
  participant_name text,
  match_id uuid,
  predicted_home int,
  predicted_away int,
  points_earned int
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF admin_pin IS DISTINCT FROM 'WADI2026' THEN RAISE EXCEPTION 'Invalid admin PIN'; END IF;
  RETURN QUERY
  SELECT pp.id, pp.participant_id, p.name AS participant_name,
         pp.match_id, pp.predicted_home, pp.predicted_away, pp.points_earned
  FROM participant_predictions pp
  JOIN participants p ON p.id = pp.participant_id
  WHERE pp.match_id = p_match_id
  ORDER BY p.name ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_add_participant(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_delete_participant(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_get_participants(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_upsert_participant_prediction(text, uuid, uuid, int, int) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_get_match_predictions(text, uuid) TO anon, authenticated;
