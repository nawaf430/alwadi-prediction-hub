-- Run this ONCE in Supabase → SQL Editor (combines participants.sql + admin_participant_functions.sql)

-- ── Tables ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  total_points int NOT NULL DEFAULT 0,
  exact_scores int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS participant_predictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  match_id uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  predicted_home int NOT NULL,
  predicted_away int NOT NULL,
  points_earned int,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (participant_id, match_id)
);

ALTER TABLE participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE participant_predictions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public read participants" ON participants;
CREATE POLICY "public read participants" ON participants FOR SELECT USING (true);

DROP POLICY IF EXISTS "public read participant_predictions" ON participant_predictions;
CREATE POLICY "public read participant_predictions" ON participant_predictions FOR SELECT USING (true);

GRANT ALL ON TABLE participants TO service_role;
GRANT ALL ON TABLE participant_predictions TO service_role;
GRANT SELECT ON TABLE participants TO anon, authenticated;
GRANT SELECT ON TABLE participant_predictions TO anon, authenticated;

-- ── RPC functions ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION admin_get_participants(admin_pin text)
RETURNS SETOF participants
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF admin_pin IS DISTINCT FROM 'WADI2026' THEN RAISE EXCEPTION 'Invalid admin PIN'; END IF;
  RETURN QUERY SELECT * FROM participants ORDER BY name ASC;
END;
$$;

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

GRANT EXECUTE ON FUNCTION admin_get_participants(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_add_participant(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_delete_participant(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_upsert_participant_prediction(text, uuid, uuid, int, int) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_get_match_predictions(text, uuid) TO anon, authenticated;
