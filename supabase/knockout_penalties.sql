-- ============================================================
-- Knockout match penalties support
-- Run in Supabase SQL Editor
-- ============================================================

-- 1. Add penalties column to matches
ALTER TABLE matches ADD COLUMN IF NOT EXISTS penalties boolean DEFAULT false;

-- 2. Update admin_update_match to accept penalties flag
--    Uses COALESCE so omitting p_penalties keeps the existing value
CREATE OR REPLACE FUNCTION admin_update_match(
  admin_pin      text,
  match_id       uuid,
  p_home_score   int,
  p_away_score   int,
  p_status       text,
  p_match_minute text    DEFAULT NULL,
  p_penalties    boolean DEFAULT NULL
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
    home_score    = p_home_score,
    away_score    = p_away_score,
    status        = p_status,
    penalties     = COALESCE(p_penalties, penalties, false),
    match_minute  = CASE WHEN p_status = 'live' THEN p_match_minute ELSE NULL END,
    match_events  = CASE WHEN p_status = 'live' THEN match_events  ELSE NULL END
  WHERE id = match_id
  RETURNING * INTO result;
  RETURN result;
END;
$$;

-- 3. Update scoring RPC to treat penalty matches as draws
CREATE OR REPLACE FUNCTION admin_recalculate_match_participant_points(
  admin_pin  text,
  p_match_id uuid
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_home_score int;
  v_away_score int;
  v_status     text;
  v_penalties  boolean;
  rec          RECORD;
  v_points     int;
BEGIN
  IF admin_pin IS DISTINCT FROM 'WADI2026' THEN
    RAISE EXCEPTION 'Invalid admin PIN';
  END IF;

  SELECT home_score, away_score, status, COALESCE(penalties, false)
    INTO v_home_score, v_away_score, v_status, v_penalties
    FROM matches
   WHERE id = p_match_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Match not found';
  END IF;

  IF v_status IS DISTINCT FROM 'finished' THEN
    RAISE EXCEPTION 'Match is not finished (status: %)', v_status;
  END IF;

  FOR rec IN
    SELECT pp.id, pp.predicted_home, pp.predicted_away
      FROM participant_predictions pp
     WHERE pp.match_id = p_match_id
  LOOP
    IF rec.predicted_home = v_home_score AND rec.predicted_away = v_away_score THEN
      -- Exact score always gives 3 pts (even in penalty matches)
      v_points := 3;
    ELSIF v_penalties AND rec.predicted_home = rec.predicted_away THEN
      -- Penalty match → outcome is draw; predicted any draw = 1 pt
      v_points := 1;
    ELSIF NOT v_penalties AND (
         (rec.predicted_home > rec.predicted_away AND v_home_score > v_away_score)
      OR (rec.predicted_home = rec.predicted_away AND v_home_score = v_away_score)
      OR (rec.predicted_home < rec.predicted_away AND v_home_score < v_away_score)
    ) THEN
      v_points := 1;
    ELSE
      v_points := 0;
    END IF;

    UPDATE participant_predictions
       SET points_earned = v_points
     WHERE id = rec.id;
  END LOOP;

  -- Recompute totals for affected participants
  UPDATE participants p
     SET total_points = (
           SELECT COALESCE(SUM(pp.points_earned), 0)
             FROM participant_predictions pp
            WHERE pp.participant_id = p.id AND pp.points_earned IS NOT NULL
         ),
         exact_scores = (
           SELECT COUNT(*)
             FROM participant_predictions pp
            WHERE pp.participant_id = p.id AND pp.points_earned = 3
         )
   WHERE p.id IN (
     SELECT DISTINCT participant_id FROM participant_predictions WHERE match_id = p_match_id
   );

  -- Sync profiles from participants
  UPDATE profiles pr
     SET total_points = pa.total_points,
         exact_scores = pa.exact_scores
    FROM participants pa
   WHERE trim(pa.name) = trim(pr.username);
END;
$$;

GRANT EXECUTE ON FUNCTION admin_update_match(text, uuid, int, int, text, text, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_recalculate_match_participant_points(text, uuid) TO anon, authenticated;
