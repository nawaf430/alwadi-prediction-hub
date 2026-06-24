/** Free World Cup 2026 API — https://github.com/rezarahiminia/worldcup2026 */

export const WC26_BASE = 'https://worldcup26.ir'
export const WC26_GAMES_ENDPOINT = `${WC26_BASE}/get/games`

export type Wc26Game = {
  id: string
  home_team_name_en: string | null
  away_team_name_en: string | null
  home_score: string
  away_score: string
  finished: string
  time_elapsed: string
}

export type NormalizedExternalMatch = {
  source: '365scores' | 'worldcup26' | 'football-data'
  externalId: string
  apiRawStatus: string
  status: 'not_started' | 'live' | 'finished'
  home: number | null
  away: number | null
  matchMinute: string | null
}

/** Format worldcup26 time_elapsed for display (e.g. "45'", "67'") */
export function formatWc26MatchMinute(timeElapsed: string | undefined | null): string | null {
  const raw = (timeElapsed ?? '').trim()
  if (!raw) return null
  const lower = raw.toLowerCase()
  if (lower === 'notstarted' || lower === 'finished') return null
  return raw.includes("'") ? raw : `${raw}'`
}

/** DB team names (Arabic / mixed) → worldcup26 English canonical names */
const TEAM_ALIASES: Record<string, string> = {
  'أستراليا': 'Australia',
  'ألمانيا': 'Germany',
  'أوروغواي': 'Uruguay',
  'إسبانيا': 'Spain',
  'إنجلترا': 'England',
  'الأرجنتين': 'Argentina',
  'الإكوادور': 'Ecuador',
  'البرازيل': 'Brazil',
  'البرتغال': 'Portugal',
  'البوسنة والهرسك': 'Bosnia and Herzegovina',
  'التشيك': 'Czech Republic',
  'السعودية': 'Saudi Arabia',
  'السنغال': 'Senegal',
  'السويد': 'Sweden',
  'الكونغو': 'Democratic Republic of the Congo',
  'المغرب': 'Morocco',
  'المكسيك': 'Mexico',
  'النمسا': 'Austria',
  'الولايات المتحدة': 'United States',
  'اليابان': 'Japan',
  'باراغواي': 'Paraguay',
  'بلجيكا': 'Belgium',
  'بنما': 'Panama',
  'تونس': 'Tunisia',
  'جنوب أفريقيا': 'South Africa',
  'ساحل العاج': 'Ivory Coast',
  'سويسرا': 'Switzerland',
  'فرنسا': 'France',
  'قطر': 'Qatar',
  'كرواتيا': 'Croatia',
  'كندا': 'Canada',
  'كوراساو': 'Curaçao',
  'كوريا الجنوبية': 'South Korea',
  'كولومبيا': 'Colombia',
  'مصر': 'Egypt',
  'نيوزيلندا': 'New Zealand',
  'هولندا': 'Netherlands',
  // English names already used in DB (with minor variants)
  'Cape Verde Islands': 'Cape Verde',
}

export function normalizeTeamName(name: string): string {
  const trimmed = name.trim()
  return TEAM_ALIASES[trimmed] ?? trimmed
}

export function matchPairKey(home: string, away: string): string {
  return `${normalizeTeamName(home)}|${normalizeTeamName(away)}`
}

export function mapWc26Status(game: Wc26Game): 'not_started' | 'live' | 'finished' {
  const finished = (game.finished ?? '').toUpperCase() === 'TRUE'
  const elapsed = (game.time_elapsed ?? '').toLowerCase()

  if (finished || elapsed === 'finished') return 'finished'
  if (elapsed === 'notstarted' || elapsed === '') return 'not_started'
  return 'live'
}

export function normalizeWc26Game(game: Wc26Game): NormalizedExternalMatch {
  const status = mapWc26Status(game)
  const homeParsed = parseInt(game.home_score, 10)
  const awayParsed = parseInt(game.away_score, 10)

  return {
    source: 'worldcup26',
    externalId: game.id,
    apiRawStatus: game.time_elapsed,
    status,
    home: Number.isFinite(homeParsed) ? homeParsed : null,
    away: Number.isFinite(awayParsed) ? awayParsed : null,
    matchMinute: status === 'live' ? formatWc26MatchMinute(game.time_elapsed) : null,
  }
}

export function buildWc26MatchMap(games: Wc26Game[]): Map<string, NormalizedExternalMatch> {
  const map = new Map<string, NormalizedExternalMatch>()
  for (const game of games) {
    const home = game.home_team_name_en?.trim()
    const away = game.away_team_name_en?.trim()
    if (!home || !away) continue
    map.set(`${home}|${away}`, normalizeWc26Game(game))
  }
  return map
}

/** Fetch all games from worldcup26.ir (no API key). Returns null on failure/timeout. */
export async function fetchWorldCup26Games(timeoutMs = 25_000): Promise<Wc26Game[] | null> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    const res = await fetch(WC26_GAMES_ENDPOINT, {
      signal: controller.signal,
      next: { revalidate: 0 },
    })
    clearTimeout(timer)

    if (!res.ok) return null

    const body = await res.json() as { games?: Wc26Game[] }
    return body.games ?? null
  } catch {
    return null
  }
}
