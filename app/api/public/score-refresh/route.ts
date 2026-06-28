/**
 * Public endpoint called by LiveMatchCard every ~45s while a match is live.
 * Uses shared 365scores sync (public mode): scores + minute + goals only — never status.
 */
import { NextResponse } from 'next/server'
import { syncLiveMatches } from '@/lib/live-score-sync'

export async function GET() {
  try {
    const result = await syncLiveMatches({ mode: 'public', cooldownMs: 45_000 })

    if (result.skipped) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        next_in: result.next_in,
      })
    }

    return NextResponse.json({
      ok: true,
      changed: result.updated,
      window_matches: result.window_matches,
      api_source: result.api_source,
      summary: result.summary.map(s => ({
        db_id: s.db_id,
        score: s.score,
        match_minute: s.match_minute,
        goals_count: s.goals_count,
        changed: s.changed,
      })),
    })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'error' },
      { status: 500 },
    )
  }
}
