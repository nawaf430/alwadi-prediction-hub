-- ============================================================
-- admin_recalculate_match_participant_points
-- Recalculates points_earned for all participant_predictions
-- for a given finished match, then updates totals on participants.
--
-- Run in Supabase SQL Editor after admin_participant_functions.sql
-- ============================================================

CREATE OR REPLACE FUNCTION admin_recalculate_match_participant_points(
  admin_pin text,
  p_match_id uuid
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_home_score int;
  v_away_score int;
  v_status     text;
  rec          RECORD;
  v_points     int;
BEGIN
  IF admin_pin IS DISTINCT FROM 'WADI2026' THEN
    RAISE EXCEPTION 'Invalid admin PIN';
  END IF;

  -- Fetch match result
  SELECT home_score, away_score, status
    INTO v_home_score, v_away_score, v_status
    FROM matches
   WHERE id = p_match_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Match not found';
  END IF;

  -- Only recalculate for finished matches
  IF v_status IS DISTINCT FROM 'finished' THEN
    RAISE EXCEPTION 'Match is not finished (status: %)', v_status;
  END IF;

  -- Update points_earned on every participant prediction for this match
  FOR rec IN
    SELECT pp.id, pp.participant_id, pp.predicted_home, pp.predicted_away
      FROM participant_predictions pp
     WHERE pp.match_id = p_match_id
  LOOP
    IF rec.predicted_home = v_home_score AND rec.predicted_away = v_away_score THEN
      v_points := 3;
    ELSIF (rec.predicted_home > rec.predicted_away AND v_home_score > v_away_score)
       OR (rec.predicted_home = rec.predicted_away AND v_home_score = v_away_score)
       OR (rec.predicted_home < rec.predicted_away AND v_home_score < v_away_score) THEN
      v_points := 1;
    ELSE
      v_points := 0;
    END IF;

    UPDATE participant_predictions
       SET points_earned = v_points
     WHERE id = rec.id;
  END LOOP;

  -- Recompute total_points and exact_scores for affected participants
  UPDATE participants p
     SET total_points = (
           SELECT COALESCE(SUM(pp.points_earned), 0)
             FROM participant_predictions pp
            WHERE pp.participant_id = p.id
              AND pp.points_earned IS NOT NULL
         ),
         exact_scores = (
           SELECT COUNT(*)
             FROM participant_predictions pp
            WHERE pp.participant_id = p.id
              AND pp.points_earned = 3
         )
   WHERE p.id IN (
     SELECT DISTINCT participant_id
       FROM participant_predictions
      WHERE match_id = p_match_id
   );

  -- UNCONDITIONAL final step: sync every profile from its matching participant
  UPDATE profiles pr
     SET total_points = pa.total_points,
         exact_scores = pa.exact_scores
    FROM participants pa
   WHERE trim(pa.name) = trim(pr.username);

END;
$$;

GRANT EXECUTE ON FUNCTION admin_recalculate_match_participant_points(text, uuid)
  TO anon, authenticated;
