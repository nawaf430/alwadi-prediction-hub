'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ADMIN_PIN } from '@/lib/constants'
import {
  clearUnifiedDraft,
  loadDraftWithMigration,
  saveUnifiedDraft,
  type UnifiedPredDraft,
} from '@/lib/admin-pred-drafts'
import {
  applySavedRowsToSnapshot,
  collectSaveRows,
  ensureParticipantKeys,
  filterTodayTomorrowMatches,
  getCell,
  hasDraftGridContent,
  hasUnsavedChanges,
  isCellSaved,
  matchToggleLabel,
  mergeDbRowsIntoGrid,
  type MatchForGrid,
  type PredGrid,
  type SavedSnapshot,
} from '@/lib/admin-pred-grid'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

const MAX_SELECTED_MATCHES = 3

type Participant = {
  id: string
  name: string
}

type Props = {
  matches: MatchForGrid[]
  participants: Participant[]
  onError: (message: string) => void
  onRunPointsRecalc: (match: MatchForGrid) => Promise<void>
  onRefreshLeaderboard: () => Promise<void>
}

export function AdminPredictionsEntry({
  matches,
  participants,
  onError,
  onRunPointsRecalc,
  onRefreshLeaderboard,
}: Props) {
  const [selectedMatchIds, setSelectedMatchIds] = useState<string[]>([])
  const [predGrid, setPredGrid] = useState<PredGrid>({})
  const [savedSnapshot, setSavedSnapshot] = useState<SavedSnapshot>({})
  const [loadedMatchIds, setLoadedMatchIds] = useState<Set<string>>(new Set())
  const [loadingMatchId, setLoadingMatchId] = useState<string | null>(null)
  const [savingPreds, setSavingPreds] = useState(false)
  const [savedPreds, setSavedPreds] = useState(false)
  const [draftRestoredBanner, setDraftRestoredBanner] = useState(false)
  const [draftInitialized, setDraftInitialized] = useState(false)

  const predGridRef = useRef(predGrid)
  predGridRef.current = predGrid
  const savedSnapshotRef = useRef(savedSnapshot)
  savedSnapshotRef.current = savedSnapshot
  const selectedMatchIdsRef = useRef(selectedMatchIds)
  selectedMatchIdsRef.current = selectedMatchIds
  const participantsRef = useRef(participants)
  participantsRef.current = participants
  const loadedMatchIdsRef = useRef(loadedMatchIds)
  loadedMatchIdsRef.current = loadedMatchIds

  const visibleMatches = useMemo(() => filterTodayTomorrowMatches(matches), [matches])
  const selectedMatches = useMemo(
    () => selectedMatchIds
      .map(id => matches.find(m => m.id === id))
      .filter((m): m is MatchForGrid => !!m),
    [selectedMatchIds, matches],
  )

  const participantIds = useMemo(() => participants.map(p => p.id), [participants])

  const persistDraftNow = useCallback(() => {
    const grid = predGridRef.current
    if (!hasDraftGridContent(grid) && selectedMatchIdsRef.current.length === 0) {
      clearUnifiedDraft()
      return
    }
    const draft: UnifiedPredDraft = {
      selectedMatchIds: selectedMatchIdsRef.current,
      predGrid: grid,
      savedSnapshot: savedSnapshotRef.current,
      updatedAt: new Date().toISOString(),
    }
    saveUnifiedDraft(draft)
  }, [])

  const fetchMatchPredictions = useCallback(async (matchId: string) => {
    if (loadedMatchIdsRef.current.has(matchId)) return

    setLoadingMatchId(matchId)
    const { data, error } = await supabase.rpc('admin_get_match_predictions', {
      admin_pin: ADMIN_PIN,
      p_match_id: matchId,
    })

    if (error) {
      onError(error.message)
      setLoadingMatchId(null)
      return
    }

    const rows = (data ?? []) as Array<{
      participant_id: string
      predicted_home: number
      predicted_away: number
    }>

    const merged = mergeDbRowsIntoGrid(
      predGridRef.current,
      savedSnapshotRef.current,
      matchId,
      rows,
      participantsRef.current.map(p => p.id),
    )
    setPredGrid(merged.predGrid)
    setSavedSnapshot(merged.savedSnapshot)

    setLoadedMatchIds(prev => new Set(prev).add(matchId))
    setLoadingMatchId(null)
  }, [onError])

  // Restore draft on mount
  useEffect(() => {
    if (draftInitialized || participants.length === 0) return

    const draft = loadDraftWithMigration()
    if (draft) {
      const ensured = ensureParticipantKeys(
        draft.predGrid,
        draft.savedSnapshot,
        participants.map(p => p.id),
      )
      setPredGrid(ensured.predGrid)
      setSavedSnapshot(ensured.savedSnapshot)
      setSelectedMatchIds(draft.selectedMatchIds.filter(id =>
        matches.some(m => m.id === id),
      ))
      setDraftRestoredBanner(true)
      for (const matchId of draft.selectedMatchIds) {
        loadedMatchIdsRef.current.add(matchId)
        setLoadedMatchIds(prev => new Set(prev).add(matchId))
      }
    } else {
      const ensured = ensureParticipantKeys({}, {}, participants.map(p => p.id))
      setPredGrid(ensured.predGrid)
      setSavedSnapshot(ensured.savedSnapshot)
    }

    setDraftInitialized(true)
  }, [draftInitialized, participants, matches])

  // Fetch DB preds for newly selected matches
  useEffect(() => {
    if (!draftInitialized) return
    for (const matchId of selectedMatchIds) {
      if (!loadedMatchIds.has(matchId)) {
        void fetchMatchPredictions(matchId)
      }
    }
  }, [draftInitialized, selectedMatchIds, loadedMatchIds, fetchMatchPredictions])

  // Ensure participant keys when list changes
  useEffect(() => {
    if (!draftInitialized || participantIds.length === 0) return
    setPredGrid(prev => ensureParticipantKeys(prev, savedSnapshotRef.current, participantIds).predGrid)
    setSavedSnapshot(prev => ensureParticipantKeys(predGridRef.current, prev, participantIds).savedSnapshot)
  }, [draftInitialized, participantIds.join(',')])

  // Auto-save draft every 10s
  useEffect(() => {
    if (!draftInitialized) return
    const interval = setInterval(() => {
      if (hasDraftGridContent(predGridRef.current) || selectedMatchIdsRef.current.length > 0) {
        persistDraftNow()
      }
    }, 10_000)
    return () => clearInterval(interval)
  }, [draftInitialized, persistDraftNow])

  // beforeunload warning + flush
  useEffect(() => {
    if (!draftInitialized) return
    const handler = (e: BeforeUnloadEvent) => {
      persistDraftNow()
      if (hasUnsavedChanges(
        predGridRef.current,
        savedSnapshotRef.current,
        selectedMatchIdsRef.current,
      )) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [draftInitialized, persistDraftNow])

  function toggleMatch(matchId: string) {
    setSelectedMatchIds(prev => {
      if (prev.includes(matchId)) {
        persistDraftNow()
        return prev.filter(id => id !== matchId)
      }
      if (prev.length >= MAX_SELECTED_MATCHES) return prev
      persistDraftNow()
      return [...prev, matchId]
    })
    setSavedPreds(false)
  }

  function updateCell(
    participantId: string,
    matchId: string,
    field: 'home' | 'away',
    value: string,
  ) {
    setPredGrid(prev => {
      const row = prev[participantId] ?? {}
      const cell = row[matchId] ?? { home: '', away: '' }
      return {
        ...prev,
        [participantId]: {
          ...row,
          [matchId]: { ...cell, [field]: value },
        },
      }
    })
    setSavedPreds(false)
  }

  async function saveAllPredictions() {
    if (selectedMatchIds.length === 0) return
    const rows = collectSaveRows(predGridRef.current, selectedMatchIdsRef.current)
    if (rows.length === 0) {
      onError('لا توجد توقعات كاملة للحفظ')
      return
    }

    setSavingPreds(true)
    onError('')

    const { data: upserted, error } = await supabase.rpc(
      'admin_bulk_upsert_participant_predictions',
      { admin_pin: ADMIN_PIN, p_rows: rows },
    )

    if (error) {
      onError(error.message)
      setSavingPreds(false)
      return
    }

    console.log('[admin save] bulk', { count: upserted ?? rows.length, rows: rows.length })

    setSavedSnapshot(prev => applySavedRowsToSnapshot(prev, rows))
    clearUnifiedDraft()
    setSavingPreds(false)
    setSavedPreds(true)
    setTimeout(() => setSavedPreds(false), 3000)

    const savedMatchIds = new Set(rows.map(r => r.match_id))
    let needsLeaderboardRefresh = false

    for (const matchId of savedMatchIds) {
      const match = matches.find(m => m.id === matchId)
      if (!match) continue
      if (match.status === 'finished') {
        await onRunPointsRecalc(match)
      } else if (match.status === 'live') {
        needsLeaderboardRefresh = true
      }
    }

    if (needsLeaderboardRefresh) {
      await onRefreshLeaderboard()
    }
  }

  const hasLiveSelected = selectedMatches.some(m => m.status === 'live')
  const hasFinishedSelected = selectedMatches.some(m => m.status === 'finished')
  const atSelectionCap = selectedMatchIds.length >= MAX_SELECTED_MATCHES

  return (
    <div>
      {/* Match toggles */}
      {visibleMatches.length === 0 ? (
        <p className="text-[#4b5563] text-center py-6 text-sm">لا توجد مباريات اليوم أو غداً</p>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-2 mb-3 [&::-webkit-scrollbar]:hidden">
          {visibleMatches.map(m => {
            const selected = selectedMatchIds.includes(m.id)
            const disabled = !selected && atSelectionCap
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => !disabled && toggleMatch(m.id)}
                disabled={disabled}
                className={cn(
                  'shrink-0 rounded-xl px-3 py-2 text-xs font-bold whitespace-nowrap transition-colors border',
                  selected
                    ? 'bg-[#22c55e] text-black border-[#22c55e]'
                    : 'bg-[#1f1f24] text-[#6b7280] border-[#1f1f24] hover:text-white',
                  disabled && 'opacity-40 cursor-not-allowed',
                )}
              >
                {matchToggleLabel(m)}
              </button>
            )
          })}
        </div>
      )}

      {atSelectionCap && (
        <p className="text-[#6b7280] text-xs mb-2">الحد الأقصى 3 مباريات في نفس الوقت</p>
      )}

      {hasFinishedSelected && (
        <div className="rounded-xl bg-[#0b1a10] border border-[#166534]/60 px-4 py-2.5 mb-3 flex items-center gap-2">
          <span className="text-base">✅</span>
          <span className="text-[#86efac] text-sm">مباراة منتهية — النقاط تُحسب تلقائياً عند الحفظ</span>
        </div>
      )}

      {hasLiveSelected && (
        <div className="rounded-xl bg-[#1c0505] border border-[#7f1d1d]/60 px-4 py-2.5 mb-3">
          <span className="text-[#fca5a5] text-sm">مباراة مباشرة — الحفظ يُحدّث الترتيب فوراً</span>
        </div>
      )}

      {draftRestoredBanner && (
        <div className="rounded-xl bg-[#1a1505] border border-[#854d0e]/50 px-4 py-2.5 mb-3 flex items-center justify-between gap-2">
          <span className="text-[#fcd34d] text-sm font-medium">تم استرجاع مسودة غير محفوظة</span>
          <button
            type="button"
            onClick={() => setDraftRestoredBanner(false)}
            className="text-[#fcd34d]/70 hover:text-[#fcd34d] text-xs shrink-0"
          >
            إغلاق
          </button>
        </div>
      )}

      {selectedMatchIds.length === 0 && (
        <p className="text-[#4b5563] text-center py-10 text-sm">اختر مباراة واحدة أو أكثر لإدخال التوقعات</p>
      )}

      {loadingMatchId && selectedMatchIds.includes(loadingMatchId) && (
        <div className="space-y-2 mb-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-12 rounded-xl bg-[#111115] animate-pulse" />
          ))}
        </div>
      )}

      {selectedMatchIds.length > 0 && participants.length === 0 && (
        <p className="text-[#4b5563] text-center py-10 text-sm">أضف مشاركين أولاً من تبويب &quot;المشاركون&quot;</p>
      )}

      {selectedMatchIds.length > 0 && participants.length > 0 && (
        <>
          <div className="rounded-xl border border-[#1f1f24] bg-[#0a0a0a] overflow-hidden mb-4">
            <div className="overflow-x-auto overscroll-contain max-h-[min(65vh,560px)] overflow-y-auto">
              <table className="w-full min-w-max border-collapse" dir="rtl">
                <thead>
                  <tr className="border-b border-[#1f1f24] bg-[#0a0a0a]/95">
                    <th className="sticky right-0 z-20 bg-[#0a0a0a] px-3 py-2 text-right text-[10px] text-[#64748b] font-semibold min-w-[88px]">
                      الاسم
                    </th>
                    {selectedMatches.map(m => (
                      <th
                        key={m.id}
                        className="px-2 py-2 text-center min-w-[96px] border-r border-[#1f1f24]/60"
                      >
                        <div className="text-[10px] text-[#94a3b8] font-bold leading-tight truncate max-w-[92px] mx-auto">
                          {m.home_team} vs {m.away_team}
                        </div>
                        <div className="flex items-center justify-center gap-1 mt-1">
                          <span className="w-10 text-[9px] text-[#64748b] truncate">{m.home_team}</span>
                          <span className="text-[9px] text-transparent">-</span>
                          <span className="w-10 text-[9px] text-[#64748b] truncate">{m.away_team}</span>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {participants.map(p => (
                    <tr key={p.id} className="border-b border-[#1f1f24]/50 last:border-0">
                      <td className="sticky right-0 z-10 bg-[#0a0a0a] px-3 py-2 text-white text-sm font-medium truncate max-w-[100px]">
                        {p.name}
                      </td>
                      {selectedMatches.map(m => {
                        const cell = getCell(predGrid, p.id, m.id)
                        const saved = isCellSaved(predGrid, savedSnapshot, p.id, m.id)
                        return (
                          <td
                            key={m.id}
                            className={cn(
                              'px-2 py-2 border-r border-[#1f1f24]/40',
                              saved ? 'bg-[#0b1a10]' : 'bg-transparent',
                            )}
                          >
                            <div
                              className={cn(
                                'flex items-center justify-center gap-1 rounded-lg px-1 py-1',
                                saved && 'border border-[#166534]/60',
                              )}
                            >
                              <input
                                type="number"
                                inputMode="numeric"
                                min={0}
                                max={20}
                                value={cell.home}
                                onChange={e => updateCell(p.id, m.id, 'home', e.target.value)}
                                placeholder="-"
                                className="w-10 h-9 bg-[#111115] border border-[#1f1f24] text-white text-center text-sm font-bold rounded-md outline-none focus:border-[#22c55e]"
                              />
                              <span className="text-[#374151] font-bold text-xs">-</span>
                              <input
                                type="number"
                                inputMode="numeric"
                                min={0}
                                max={20}
                                value={cell.away}
                                onChange={e => updateCell(p.id, m.id, 'away', e.target.value)}
                                placeholder="-"
                                className="w-10 h-9 bg-[#111115] border border-[#1f1f24] text-white text-center text-sm font-bold rounded-md outline-none focus:border-[#22c55e]"
                              />
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {savedPreds ? (
            <div className="h-12 flex items-center justify-center text-[#22c55e] font-bold text-sm gap-2 rounded-xl bg-[#0b1a10] border border-[#166534]/60">
              تم الحفظ بنجاح ✓
            </div>
          ) : (
            <button
              type="button"
              onClick={saveAllPredictions}
              disabled={savingPreds || selectedMatchIds.length === 0}
              className="w-full h-12 rounded-xl bg-[#14532d] text-[#86efac] font-bold text-sm disabled:opacity-50"
            >
              {savingPreds ? 'جاري الحفظ...' : 'حفظ الكل'}
            </button>
          )}
        </>
      )}
    </div>
  )
}
