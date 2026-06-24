/** Helpers for admin multi-match predictions grid */

export type PredCell = { home: string; away: string }
export type PredGrid = Record<string, Record<string, PredCell>>
export type SavedSnapshot = Record<string, Record<string, { home: number; away: number }>>

export type MatchForGrid = {
  id: string
  home_team: string
  away_team: string
  status: string
  kickoff_time: string
  home_score?: number | null
  away_score?: number | null
}

export type BulkPredRow = {
  participant_id: string
  match_id: string
  predicted_home: number
  predicted_away: number
}

const KSA_MS = 3 * 60 * 60 * 1000

export function toKSADateStr(utcIso: string): string {
  const d = new Date(new Date(utcIso).getTime() + KSA_MS)
  return d.toISOString().slice(0, 10)
}

export function todayKSA(): string {
  return toKSADateStr(new Date().toISOString())
}

export function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Matches whose KSA kickoff date is today or tomorrow */
export function filterTodayTomorrowMatches(matches: MatchForGrid[]): MatchForGrid[] {
  const today = todayKSA()
  const tomorrow = addDays(today, 1)
  const allowed = new Set([today, tomorrow])

  return matches
    .filter(m => allowed.has(toKSADateStr(m.kickoff_time)))
    .sort((a, b) => a.kickoff_time.localeCompare(b.kickoff_time))
}

export function formatKickoffShort(utcIso: string): string {
  const d = new Date(new Date(utcIso).getTime() + KSA_MS)
  const h = d.getUTCHours().toString().padStart(2, '0')
  const min = d.getUTCMinutes().toString().padStart(2, '0')
  return `${h}:${min}`
}

export function matchToggleLabel(m: MatchForGrid): string {
  const time = formatKickoffShort(m.kickoff_time)
  const status =
    m.status === 'live' ? ' 🔴'
    : m.status === 'finished' ? ' ✓'
    : ''
  return `${m.home_team} vs ${m.away_team} — ${time}${status}`
}

export function getCell(
  grid: PredGrid,
  participantId: string,
  matchId: string,
): PredCell {
  return grid[participantId]?.[matchId] ?? { home: '', away: '' }
}

export function isCellComplete(cell: PredCell): boolean {
  return cell.home !== '' && cell.away !== ''
}

export function isCellSaved(
  grid: PredGrid,
  snapshot: SavedSnapshot,
  participantId: string,
  matchId: string,
): boolean {
  const cell = getCell(grid, participantId, matchId)
  if (!isCellComplete(cell)) return false
  const saved = snapshot[participantId]?.[matchId]
  if (!saved) return false
  return String(saved.home) === cell.home && String(saved.away) === cell.away
}

export function hasDraftGridContent(grid: PredGrid): boolean {
  for (const byMatch of Object.values(grid)) {
    for (const cell of Object.values(byMatch)) {
      if (cell.home !== '' || cell.away !== '') return true
    }
  }
  return false
}

export function hasUnsavedChanges(
  grid: PredGrid,
  snapshot: SavedSnapshot,
  selectedMatchIds: string[],
): boolean {
  for (const matchId of selectedMatchIds) {
    for (const [participantId, byMatch] of Object.entries(grid)) {
      const cell = byMatch[matchId]
      if (!cell) continue
      const partial = (cell.home !== '' && cell.away === '') || (cell.home === '' && cell.away !== '')
      if (partial) return true
      if (!isCellComplete(cell)) continue
      if (!isCellSaved(grid, snapshot, participantId, matchId)) return true
    }
  }
  return false
}

export function collectSaveRows(
  grid: PredGrid,
  selectedMatchIds: string[],
): BulkPredRow[] {
  const rows: BulkPredRow[] = []
  for (const matchId of selectedMatchIds) {
    for (const [participantId, byMatch] of Object.entries(grid)) {
      const cell = byMatch[matchId]
      if (!cell || !isCellComplete(cell)) continue
      rows.push({
        participant_id: participantId,
        match_id: matchId,
        predicted_home: parseInt(cell.home, 10),
        predicted_away: parseInt(cell.away, 10),
      })
    }
  }
  return rows
}

export function mergeDbRowsIntoGrid(
  grid: PredGrid,
  snapshot: SavedSnapshot,
  matchId: string,
  rows: Array<{ participant_id: string; predicted_home: number; predicted_away: number }>,
  participantIds: string[],
): { predGrid: PredGrid; savedSnapshot: SavedSnapshot } {
  const predGrid = { ...grid }
  const savedSnapshot = { ...snapshot }

  for (const pid of participantIds) {
    if (!predGrid[pid]) predGrid[pid] = {}
    if (!savedSnapshot[pid]) savedSnapshot[pid] = {}
  }

  for (const row of rows) {
    const pid = row.participant_id
    if (!predGrid[pid]) predGrid[pid] = {}
    const existing = predGrid[pid][matchId]
    const hasLocalEdits =
      existing && (existing.home !== '' || existing.away !== '')
    if (hasLocalEdits) continue

    const home = String(row.predicted_home)
    const away = String(row.predicted_away)
    predGrid[pid] = {
      ...predGrid[pid],
      [matchId]: { home, away },
    }
    savedSnapshot[pid] = {
      ...savedSnapshot[pid],
      [matchId]: { home: row.predicted_home, away: row.predicted_away },
    }
  }

  return { predGrid, savedSnapshot }
}

export function applySavedRowsToSnapshot(
  snapshot: SavedSnapshot,
  rows: BulkPredRow[],
): SavedSnapshot {
  const next = { ...snapshot }
  for (const row of rows) {
    if (!next[row.participant_id]) next[row.participant_id] = {}
    next[row.participant_id] = {
      ...next[row.participant_id],
      [row.match_id]: {
        home: row.predicted_home,
        away: row.predicted_away,
      },
    }
  }
  return next
}

export function ensureParticipantKeys(
  grid: PredGrid,
  snapshot: SavedSnapshot,
  participantIds: string[],
): { predGrid: PredGrid; savedSnapshot: SavedSnapshot } {
  const predGrid = { ...grid }
  const savedSnapshot = { ...snapshot }
  for (const pid of participantIds) {
    if (!predGrid[pid]) predGrid[pid] = {}
    if (!savedSnapshot[pid]) savedSnapshot[pid] = {}
  }
  return { predGrid, savedSnapshot }
}
