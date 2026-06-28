/**
 * Shared live score / minute / goal-event sync for public score-refresh and admin update-scores.
 */

import { createServiceClient } from '@/lib/supabase-server'
import {
  build365MatchMap,
  fetch365GameGoals,
  fetch365ScoresGames,
  lookup365Match,
  type MatchGoalEvent,
} from '@/lib/365scores-api'
import {
  buildWc26MatchMap,
  fetchWorldCup26Games,
  matchPairKey,
  type NormalizedExternalMatch,
} from '@/lib/worldcup26-api'

const WC_BULK_ENDPOINT = 'https://api.football-data.org/v4/competitions/WC/matches'

export type SyncMode = 'public' | 'admin'

export type DbMatch = {
  id: string
  api_match_id: string
  home_team: string
  away_team: string
  status: string
  home_score: number | null
  away_score: number | null
  kickoff_time: string
  match_minute: string | null
  match_events: MatchGoalEvent[] | null
}

type FootballDataMatch = {
  id: number
  status: string
  minute?: number | null
  score: {
    fullTime: { home: number | null; away: number | null }
  }
  goals?: Array<{
    minute: number
    team?: { id?: number }
    scorer?: { name?: string }
  }>
  homeTeam?: { id?: number }
  awayTeam?: { id?: number }
}

type SyncMatchResult = {
  db_id: string
  api_match_id: string
  old_status: string
  new_status: string
  score: string
  match_minute?: string | null
  goals_count?: number
  changed: boolean
  api_source?: string
  skipped?: string
  update_error?: string
  api_raw_status?: string
  status_blocked?: string
  score_protected?: string
  update?: string
}

export type SyncLiveMatchesResult = {
  ok: boolean
  skipped?: boolean
  next_in?: number
  ran_at: string
  mode: SyncMode
  window: { from: string; to: string }
  window_matches: number
  api_calls: number
  api_source: string
  api_source_counts?: Record<string, number>
  scores365_games?: number
  worldcup26_games?: number
  match_minute_column: boolean
  match_events_column: boolean
  updated: number
  summary: SyncMatchResult[]
}

const STATUS_RANK: Record<string, number> = { not_started: 0, live: 1, finished: 2 }

// Module-level cooldowns (warm serverless instances)
let lastGlobalSyncMs = 0
const lastGoalFetchMs: Record<string, number> = {}
const GOAL_FETCH_COOLDOWN_MS = 60_000

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

function normalizeFootballDataGoals(
  m: FootballDataMatch,
  homeTeamName: string,
  awayTeamName: string,
): MatchGoalEvent[] {
  const homeApiId = m.homeTeam?.id
  const awayApiId = m.awayTeam?.id
  const goals: MatchGoalEvent[] = []

  for (const g of m.goals ?? []) {
    const name = (g.scorer?.name ?? '').trim()
    if (!name) continue
    let side: 'home' | 'away' | null = null
    if (g.team?.id != null && homeApiId != null && g.team.id === homeApiId) side = 'home'
    else if (g.team?.id != null && awayApiId != null && g.team.id === awayApiId) side = 'away'
    if (!side) continue
    goals.push({
      minute: `${g.minute}'`,
      player: name,
      side,
    })
  }

  return goals.sort((a, b) => parseInt(a.minute, 10) - parseInt(b.minute, 10))
}

async function fetchFootballDataBulk(
  utcDates: Set<string>,
): Promise<{ map: Map<number, NormalizedExternalMatch>; raw: Map<number, FootballDataMatch>; apiCalls: number }> {
  const apiMatchMap = new Map<number, NormalizedExternalMatch>()
  const rawMap = new Map<number, FootballDataMatch>()
  const apiKey = process.env.FOOTBALL_DATA_API_KEY
  if (!apiKey) return { map: apiMatchMap, raw: rawMap, apiCalls: 0 }

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
        rawMap.set(m.id, m)
      }
    } catch {
      // skip failed date
    }
  }

  return { map: apiMatchMap, raw: rawMap, apiCalls }
}

async function fetchFootballDataSingle(apiMatchId: string): Promise<FootballDataMatch | null> {
  const apiKey = process.env.FOOTBALL_DATA_API_KEY
  if (!apiKey) return null
  try {
    const res = await fetch(
      `https://api.football-data.org/v4/matches/${apiMatchId}`,
      { headers: { 'X-Auth-Token': apiKey }, cache: 'no-store' },
    )
    if (!res.ok) return null
    return await res.json() as FootballDataMatch
  } catch {
    return null
  }
}

async function hasColumn(
  supabase: ReturnType<typeof createServiceClient>,
  column: string,
): Promise<boolean> {
  const { error } = await supabase.from('matches').select(column).limit(1)
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
    match_events: MatchGoalEvent[] | null
  },
  minuteColumnExists: boolean,
  eventsColumnExists: boolean,
): Promise<string | undefined> {
  const updatePayload: Record<string, unknown> = {
    home_score: payload.home_score,
    away_score: payload.away_score,
    status: payload.status,
  }

  if (minuteColumnExists) {
    updatePayload.match_minute = payload.match_minute
  }
  if (eventsColumnExists) {
    updatePayload.match_events = payload.match_events
  }

  if (minuteColumnExists || eventsColumnExists) {
    const { error } = await supabase
      .from('matches')
      .update(updatePayload)
      .eq('id', matchId)
    if (!error) return undefined
    const msg = error.message
    if (!msg.includes('match_minute') && !msg.includes('match_events')) return msg
  }

  const { error: rpcErr } = await supabase.rpc('admin_update_match', {
    admin_pin: 'WADI2026',
    match_id: matchId,
    p_home_score: payload.home_score,
    p_away_score: payload.away_score,
    p_status: payload.status,
    ...(minuteColumnExists && { p_match_minute: payload.match_minute }),
  })
  return rpcErr?.message
}

function goalsEqual(a: MatchGoalEvent[] | null, b: MatchGoalEvent[] | null): boolean {
  return JSON.stringify(a ?? []) === JSON.stringify(b ?? [])
}

async function resolveGoals(
  match: DbMatch,
  apiMatch: NormalizedExternalMatch,
  fdRaw: FootballDataMatch | undefined,
  mode: SyncMode,
): Promise<MatchGoalEvent[] | null> {
  const effectiveStatus = mode === 'public' ? match.status : apiMatch.status
  if (effectiveStatus !== 'live' && match.status !== 'live') return null

  const now = Date.now()
  const goalKey = `${match.id}:${apiMatch.externalId}`
  const lastGoalFetch = lastGoalFetchMs[goalKey] ?? 0
  if (now - lastGoalFetch < GOAL_FETCH_COOLDOWN_MS) {
    return match.match_events
  }

  let goals: MatchGoalEvent[] | null = null

  if (apiMatch.source === '365scores') {
    goals = await fetch365GameGoals(apiMatch.externalId)
  }

  if (!goals?.length && fdRaw) {
    goals = normalizeFootballDataGoals(fdRaw, match.home_team, match.away_team)
  }

  if (!goals?.length && apiMatch.source !== '365scores') {
    const single = await fetchFootballDataSingle(match.api_match_id)
    if (single) goals = normalizeFootballDataGoals(single, match.home_team, match.away_team)
  }

  if (goals) {
    lastGoalFetchMs[goalKey] = now
    return goals
  }

  return match.match_events
}

export type SyncLiveMatchesOptions = {
  mode: SyncMode
  cooldownMs?: number
}

export async function syncLiveMatches(
  options: SyncLiveMatchesOptions,
): Promise<SyncLiveMatchesResult> {
  const { mode, cooldownMs = mode === 'public' ? 45_000 : 0 } = options
  const now = new Date()
  const nowMs = now.getTime()

  if (cooldownMs > 0) {
    const elapsed = nowMs - lastGlobalSyncMs
    if (elapsed < cooldownMs) {
      return {
        ok: true,
        skipped: true,
        next_in: Math.ceil((cooldownMs - elapsed) / 1000),
        ran_at: now.toISOString(),
        mode,
        window: { from: '', to: '' },
        window_matches: 0,
        api_calls: 0,
        api_source: 'none',
        match_minute_column: false,
        match_events_column: false,
        updated: 0,
        summary: [],
      }
    }
    lastGlobalSyncMs = nowMs
  }

  const supabase = createServiceClient()
  const minuteColumnExists = await hasColumn(supabase, 'match_minute')
  const eventsColumnExists = await hasColumn(supabase, 'match_events')

  const windowStart = new Date(nowMs - 4 * 60 * 60 * 1000)
  const windowEnd = new Date(nowMs + 2 * 60 * 60 * 1000)

  const selectCols = [
    'id, api_match_id, home_team, away_team, status, home_score, away_score, kickoff_time',
    minuteColumnExists ? 'match_minute' : null,
    eventsColumnExists ? 'match_events' : null,
  ].filter(Boolean).join(', ')

  const statusFilter = mode === 'public' ? ['live'] : ['live', 'not_started']

  const { data: matches, error: fetchErr } = await supabase
    .from('matches')
    .select(selectCols)
    .not('api_match_id', 'is', null)
    .in('status', statusFilter)
    .gte('kickoff_time', windowStart.toISOString())
    .lte('kickoff_time', windowEnd.toISOString())

  if (fetchErr) {
    throw new Error(fetchErr.message)
  }

  const windowMatches: DbMatch[] = (matches ?? []).map(m => {
    const row = m as unknown as DbMatch & { match_events?: MatchGoalEvent[] | null }
    return {
      ...row,
      match_minute: minuteColumnExists ? (row.match_minute ?? null) : null,
      match_events: eventsColumnExists
        ? (Array.isArray(row.match_events) ? row.match_events : null)
        : null,
    }
  })

  if (windowMatches.length === 0) {
    return {
      ok: true,
      ran_at: now.toISOString(),
      mode,
      window: { from: windowStart.toISOString(), to: windowEnd.toISOString() },
      window_matches: 0,
      api_calls: 0,
      api_source: 'none',
      match_minute_column: minuteColumnExists,
      match_events_column: eventsColumnExists,
      updated: 0,
      summary: [],
    }
  }

  const scores365Games = await fetch365ScoresGames(windowStart, windowEnd)
  const scores365Map = scores365Games ? build365MatchMap(scores365Games) : null
  let apiCalls = scores365Games ? 1 : 0

  let wc26Games: Awaited<ReturnType<typeof fetchWorldCup26Games>> = null
  const resolved = new Map<string, NormalizedExternalMatch>()
  const needsWc26: DbMatch[] = []
  const needsFootballData: DbMatch[] = []

  for (const match of windowMatches) {
    const hit365 = scores365Map ? lookup365Match(scores365Map, match.home_team, match.away_team) : undefined
    if (hit365) resolved.set(match.id, hit365)
    else needsWc26.push(match)
  }

  if (needsWc26.length > 0) {
    wc26Games = await fetchWorldCup26Games()
    if (wc26Games) {
      apiCalls++
      const wc26Map = buildWc26MatchMap(wc26Games)
      for (const match of needsWc26) {
        const hit = wc26Map.get(matchPairKey(match.home_team, match.away_team))
        if (hit) resolved.set(match.id, hit)
        else needsFootballData.push(match)
      }
    } else {
      needsFootballData.push(...needsWc26)
    }
  }

  const fdRawMap = new Map<number, FootballDataMatch>()
  if (needsFootballData.length > 0) {
    const utcDates = new Set(needsFootballData.map(m => m.kickoff_time.slice(0, 10)))
    const { map: fdMap, raw, apiCalls: fdCalls } = await fetchFootballDataBulk(utcDates)
    apiCalls += fdCalls
    for (const [id, rawMatch] of raw) fdRawMap.set(id, rawMatch)
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
  const usedSources = (['365scores', 'worldcup26', 'football-data'] as const).filter(s => sourceCounts[s] > 0)
  const primarySource =
    usedSources.length === 0 ? 'none'
    : usedSources.length === 1 ? usedSources[0]
    : 'mixed'

  const results: SyncMatchResult[] = []

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
    const apiStatus = apiMatch.status
    const home = apiMatch.home
    const away = apiMatch.away

    let safeStatus: string
    let statusBlocked = false
    if (mode === 'public') {
      safeStatus = match.status
      statusBlocked = apiStatus !== match.status
    } else {
      const currentRank = STATUS_RANK[match.status] ?? 0
      const newRank = STATUS_RANK[apiStatus] ?? 0
      safeStatus = newRank >= currentRank ? apiStatus : match.status
      statusBlocked = safeStatus !== apiStatus
    }

    const safeHome = (home === null && match.home_score !== null) ? match.home_score : home
    const safeAway = (away === null && match.away_score !== null) ? match.away_score : away
    const safeMatchMinute = safeStatus === 'live'
      ? (apiMatch.matchMinute ?? match.match_minute ?? null)
      : null

    let safeMatchEvents: MatchGoalEvent[] | null = match.match_events
    if (eventsColumnExists && safeStatus === 'live') {
      const fdRaw = fdRawMap.get(Number(match.api_match_id))
      const goals = await resolveGoals(match, apiMatch, fdRaw, mode)
      if (goals) safeMatchEvents = goals
    } else if (eventsColumnExists && safeStatus !== 'live') {
      safeMatchEvents = null
    }

    const statusChanged = safeStatus !== match.status
    const scoreChanged = safeHome !== match.home_score || safeAway !== match.away_score
    const minuteChanged = minuteColumnExists && safeMatchMinute !== (match.match_minute ?? null)
    const eventsChanged = eventsColumnExists && !goalsEqual(safeMatchEvents, match.match_events)
    const needsUpdate = statusChanged || scoreChanged || minuteChanged || eventsChanged

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
          match_events: safeMatchEvents,
        },
        minuteColumnExists,
        eventsColumnExists,
      )
    }

    results.push({
      db_id: match.id,
      api_match_id: match.api_match_id,
      old_status: match.status,
      new_status: safeStatus,
      score: `${safeHome ?? '?'}-${safeAway ?? '?'}`,
      ...(minuteColumnExists && { match_minute: safeMatchMinute }),
      ...(eventsColumnExists && { goals_count: safeMatchEvents?.length ?? 0 }),
      changed: needsUpdate && !updateError,
      api_source: apiMatch.source,
      ...(apiRawStatus !== apiStatus && { api_raw_status: apiRawStatus }),
      ...(statusBlocked && mode === 'admin' && { status_blocked: `${apiStatus} blocked (would go backward from ${match.status})` }),
      ...(home === null && match.home_score !== null && { score_protected: 'null scores from API ignored' }),
      ...(needsUpdate && !updateError && { update: 'success' }),
      ...(updateError && { update_error: updateError }),
      ...(!needsUpdate && { skipped: 'no_change' }),
    })
  }

  const updated = results.filter(r => r.changed).length

  return {
    ok: true,
    ran_at: now.toISOString(),
    mode,
    window: { from: windowStart.toISOString(), to: windowEnd.toISOString() },
    window_matches: windowMatches.length,
    api_calls: apiCalls,
    api_source: primarySource,
    api_source_counts: sourceCounts,
    scores365_games: scores365Games?.length ?? 0,
    worldcup26_games: wc26Games?.length ?? 0,
    match_minute_column: minuteColumnExists,
    match_events_column: eventsColumnExists,
    updated,
    summary: results,
  }
}
