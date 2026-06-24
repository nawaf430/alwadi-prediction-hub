import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * Test endpoint — no cron secret required.
 * Pass ?match_id=<api_match_id> to test a specific match.
 * Returns full API response + DB update result.
 */
export async function GET(req: NextRequest) {
  const apiMatchId = req.nextUrl.searchParams.get('match_id')
  if (!apiMatchId) {
    return NextResponse.json({ error: 'Pass ?match_id=<api_match_id>' }, { status: 400 })
  }

  const apiKey = process.env.FOOTBALL_DATA_API_KEY!

  // Fetch raw API response
  const apiRes = await fetch(`https://api.football-data.org/v4/matches/${apiMatchId}`, {
    headers: { 'X-Auth-Token': apiKey },
    next: { revalidate: 0 },
  })

  if (!apiRes.ok) {
    return NextResponse.json({
      error: `Football API returned ${apiRes.status}`,
      api_match_id: apiMatchId,
    }, { status: apiRes.status })
  }

  const rawApiData = await apiRes.json()

  // Map status
  const statusMap: Record<string, string> = {
    TIMED: 'not_started', SCHEDULED: 'not_started',
    IN_PLAY: 'live', PAUSED: 'live',
    FINISHED: 'finished',
  }
  const newStatus = statusMap[rawApiData.status] ?? 'not_started'
  const home: number | null = rawApiData.score?.fullTime?.home ?? null
  const away: number | null = rawApiData.score?.fullTime?.away ?? null

  // Look up the match in DB and update
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data: dbMatch } = await supabase
    .from('matches')
    .select('id, status, home_score, away_score')
    .eq('api_match_id', apiMatchId)
    .maybeSingle()

  let dbUpdate = null
  if (dbMatch) {
    const { error: updateErr } = await supabase
      .from('matches')
      .update({ status: newStatus, home_score: home, away_score: away })
      .eq('id', dbMatch.id)
    dbUpdate = updateErr ? { error: updateErr.message } : { ok: true, id: dbMatch.id }
  }

  return NextResponse.json({
    api_match_id: apiMatchId,
    api_raw_status: rawApiData.status,
    api_mapped_status: newStatus,
    score: { home, away },
    db_match_before: dbMatch,
    db_update: dbUpdate ?? { error: 'No match found with this api_match_id' },
    full_api_response: rawApiData,
  })
}
