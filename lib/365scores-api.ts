/**
 * Unofficial 365scores allscores feed — no API key.
 * https://webws.365scores.com/web/games/allscores/
 */

import {
  matchPairKey,
  normalizeTeamName,
  type NormalizedExternalMatch,
} from '@/lib/worldcup26-api'

export const SCORES365_BASE = 'https://webws.365scores.com/web/games/allscores/'
export const SCORES365_GAME_BASE = 'https://webws.365scores.com/web/game/'

export type MatchGoalEvent = {
  minute: string
  player: string
  side: 'home' | 'away'
}

export type Scores365Competitor = {
  name?: string
  score?: number
}

export type Scores365Game = {
  id: number
  competitionId?: number
  competitionDisplayName?: string
  startTime?: string
  /** 2 = not started, 3 = live, 4 = finished */
  statusGroup?: number
  statusText?: string
  shortStatusText?: string
  gameTime?: number
  gameTimeDisplay?: string
  homeCompetitor?: Scores365Competitor
  awayCompetitor?: Scores365Competitor
}

export type Scores365Response = {
  games?: Scores365Game[]
  competitions?: Array<{ id: number; name?: string }>
}

/** 365scores Arabic/English names → same canonical keys as worldcup26-api */
const TEAM_ALIASES_365: Record<string, string> = {
  'الكونغو الديمقراطية': 'Democratic Republic of the Congo',
  'كوت ديفوار': 'Ivory Coast',
  'الجزائر': 'Algeria',
  'العراق': 'Iraq',
  'النرويج': 'Norway',
  'الأردن': 'Jordan',
  'هايتي': 'Haiti',
  'اسكتلندا': 'Scotland',
  'تركيا': 'Turkey',
  'إيران': 'Iran',
  'أوزبكستان': 'Uzbekistan',
  'غانا': 'Ghana',
  Algeria: 'Algeria',
  Iraq: 'Iraq',
  Jordan: 'Jordan',
  Norway: 'Norway',
  Scotland: 'Scotland',
  Turkey: 'Turkey',
  Haiti: 'Haiti',
  Iran: 'Iran',
  Uzbekistan: 'Uzbekistan',
  Ghana: 'Ghana',
}

export function normalize365TeamName(name: string): string {
  const trimmed = name.trim()
  const alias = TEAM_ALIASES_365[trimmed]
  if (alias) return alias
  return normalizeTeamName(trimmed)
}

export function matchPairKey365(home: string, away: string): string {
  return `${normalize365TeamName(home)}|${normalize365TeamName(away)}`
}

/** Format DD/MM/YYYY in Asia/Riyadh for 365scores query params */
export function formatKsaDateParam(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Riyadh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(date)
  const day = parts.find(p => p.type === 'day')!.value
  const month = parts.find(p => p.type === 'month')!.value
  const year = parts.find(p => p.type === 'year')!.value
  return `${day}/${month}/${year}`
}

/**
 * statusGroup from observed 365scores responses (langId=27, football):
 *   2 → not started (statusText e.g. "لم تبدأ")
 *   3 → live (statusText e.g. "الشوط الأول", "الشوط الثاني")
 *   4 → finished (statusText e.g. "انتهت", "انتهت للتو", "بعد الوقت الإضافي")
 */
export function map365StatusGroup(
  statusGroup: number | undefined,
  statusText?: string,
): 'not_started' | 'live' | 'finished' {
  switch (statusGroup) {
    case 2:
      return 'not_started'
    case 3:
      return 'live'
    case 4:
      return 'finished'
    default: {
      const t = (statusText ?? '').trim()
      if (t === 'لم تبدأ') return 'not_started'
      if (t.includes('الشوط') || t.includes('HT') || t.includes('Half')) return 'live'
      if (t.includes('انته') || t.includes('Finished') || t.includes('FT')) return 'finished'
      return 'not_started'
    }
  }
}

function parse365Score(score: number | undefined): number | null {
  if (score == null || score < 0) return null
  return score
}

export function format365MatchMinute(game: Scores365Game): string | null {
  if (map365StatusGroup(game.statusGroup, game.statusText) !== 'live') return null
  const display = (game.gameTimeDisplay ?? '').trim()
  if (display && display !== '-1') {
    return display.includes("'") ? display : `${display}'`
  }
  if (game.gameTime != null && game.gameTime >= 0) {
    return `${game.gameTime}'`
  }
  return null
}

export function normalize365Game(game: Scores365Game): NormalizedExternalMatch | null {
  const homeName = game.homeCompetitor?.name?.trim()
  const awayName = game.awayCompetitor?.name?.trim()
  if (!homeName || !awayName) return null

  const status = map365StatusGroup(game.statusGroup, game.statusText)
  const rawStatus = `group:${game.statusGroup ?? '?'}|${game.statusText ?? ''}`

  return {
    source: '365scores',
    externalId: String(game.id),
    apiRawStatus: rawStatus,
    status,
    home: parse365Score(game.homeCompetitor?.score),
    away: parse365Score(game.awayCompetitor?.score),
    matchMinute: format365MatchMinute(game),
  }
}

export function build365MatchMap(games: Scores365Game[]): Map<string, NormalizedExternalMatch> {
  const map = new Map<string, NormalizedExternalMatch>()
  for (const game of games) {
    const home = game.homeCompetitor?.name?.trim()
    const away = game.awayCompetitor?.name?.trim()
    if (!home || !away) continue
    const normalized = normalize365Game(game)
    if (!normalized) continue
    map.set(matchPairKey365(home, away), normalized)
  }
  return map
}

function logResponseStructure(body: Scores365Response, startDate: string, endDate: string) {
  const games = body.games ?? []
  const statusGroups: Record<string, number> = {}
  for (const g of games) {
    const key = String(g.statusGroup ?? 'unknown')
    statusGroups[key] = (statusGroups[key] ?? 0) + 1
  }
  const wcGames = games.filter(g => g.competitionId === 5930)
  const sample = wcGames[0] ?? games[0]
  console.log('[365scores] response structure', {
    startDate,
    endDate,
    topLevelKeys: Object.keys(body),
    gamesCount: games.length,
    worldCupGames: wcGames.length,
    statusGroupCounts: statusGroups,
    sampleGame: sample
      ? {
          id: sample.id,
          competitionId: sample.competitionId,
          competitionDisplayName: sample.competitionDisplayName,
          statusGroup: sample.statusGroup,
          statusText: sample.statusText,
          gameTimeDisplay: sample.gameTimeDisplay,
          home: sample.homeCompetitor?.name,
          away: sample.awayCompetitor?.name,
          score: `${sample.homeCompetitor?.score ?? '?'}-${sample.awayCompetitor?.score ?? '?'}`,
        }
      : null,
  })
}

/** One bulk fetch for the KSA date span covering [windowStart, windowEnd]. */
export async function fetch365ScoresGames(
  windowStart: Date,
  windowEnd: Date,
  timeoutMs = 25_000,
): Promise<Scores365Game[] | null> {
  const startDate = formatKsaDateParam(windowStart)
  const endDate = formatKsaDateParam(windowEnd)

  const params = new URLSearchParams({
    appTypeId: '5',
    langId: '27',
    timezoneName: 'Asia/Riyadh',
    userCountryId: '6',
    sports: '1',
    onlyMajorGames: 'false',
    startDate,
    endDate,
  })

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    const res = await fetch(`${SCORES365_BASE}?${params.toString()}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: controller.signal,
      next: { revalidate: 0 },
    })
    clearTimeout(timer)

    if (!res.ok) {
      console.warn('[365scores] fetch failed:', res.status, res.statusText)
      return null
    }

    const body = await res.json() as Scores365Response
    logResponseStructure(body, startDate, endDate)
    return body.games ?? null
  } catch (err) {
    console.warn('[365scores] fetch error:', err instanceof Error ? err.message : err)
    return null
  }
}

/** Resolve a DB match against a pre-built 365scores map (same keys as matchPairKey). */
export function lookup365Match(
  map: Map<string, NormalizedExternalMatch>,
  homeTeam: string,
  awayTeam: string,
): NormalizedExternalMatch | undefined {
  return map.get(matchPairKey(homeTeam, awayTeam))
    ?? map.get(matchPairKey365(homeTeam, awayTeam))
}

type Scores365GameMember = {
  id?: number
  name?: string
  shortName?: string
}

type Scores365GameEvent = {
  competitorId?: number
  playerId?: number
  gameTimeDisplay?: string
  gameTime?: number
  eventType?: { id?: number; name?: string }
}

type Scores365GameDetail = {
  id?: number
  homeCompetitor?: { id?: number; name?: string }
  awayCompetitor?: { id?: number; name?: string }
  events?: Scores365GameEvent[]
  members?: Scores365GameMember[]
}

/** eventType.id === 1 → goal (هدف) in observed 365scores responses */
const GOAL_EVENT_TYPE_ID = 1

export function normalize365GoalsFromGame(game: Scores365GameDetail): MatchGoalEvent[] {
  const homeId = game.homeCompetitor?.id
  const awayId = game.awayCompetitor?.id
  if (homeId == null || awayId == null) return []

  const nameByPlayerId = new Map<number, string>()
  for (const m of game.members ?? []) {
    if (m.id == null) continue
    const name = (m.name ?? m.shortName ?? '').trim()
    if (name) nameByPlayerId.set(m.id, name)
  }

  const goals: MatchGoalEvent[] = []
  for (const ev of game.events ?? []) {
    if (ev.eventType?.id !== GOAL_EVENT_TYPE_ID) continue
    const minuteRaw = (ev.gameTimeDisplay ?? '').trim()
    const minute = minuteRaw
      ? (minuteRaw.includes("'") ? minuteRaw : `${minuteRaw}'`)
      : ev.gameTime != null ? `${ev.gameTime}'` : ''
    if (!minute) continue

    const playerId = ev.playerId
    const player = playerId != null ? (nameByPlayerId.get(playerId) ?? '') : ''
    if (!player) continue

    let side: 'home' | 'away' | null = null
    if (ev.competitorId === homeId) side = 'home'
    else if (ev.competitorId === awayId) side = 'away'
    if (!side) continue

    goals.push({ minute, player, side })
  }

  return goals.sort((a, b) => {
    const na = parseInt(a.minute, 10)
    const nb = parseInt(b.minute, 10)
    if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb
    return a.minute.localeCompare(b.minute)
  })
}

/** Fetch goal scorers for a single 365scores game (Arabic names via langId=27). */
export async function fetch365GameGoals(
  gameId: string | number,
  timeoutMs = 15_000,
): Promise<MatchGoalEvent[] | null> {
  const params = new URLSearchParams({
    appTypeId: '5',
    langId: '27',
    timezoneName: 'Asia/Riyadh',
    userCountryId: '6',
    gameId: String(gameId),
  })

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    const res = await fetch(`${SCORES365_GAME_BASE}?${params.toString()}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: controller.signal,
      next: { revalidate: 0 },
    })
    clearTimeout(timer)

    if (!res.ok) {
      console.warn('[365scores] game fetch failed:', res.status, gameId)
      return null
    }

    const body = await res.json() as { game?: Scores365GameDetail }
    const game = body.game
    if (!game) return null
    return normalize365GoalsFromGame(game)
  } catch (err) {
    console.warn('[365scores] game fetch error:', gameId, err instanceof Error ? err.message : err)
    return null
  }
}
