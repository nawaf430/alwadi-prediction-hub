-- ============================================================
-- calculate_points() — matches AFTER UPDATE trigger function
-- Fixes: "UPDATE requires a WHERE clause" (safeupdate extension)
-- Every UPDATE below has an explicit WHERE clause.
--
-- Run in Supabase SQL Editor.
-- ============================================================

CREATE OR REPLACE FUNCTION calculate_points()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only recompute when the match has a final result.
  -- Live/score-only updates skip this body entirely (no error, no heavy work).
  IF NEW.status = 'finished'
     AND NEW.home_score IS NOT NULL
     AND NEW.away_score IS NOT NULL THEN

    -- 1) Score registered-user predictions for THIS match
    UPDATE predictions p
       SET points_earned = CASE
             WHEN p.predicted_home = NEW.home_score
              AND p.predicted_away = NEW.away_score THEN 3
             WHEN sign(p.predicted_home - p.predicted_away)
                = sign(NEW.home_score - NEW.away_score) THEN 1
             ELSE 0
           END
     WHERE p.match_id = NEW.id;

    -- 2) Score admin-entered participant predictions for THIS match
    UPDATE participant_predictions pp
       SET points_earned = CASE
             WHEN pp.predicted_home = NEW.home_score
              AND pp.predicted_away = NEW.away_score THEN 3
             WHEN sign(pp.predicted_home - pp.predicted_away)
                = sign(NEW.home_score - NEW.away_score) THEN 1
             ELSE 0
           END
     WHERE pp.match_id = NEW.id;

    -- 3) Recompute every participant's totals from their scored predictions
    UPDATE participants pa
       SET total_points = COALESCE((
             SELECT SUM(pp.points_earned)
               FROM participant_predictions pp
              WHERE pp.participant_id = pa.id
           ), 0),
           exact_scores = COALESCE((
             SELECT COUNT(*)
               FROM participant_predictions pp
              WHERE pp.participant_id = pa.id
                AND pp.points_earned = 3
           ), 0)
     WHERE pa.id IS NOT NULL;

    -- 4) Recompute every profile's totals from the predictions table
    --    (covers registered users who predict directly, not via a participant row)
    UPDATE profiles pr
       SET total_points = COALESCE((
             SELECT SUM(p.points_earned)
               FROM predictions p
              WHERE p.user_id = pr.id
           ), 0),
           exact_scores = COALESCE((
             SELECT COUNT(*)
               FROM predictions p
              WHERE p.user_id = pr.id
                AND p.points_earned = 3
           ), 0)
     WHERE pr.id IS NOT NULL;

    -- 5) Final sync: every profile mirrors its matching participant row
    --    (matched by trimmed name = trimmed username). Direct assignment so
    --    admin corrections that lower a score are reflected accurately.
    UPDATE profiles pr
       SET total_points = pa.total_points,
           exact_scores = pa.exact_scores
      FROM participants pa
     WHERE trim(pa.name) = trim(pr.username);

  END IF;

  RETURN NEW;
END;
$$;

-- Ensure the trigger is attached to the matches table (idempotent)
DROP TRIGGER IF EXISTS trg_calculate_points ON matches;
CREATE TRIGGER trg_calculate_points
  AFTER UPDATE ON matches
  FOR EACH ROW
  EXECUTE FUNCTION calculate_points();
