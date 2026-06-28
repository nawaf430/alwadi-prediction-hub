import { NextRequest, NextResponse } from 'next/server'
import { syncLiveMatches } from '@/lib/live-score-sync'

function isAuthorized(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET
  if (req.headers.get('x-cron-secret') === cronSecret) return true
  if (req.headers.get('authorization') === `Bearer ${cronSecret}`) return true
  return false
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return runUpdate()
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return runUpdate()
}

export async function runUpdate() {
  try {
    const result = await syncLiveMatches({ mode: 'admin', cooldownMs: 0 })
    return NextResponse.json({
      ok: result.ok,
      ran_at: result.ran_at,
      window: result.window,
      window_matches: result.window_matches,
      checked: result.window_matches,
      api_calls: result.api_calls,
      api_source: result.api_source,
      api_source_counts: result.api_source_counts,
      scores365_games: result.scores365_games,
      worldcup26_games: result.worldcup26_games,
      match_minute_column: result.match_minute_column,
      match_events_column: result.match_events_column,
      updated: result.updated,
      summary: result.summary,
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'error' },
      { status: 500 },
    )
  }
}
