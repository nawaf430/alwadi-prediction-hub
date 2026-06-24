import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import ws from 'ws';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const FOOTBALL_DATA_API_KEY = process.env.FOOTBALL_DATA_API_KEY;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!FOOTBALL_DATA_API_KEY) throw new Error('Missing FOOTBALL_DATA_API_KEY in .env.local');
if (!SUPABASE_URL) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL in .env.local');
if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY in .env.local');

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  realtime: { transport: ws },
});

interface ApiMatch {
  id: number;
  utcDate: string;
  homeTeam: { name: string };
  awayTeam: { name: string };
}

async function fetchMatches(): Promise<ApiMatch[]> {
  console.log('Fetching World Cup 2026 matches from football-data.org...');
  const res = await fetch('https://api.football-data.org/v4/competitions/WC/matches', {
    headers: { 'X-Auth-Token': FOOTBALL_DATA_API_KEY! },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  const data = await res.json() as { matches: ApiMatch[] };
  console.log(`Fetched ${data.matches.length} matches.`);
  return data.matches;
}

function getDateKey(utcDate: string): string {
  return utcDate.slice(0, 10);
}

async function main() {
  const matches = await fetchMatches();

  const earliestPerDay = new Map<string, string>();
  for (const match of matches) {
    const day = getDateKey(match.utcDate);
    const current = earliestPerDay.get(day);
    if (!current || match.utcDate < current) {
      earliestPerDay.set(day, match.utcDate);
    }
  }

  console.log('\nMatch day deadlines:');
  for (const [day, deadline] of [...earliestPerDay.entries()].sort()) {
    console.log(`  ${day} → ${deadline}`);
  }

  // Skip matches where teams aren't determined yet (knockout placeholders)
  const knownMatches = matches.filter(
    (m) => m.homeTeam?.name && m.awayTeam?.name
  );
  console.log(`\nSkipping ${matches.length - knownMatches.length} placeholder matches (teams TBD).`);

  const rows = knownMatches.map((match) => {
    const day = getDateKey(match.utcDate);
    return {
      home_team: match.homeTeam.name,
      away_team: match.awayTeam.name,
      kickoff_time: match.utcDate,
      match_day_deadline: earliestPerDay.get(day)!,
      status: 'not_started',
      api_match_id: String(match.id),
      home_score: null,
      away_score: null,
    };
  });

  // Fetch already-imported api_match_ids to skip duplicates
  const { data: existing, error: fetchError } = await supabase
    .from('matches')
    .select('api_match_id');
  if (fetchError) throw new Error(fetchError.message);
  const existingIds = new Set((existing ?? []).map((r: { api_match_id: string }) => r.api_match_id));
  const newRows = rows.filter((r) => !existingIds.has(r.api_match_id));
  console.log(`\nSkipping ${existingIds.size} already-imported matches.`);
  console.log(`Inserting ${newRows.length} new rows into matches table...`);

  if (newRows.length === 0) {
    console.log('Nothing to insert. All done!');
    return;
  }

  const BATCH = 20;
  let inserted = 0;
  for (let i = 0; i < newRows.length; i += BATCH) {
    const batch = newRows.slice(i, i + BATCH);
    const { error } = await supabase
      .from('matches')
      .insert(batch);
    if (error) {
      if (error.message.includes('permission denied')) {
        console.error('\nPermission denied on matches table.');
        console.error('Run this in Supabase → SQL Editor, then re-run this script:\n');
        console.error('  GRANT ALL ON TABLE matches TO service_role;\n');
      }
      throw new Error(error.message);
    }
    inserted += batch.length;
    console.log(`  Inserted ${inserted}/${newRows.length}`);
  }

  console.log('\nDone! All World Cup 2026 matches imported successfully.');
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
