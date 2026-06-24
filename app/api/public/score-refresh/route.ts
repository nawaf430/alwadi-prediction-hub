/**
 * Public endpoint called by LiveMatchCard every 30 seconds.
 * Uses a module-level cooldown so only ONE football-data.org API call happens
 * per 45-second window regardless of how many clients are polling.
 * No auth required — rate limited by the cooldown.
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-server'

// Module-level cooldown: survives across requests in a warm serverless instance.
// Key = match DB id, value = last fetch timestamp (ms).
const lastFetchMs: Record<string, number> = {}
const COOLDOWN_MS = 3 * 60_000  // 3 minutes between API calls


export async function GET() {
  try {
    const supabase = createServiceClient()

    const { data: liveMatch } = await supabase
      .from('matches')
      .select('id, api_match_id, home_score, away_score, status')
      .eq('status', 'live')
      .limit(1)
      .maybeSingle()

    if (!liveMatch || !liveMatch.api_match_id) {
      return NextResponse.json({ ok: true, message: 'no live match' })
    }

    const now = Date.now()
    const last = lastFetchMs[liveMatch.id] ?? 0

    if (now - last < COOLDOWN_MS) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        score: `${liveMatch.home_score ?? '?'}-${liveMatch.away_score ?? '?'}`,
        next_in: Math.ceil((COOLDOWN_MS - (now - last)) / 1000),
      })
    }

    // Mark as fetching now before the async call to prevent parallel racing
    lastFetchMs[liveMatch.id] = now

    const apiRes = await fetch(
      `https://api.football-data.org/v4/matches/${liveMatch.api_match_id}`,
      { headers: { 'X-Auth-Token': process.env.FOOTBALL_DATA_API_KEY! }, cache: 'no-store' },
    )

    if (!apiRes.ok) {
      // Reset cooldown so next poll retries
      lastFetchMs[liveMatch.id] = 0
      return NextResponse.json({ ok: false, error: 'football API error' }, { status: 502 })
    }

    const apiData = await apiRes.json()
    // score-refresh ONLY updates scores — never touches match status.
    // Status transitions (live → finished) are handled exclusively by the admin
    // via /api/update-scores to avoid premature finish detection.
    const home: number | null = apiData.score?.fullTime?.home ?? null
    const away: number | null = apiData.score?.fullTime?.away ?? null

    // Only write if we got real numbers back
    if (home === null || away === null) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'null_scores' })
    }

    const scoreChanged = home !== liveMatch.home_score || away !== liveMatch.away_score

    if (scoreChanged) {
      await supabase
        .from('matches')
        .update({ home_score: home, away_score: away })
        .eq('id', liveMatch.id)
    }

    return NextResponse.json({
      ok: true,
      changed: scoreChanged,
      score: `${home}-${away}`,
    })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'error' },
      { status: 500 },
    )
  }
}
