import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/** Returns [now, now+12h] for the upcoming-matches window */
function next12hRange(): [string, string] {
  const now = new Date()
  const end = new Date(now.getTime() + 12 * 60 * 60 * 1000)
  return [now.toISOString(), end.toISOString()]
}

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const [windowStart, windowEnd] = next12hRange()

  let selectCols =
    'id, home_team, away_team, kickoff_time, home_score, away_score, status, match_minute'
  let liveRes = await supabase
    .from('matches')
    .select(selectCols)
    .eq('status', 'live')
    .order('kickoff_time', { ascending: true })

  if (liveRes.error?.message?.includes('match_minute')) {
    selectCols = 'id, home_team, away_team, kickoff_time, home_score, away_score, status'
    liveRes = await supabase
      .from('matches')
      .select(selectCols)
      .eq('status', 'live')
      .order('kickoff_time', { ascending: true })
  }

  const upcomingRes = await supabase
    .from('matches')
    .select(selectCols)
    .eq('status', 'not_started')
    .gte('kickoff_time', windowStart)
    .lt('kickoff_time', windowEnd)
    .order('kickoff_time', { ascending: true })

  type MatchRow = {
    id: string
    home_team: string
    away_team: string
    kickoff_time: string
    home_score: number | null
    away_score: number | null
    status: string
    match_minute?: string | null
  }

  const normalize = (m: MatchRow) => ({
    ...m,
    match_minute: m.match_minute ?? null,
  })

  const matches = [
    ...((liveRes.data ?? []) as unknown as MatchRow[]).map(normalize),
    ...((upcomingRes.data ?? []) as unknown as MatchRow[]).map(normalize),
  ]

  return NextResponse.json({ matches })
}
