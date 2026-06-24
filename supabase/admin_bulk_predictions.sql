-- Run in Supabase SQL Editor — bulk upsert for admin predictions grid

CREATE OR REPLACE FUNCTION admin_bulk_upsert_participant_predictions(
  admin_pin text,
  p_rows jsonb
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row jsonb;
  upserted int := 0;
BEGIN
  IF admin_pin IS DISTINCT FROM 'WADI2026' THEN
    RAISE EXCEPTION 'Invalid admin PIN';
  END IF;

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RETURN 0;
  END IF;

  FOR row IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    INSERT INTO participant_predictions (
      participant_id,
      match_id,
      predicted_home,
      predicted_away
    )
    VALUES (
      (row->>'participant_id')::uuid,
      (row->>'match_id')::uuid,
      (row->>'predicted_home')::int,
      (row->>'predicted_away')::int
    )
    ON CONFLICT (participant_id, match_id)
    DO UPDATE SET
      predicted_home = EXCLUDED.predicted_home,
      predicted_away = EXCLUDED.predicted_away;

    upserted := upserted + 1;
  END LOOP;

  RETURN upserted;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_bulk_upsert_participant_predictions(text, jsonb) TO anon, authenticated;
