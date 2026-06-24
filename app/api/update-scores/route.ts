import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-server'
import {
  buildWc26MatchMap,
  fetchWorldCup26Games,
  matchPairKey,
  type NormalizedExternalMatch,
} from '@/lib/worldcup26-api'
import {
  build365MatchMap,
  fetch365ScoresGames,
  lookup365Match,
} from '@/lib/365scores-api'

const WC_BULK_ENDPOINT = 'https://api.football-data.org/v4/competitions/WC/matches'

type DbMatch = {
  id: string
  api_match_id: string
  home_team: string
  away_team: string
  status: string
  home_score: number | null
  away_score: number | null
  kickoff_time: string
  match_minute: string | null
}

type FootballDataMatch = {
  id: number
  status: string
  minute?: number | null
  score: {
    fullTime: { home: number | null; away: number | null }
  }
}

function mapFootballDataStatus(apiStatus: string): 'not_started' | 'live' | 'finished' {
  switch (apiStatus) {
    case 'TIMED':
    case 'SCHEDULED':
      return 'not_started'
    case 'IN_PLAY':
    case 'PAUSED':
      return 'live'
    case 'FINISHED':
      return 'finished'
    default:
      return 'not_started'
  }
}

function normalizeFootballDataMatch(m: FootballDataMatch): NormalizedExternalMatch {
  const status = mapFootballDataStatus(m.status)
  return {
    source: 'football-data',
    externalId: String(m.id),
    apiRawStatus: m.status,
    status,
    home: m.score?.fullTime?.home ?? null,
    away: m.score?.fullTime?.away ?? null,
    matchMinute: status === 'live' && m.minute != null ? `${m.minute}'` : null,
  }
}

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

async function fetchFootballDataBulk(
  utcDates: Set<string>,
): Promise<{ map: Map<number, NormalizedExternalMatch>; apiCalls: number }> {
  const apiMatchMap = new Map<number, NormalizedExternalMatch>()
  const apiKey = process.env.FOOTBALL_DATA_API_KEY
  if (!apiKey) return { map: apiMatchMap, apiCalls: 0 }

  let apiCalls = 0
  for (const date of utcDates) {
    try {
      const res = await fetch(
        `${WC_BULK_ENDPOINT}?dateFrom=${date}&dateTo=${date}`,
        {
          headers: { 'X-Auth-Token': apiKey },
          next: { revalidate: 0 },
        },
      )
      apiCalls++

      if (!res.ok) continue

      const body = await res.json() as { matches?: FootballDataMatch[] }
      for (const m of body.matches ?? []) {
        apiMatchMap.set(m.id, normalizeFootballDataMatch(m))
      }
    } catch {
      // continue — we'll skip matches whose API data is missing
    }
  }

  return { map: apiMatchMap, apiCalls }
}

async function hasMatchMinuteColumn(supabase: ReturnType<typeof createServiceClient>): Promise<boolean> {
  const { error } = await supabase.from('matches').select('match_minute').limit(1)
  return !error
}

async function persistMatchUpdate(
  supabase: ReturnType<typeof createServiceClient>,
  matchId: string,
  payload: {
    home_score: number
    away_score: number
    status: string
    match_minute: string | null
  },
  minuteColumnExists: boolean,
): Promise<string | undefined> {
  if (minuteColumnExists) {
    const { error } = await supabase
      .from('matches')
      .update({
        home_score: payload.home_score,
        away_score: payload.away_score,
        status: payload.status,
        match_minute: payload.match_minute,
      })
      .eq('id', matchId)
    if (!error) return undefined
    if (!error.message.includes('match_minute')) return error.message
  }

  const { error: rpcErr } = await supabase.rpc('admin_update_match', {
    admin_pin: 'WADI2026',
    match_id: matchId,
    p_home_score: payload.home_score,
    p_away_score: payload.away_score,
    p_status: payload.status,
  })
  return rpcErr?.message
}

export async function runUpdate() {
  const supabase = createServiceClient()
  const minuteColumnExists = await hasMatchMinuteColumn(supabase)

  const now = new Date()
  const windowStart = new Date(now.getTime() - 4 * 60 * 60 * 1000)  // 4 hours ago
  const windowEnd   = new Date(now.getTime() + 2 * 60 * 60 * 1000)  // 2 hours ahead

  const selectCols = minuteColumnExists
    ? 'id, api_match_id, home_team, away_team, status, home_score, away_score, kickoff_time, match_minute'
    : 'id, api_match_id, home_team, away_team, status, home_score, away_score, kickoff_time'

  const { data: matches, error: fetchErr } = await supabase
    .from('matches')
    .select(selectCols)
    .not('api_match_id', 'is', null)
    .in('status', ['live', 'not_started'])
    .gte('kickoff_time', windowStart.toISOString())
    .lte('kickoff_time', windowEnd.toISOString())

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 })
  }

  const windowMatches = (matches ?? []).map(m => {
    const row = m as unknown as DbMatch
    return {
      ...row,
      match_minute: minuteColumnExists ? (row.match_minute ?? null) : null,
    }
  })

  if (windowMatches.length === 0) {
    return NextResponse.json({
      ok: true,
      ran_at: now.toISOString(),
      window: { from: windowStart.toISOString(), to: windowEnd.toISOString() },
      window_matches: 0,
      api_calls: 0,
      api_source: 'none',
      updated: 0,
      summary: [],
    })
  }

  // Primary: 365scores (no key) — one fetch for the whole KSA date window
  const scores365Games = await fetch365ScoresGames(windowStart, windowEnd)
  const scores365Map = scores365Games ? build365MatchMap(scores365Games) : null
  let apiCalls = scores365Games ? 1 : 0

  // Fallback 1: worldcup26.ir
  let wc26Games: Awaited<ReturnType<typeof fetchWorldCup26Games>> = null
  let wc26Map: Map<string, NormalizedExternalMatch> | null = null

  // Fallback 2: football-data.org (only for matches still unresolved)
  const resolved = new Map<string, NormalizedExternalMatch>()
  const needsWc26: DbMatch[] = []
  const needsFootballData: DbMatch[] = []

  for (const match of windowMatches) {
    const hit365 = scores365Map ? lookup365Match(scores365Map, match.home_team, match.away_team) : undefined
    if (hit365) {
      resolved.set(match.id, hit365)
    } else {
      needsWc26.push(match)
    }
  }

  if (needsWc26.length > 0) {
    wc26Games = await fetchWorldCup26Games()
    if (wc26Games) {
      apiCalls++
      wc26Map = buildWc26MatchMap(wc26Games)
      for (const match of needsWc26) {
        const key = matchPairKey(match.home_team, match.away_team)
        const hit = wc26Map.get(key)
        if (hit) {
          resolved.set(match.id, hit)
        } else {
          needsFootballData.push(match)
        }
      }
    } else {
      needsFootballData.push(...needsWc26)
    }
  }

  if (needsFootballData.length > 0) {
    const utcDates = new Set(needsFootballData.map(m => m.kickoff_time.slice(0, 10)))
    const { map: fdMap, apiCalls: fdCalls } = await fetchFootballDataBulk(utcDates)
    apiCalls += fdCalls

    for (const match of needsFootballData) {
      const fdHit = fdMap.get(Number(match.api_match_id))
      if (fdHit) resolved.set(match.id, fdHit)
    }
  }

  const sourceCounts = { '365scores': 0, worldcup26: 0, 'football-data': 0 } as Record<string, number>
  for (const match of windowMatches) {
    const src = resolved.get(match.id)?.source
    if (src) sourceCounts[src] = (sourceCounts[src] ?? 0) + 1
  }
  const usedSources = (['365scores', 'worldcup26', 'football-data'] as const).filter(
    s => sourceCounts[s] > 0,
  )
  const primarySource =
    usedSources.length === 0 ? 'none'
    : usedSources.length === 1 ? usedSources[0]
    : 'mixed'

  const results: Array<{
    db_id: string
    api_match_id: string
    old_status: string
    new_status: string
    score: string
    match_minute?: string | null
    changed: boolean
    api_source?: string
    skipped?: string
    update_error?: string
    api_raw_status?: string
    status_blocked?: string
    score_protected?: string
    update?: string
  }> = []

  const STATUS_RANK: Record<string, number> = { not_started: 0, live: 1, finished: 2 }

  for (const match of windowMatches) {
    if (match.status === 'finished') {
      results.push({
        db_id: match.id,
        api_match_id: match.api_match_id,
        old_status: match.status,
        new_status: match.status,
        score: `${match.home_score ?? '?'}-${match.away_score ?? '?'}`,
        changed: false,
        skipped: 'already_finished',
      })
      continue
    }

    const apiMatch = resolved.get(match.id)

    if (!apiMatch) {
      results.push({
        db_id: match.id,
        api_match_id: match.api_match_id,
        old_status: match.status,
        new_status: match.status,
        score: `${match.home_score ?? '?'}-${match.away_score ?? '?'}`,
        changed: false,
        skipped: scores365Games || wc26Games
          ? 'not_in_any_api'
          : '365scores_and_worldcup26_failed_and_not_in_football_data',
      })
      continue
    }

    const apiRawStatus = apiMatch.apiRawStatus
    const newStatus = apiMatch.status
    const home = apiMatch.home
    const away = apiMatch.away

    const currentRank = STATUS_RANK[match.status] ?? 0
    const newRank     = STATUS_RANK[newStatus] ?? 0
    const safeStatus  = newRank >= currentRank ? newStatus : match.status
    const statusBlocked = safeStatus !== newStatus

    const safeHome = (home === null && match.home_score !== null) ? match.home_score : home
    const safeAway = (away === null && match.away_score !== null) ? match.away_score : away
    const safeMatchMinute = safeStatus === 'live'
      ? (apiMatch.matchMinute ?? match.match_minute ?? null)
      : null

    const statusChanged = safeStatus !== match.status
    const scoreChanged  = safeHome !== match.home_score || safeAway !== match.away_score
    const minuteChanged = minuteColumnExists && safeMatchMinute !== (match.match_minute ?? null)
    const needsUpdate   = statusChanged || scoreChanged || minuteChanged

    let updateError: string | undefined
    if (needsUpdate) {
      updateError = await persistMatchUpdate(
        supabase,
        match.id,
        {
          home_score: safeHome ?? 0,
          away_score: safeAway ?? 0,
          status: safeStatus,
          match_minute: safeMatchMinute,
        },
        minuteColumnExists,
      )
    }

    results.push({
      db_id: match.id,
      api_match_id: match.api_match_id,
      old_status: match.status,
      new_status: safeStatus,
      score: `${safeHome ?? '?'}-${safeAway ?? '?'}`,
      ...(minuteColumnExists && { match_minute: safeMatchMinute }),
      changed: needsUpdate && !updateError,
      api_source: apiMatch.source,
      ...(apiRawStatus !== newStatus && { api_raw_status: apiRawStatus }),
      ...(statusBlocked && { status_blocked: `${newStatus} blocked (would go backward from ${match.status})` }),
      ...(home === null && match.home_score !== null && { score_protected: 'null scores from API ignored' }),
      ...(needsUpdate && !updateError && { update: 'success' }),
      ...(updateError && { update_error: updateError }),
      ...(!needsUpdate && { skipped: 'no_change' }),
    })
  }

  const updated = results.filter(r => r.changed).length

  return NextResponse.json({
    ok: true,
    ran_at: now.toISOString(),
    window: { from: windowStart.toISOString(), to: windowEnd.toISOString() },
    window_matches: windowMatches.length,
    api_calls: apiCalls,
    api_source: primarySource,
    api_source_counts: sourceCounts,
    scores365_games: scores365Games?.length ?? 0,
    worldcup26_games: wc26Games?.length ?? 0,
    match_minute_column: minuteColumnExists,
    updated,
    summary: results,
  })
}
