import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import ws from 'ws'

config({ path: '.env.local' })

const ADMIN_PIN = 'WADI2026'
const TRIO = {
  'ابو تركي': '3d879146-2b17-42e4-81d3-00e8ab44f2c2',
  'ابو راكان': '4b464897-2452-4bf1-8237-c7914be455f4',
  'ابو رعد': '4e00e80c-0065-4557-83f1-6da84dfa7e6c',
}

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { realtime: { transport: ws } },
  )

  const { data: participants } = await supabase.rpc('admin_get_participants', { admin_pin: ADMIN_PIN })
  const { data: matches } = await supabase.rpc('admin_get_matches', { admin_pin: ADMIN_PIN })

  const match = matches?.find((m: { status: string }) => m.status === 'upcoming') ?? matches?.[0]

  console.log('=== MATCH USED BY TEST (same selection logic) ===')
  console.log({
    id: match.id,
    home_team: match.home_team,
    away_team: match.away_team,
    status: match.status,
    kickoff_time: match.kickoff_time,
    home_score: match.home_score,
    away_score: match.away_score,
  })

  const { data: preds } = await supabase.rpc('admin_get_match_predictions', {
    admin_pin: ADMIN_PIN,
    p_match_id: match.id,
  })

  console.log('\n=== CURRENT DB VALUES FOR TEST TRIO ===')
  for (const [name, id] of Object.entries(TRIO)) {
    const row = preds?.find((r: { participant_id: string }) => r.participant_id === id)
    console.log(`${name}: ${row ? `${row.predicted_home}-${row.predicted_away}` : '(no row)'}`)
  }

  console.log('\n=== HOW MANY PARTICIPANTS HAD PREDS BEFORE TEST? (unknown — test did not snapshot) ===')
  console.log(`Total prediction rows on this match now: ${preds?.length ?? 0}`)
}

main().catch(console.error)
