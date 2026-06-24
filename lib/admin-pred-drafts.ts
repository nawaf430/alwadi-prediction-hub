import type { PredGrid, SavedSnapshot } from '@/lib/admin-pred-grid'

export const ADMIN_PRED_DRAFT_KEY = 'admin_pred_draft'
export const LEGACY_DRAFT_PREFIX = 'alwadi_admin_pred_draft_'

export type UnifiedPredDraft = {
  selectedMatchIds: string[]
  predGrid: PredGrid
  savedSnapshot: SavedSnapshot
  updatedAt: string
}

export function saveUnifiedDraft(draft: UnifiedPredDraft): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(ADMIN_PRED_DRAFT_KEY, JSON.stringify(draft))
  } catch (err) {
    console.warn('[admin draft] save failed:', err)
  }
}

export function loadUnifiedDraft(): UnifiedPredDraft | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(ADMIN_PRED_DRAFT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as UnifiedPredDraft
    if (!parsed.predGrid || !Array.isArray(parsed.selectedMatchIds)) return null
    return {
      selectedMatchIds: parsed.selectedMatchIds,
      predGrid: parsed.predGrid,
      savedSnapshot: parsed.savedSnapshot ?? {},
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
    }
  } catch {
    return null
  }
}

export function clearUnifiedDraft(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(ADMIN_PRED_DRAFT_KEY)
  } catch {
    // ignore
  }
}

function listLegacyDraftKeys(): string[] {
  if (typeof window === 'undefined') return []
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith(LEGACY_DRAFT_PREFIX)) keys.push(key)
  }
  return keys
}

/** Merge old per-match drafts into unified format, then delete legacy keys */
export function migrateLegacyDrafts(): UnifiedPredDraft | null {
  if (typeof window === 'undefined') return null

  const existing = loadUnifiedDraft()
  if (existing) return existing

  const legacyKeys = listLegacyDraftKeys()
  if (legacyKeys.length === 0) return null

  const selectedMatchIds: string[] = []
  const predGrid: PredGrid = {}
  const savedSnapshot: SavedSnapshot = {}
  let latestUpdated = ''

  for (const key of legacyKeys) {
    const matchId = key.slice(LEGACY_DRAFT_PREFIX.length)
    try {
      const raw = localStorage.getItem(key)
      if (!raw) continue
      const parsed = JSON.parse(raw) as {
        matchId?: string
        predInputs?: Record<string, { predicted_home: string; predicted_away: string }>
        savedPredSet?: string[]
        updatedAt?: string
      }
      const mid = parsed.matchId ?? matchId
      if (!selectedMatchIds.includes(mid)) selectedMatchIds.push(mid)

      for (const [participantId, pred] of Object.entries(parsed.predInputs ?? {})) {
        if (!predGrid[participantId]) predGrid[participantId] = {}
        predGrid[participantId][mid] = {
          home: pred.predicted_home ?? '',
          away: pred.predicted_away ?? '',
        }
        if (parsed.savedPredSet?.includes(participantId)) {
          if (!savedSnapshot[participantId]) savedSnapshot[participantId] = {}
          const h = parseInt(pred.predicted_home, 10)
          const a = parseInt(pred.predicted_away, 10)
          if (Number.isFinite(h) && Number.isFinite(a)) {
            savedSnapshot[participantId][mid] = { home: h, away: a }
          }
        }
      }

      if (parsed.updatedAt && parsed.updatedAt > latestUpdated) {
        latestUpdated = parsed.updatedAt
      }
    } catch {
      // skip corrupt legacy entry
    }
    localStorage.removeItem(key)
  }

  if (!Object.keys(predGrid).length) return null

  const draft: UnifiedPredDraft = {
    selectedMatchIds,
    predGrid,
    savedSnapshot,
    updatedAt: latestUpdated || new Date().toISOString(),
  }
  saveUnifiedDraft(draft)
  return draft
}

export function loadDraftWithMigration(): UnifiedPredDraft | null {
  return loadUnifiedDraft() ?? migrateLegacyDrafts()
}
