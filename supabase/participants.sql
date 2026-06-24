-- Run in Supabase SQL Editor

-- Participants table (non-registered players managed by admin)
CREATE TABLE IF NOT EXISTS participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  total_points int NOT NULL DEFAULT 0,
  exact_scores int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Predictions entered by admin on behalf of participants
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

-- RLS: allow public read (needed for public leaderboard)
ALTER TABLE participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE participant_predictions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read participants" ON participants FOR SELECT USING (true);
CREATE POLICY "public read participant_predictions" ON participant_predictions FOR SELECT USING (true);

-- Service role can write
GRANT ALL ON TABLE participants TO service_role;
GRANT ALL ON TABLE participant_predictions TO service_role;

-- Allow anon/authenticated to read
GRANT SELECT ON TABLE participants TO anon, authenticated;
GRANT SELECT ON TABLE participant_predictions TO anon, authenticated;
