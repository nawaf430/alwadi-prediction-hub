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
  const matchesRef = useRef(matches)
  matchesRef.current = matches

  const visibleMatches = useMemo(() => filterTodayTomorrowMatches(matches), [matches])
  const visibleMatchIds = useMemo(
    () => new Set(visibleMatches.map(m => m.id)),
    [visibleMatches],
  )
  const selectedMatches = useMemo(
    () => selectedMatchIds
      .filter(id => visibleMatchIds.has(id))
      .map(id => matches.find(m => m.id === id))
      .filter((m): m is MatchForGrid => !!m),
    [selectedMatchIds, matches, visibleMatchIds],
  )
  const activeSelectedMatchIds = useMemo(
    () => selectedMatchIds.filter(id => visibleMatchIds.has(id)),
    [selectedMatchIds, visibleMatchIds],
  )

  const participantIds = useMemo(() => participants.map(p => p.id), [participants])

  const persistDraftNow = useCallback(() => {
    const visibleIds = new Set(
      filterTodayTomorrowMatches(matchesRef.current).map(m => m.id),
    )
    const selected = selectedMatchIdsRef.current.filter(id => visibleIds.has(id))
    const grid = predGridRef.current
    if (!hasDraftGridContent(grid) && selected.length === 0) {
      clearUnifiedDraft()
      return
    }
    const draft: UnifiedPredDraft = {
      selectedMatchIds: selected,
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

    const empty = ensureParticipantKeys({}, {}, participants.map(p => p.id))
    const draft = loadDraftWithMigration()
    if (draft) {
      const visibleIds = new Set(filterTodayTomorrowMatches(matches).map(m => m.id))
      const restoredSelected = draft.selectedMatchIds.filter(id => visibleIds.has(id))
      const ensured = ensureParticipantKeys(
        draft.predGrid,
        draft.savedSnapshot,
        participants.map(p => p.id),
      )
      const unsaved = restoredSelected.length > 0 && hasUnsavedChanges(
        ensured.predGrid,
        ensured.savedSnapshot,
        restoredSelected,
      )

      if (unsaved) {
        setPredGrid(ensured.predGrid)
        setSavedSnapshot(ensured.savedSnapshot)
        setSelectedMatchIds(restoredSelected)
        setDraftRestoredBanner(true)
        for (const matchId of restoredSelected) {
          loadedMatchIdsRef.current.add(matchId)
          setLoadedMatchIds(prev => new Set(prev).add(matchId))
        }
      } else {
        clearUnifiedDraft()
        setPredGrid(empty.predGrid)
        setSavedSnapshot(empty.savedSnapshot)
        setSelectedMatchIds([])
      }
    } else {
      setPredGrid(empty.predGrid)
      setSavedSnapshot(empty.savedSnapshot)
    }

    setDraftInitialized(true)
  }, [draftInitialized, participants, matches])

  // Drop matches that left today/tomorrow toggles (e.g. old localStorage draft)
  useEffect(() => {
    if (!draftInitialized) return
    const prev = selectedMatchIdsRef.current
    const next = prev.filter(id => visibleMatchIds.has(id))
    if (next.length === prev.length) return

    selectedMatchIdsRef.current = next
    setSelectedMatchIds(next)
    setDraftRestoredBanner(false)
    if (next.length === 0) {
      clearUnifiedDraft()
    } else {
      saveUnifiedDraft({
        selectedMatchIds: next,
        predGrid: predGridRef.current,
        savedSnapshot: savedSnapshotRef.current,
        updatedAt: new Date().toISOString(),
      })
    }
  }, [draftInitialized, visibleMatchIds])

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

  async function deleteCell(participantId: string, matchId: string) {
    const res = await fetch('/api/admin/delete-prediction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ admin_pin: ADMIN_PIN, participant_id: participantId, match_id: matchId }),
    })
    if (!res.ok) { onError('فشل الحذف'); return }

    setPredGrid(prev => {
      const next = { ...prev }
      if (next[participantId]) {
        next[participantId] = { ...next[participantId] }
        delete next[participantId][matchId]
      }
      return next
    })
    setSavedSnapshot(prev => {
      const next = { ...prev }
      if (next[participantId]) {
        next[participantId] = { ...next[participantId] }
        delete next[participantId][matchId]
      }
      return next
    })
  }

  async function saveAllPredictions() {
    const matchIds = selectedMatchIdsRef.current.filter(id => visibleMatchIds.has(id))
    if (matchIds.length === 0) return
    const rows = collectSaveRows(predGridRef.current, matchIds)
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

  const upcomingSorted = useMemo(() =>
    [...matches]
      .filter(m => m.status === 'not_started')
      .sort((a, b) => a.kickoff_time.localeCompare(b.kickoff_time)),
  [matches])
  const nextThreeIds = useMemo(() => new Set(upcomingSorted.slice(0, 3).map(m => m.id)), [upcomingSorted])
  const firstNextMatchId = upcomingSorted[0]?.id ?? null

  const toggleScrollRef = useRef<HTMLDivElement>(null)

  function scrollToNextMatchBtn() {
    const container = toggleScrollRef.current
    if (!container) return
    const btn = container.querySelector<HTMLElement>('[data-next-match="true"]')
    if (btn) container.scrollLeft = btn.offsetLeft - 8
  }

  return (
    <div>
      {/* Match toggles */}
      {visibleMatches.length === 0 ? (
        <p className="text-[#4b5563] text-center py-6 text-sm">لا توجد مباريات اليوم أو غداً</p>
      ) : (
        <>
          {firstNextMatchId && (
            <button
              type="button"
              onClick={scrollToNextMatchBtn}
              className="w-full h-9 rounded-xl text-xs font-bold text-[#f59e0b] border border-[#f59e0b]/30 bg-[#f59e0b]/5 hover:bg-[#f59e0b]/10 transition-colors mb-2"
            >
              ⚡ انتقل للمباريات القادمة
            </button>
          )}
          <div ref={toggleScrollRef} className="flex gap-2 overflow-x-auto pb-2 mb-3 [&::-webkit-scrollbar]:hidden">
          {visibleMatches.map(m => {
            const selected = selectedMatchIds.includes(m.id)
            const disabled = !selected && atSelectionCap
            return (
              <button
                key={m.id}
                type="button"
                data-next-match={m.id === firstNextMatchId ? 'true' : undefined}
                onClick={() => !disabled && toggleMatch(m.id)}
                disabled={disabled}
                className={cn(
                  'shrink-0 rounded-xl px-3 py-2 text-xs font-bold whitespace-nowrap transition-colors border',
                  selected
                    ? 'bg-[#22c55e] text-black border-[#22c55e]'
                    : nextThreeIds.has(m.id)
                      ? 'bg-[#1c1400] text-[#f59e0b] border-[#f59e0b]/40 hover:border-[#f59e0b]/70'
                      : 'bg-[#1f1f24] text-[#6b7280] border-[#1f1f24] hover:text-white',
                  disabled && 'opacity-40 cursor-not-allowed',
                )}
              >
                {nextThreeIds.has(m.id) && !selected ? '⚡ ' : ''}{matchToggleLabel(m)}
              </button>
            )
          })}
        </div>
        </>
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

      {activeSelectedMatchIds.length === 0 && (
        <p className="text-[#4b5563] text-center py-10 text-sm">اختر مباراة واحدة أو أكثر لإدخال التوقعات</p>
      )}

      {loadingMatchId && activeSelectedMatchIds.includes(loadingMatchId) && (
        <div className="space-y-2 mb-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-12 rounded-xl bg-[#111115] animate-pulse" />
          ))}
        </div>
      )}

      {activeSelectedMatchIds.length > 0 && participants.length === 0 && (
        <p className="text-[#4b5563] text-center py-10 text-sm">أضف مشاركين أولاً من تبويب &quot;المشاركون&quot;</p>
      )}

      {activeSelectedMatchIds.length > 0 && participants.length > 0 && (
        <>
          <div className="rounded-xl border border-[#1f1f24] bg-[#0a0a0a] overflow-hidden mb-4">
            <div className="overflow-x-auto overscroll-contain max-h-[min(60vh,520px)] sm:max-h-[min(65vh,560px)] md:max-h-[min(72vh,680px)] lg:max-h-[min(75vh,780px)] overflow-y-auto">
              <table className="w-full min-w-max border-collapse" dir="rtl">
                <thead>
                  <tr className="border-b border-[#1f1f24] bg-[#0a0a0a]/95">
                    <th className="sticky right-0 z-20 bg-[#0a0a0a] px-3 py-2 md:px-4 md:py-2.5 text-right text-[10px] md:text-xs text-[#64748b] font-semibold min-w-[88px] md:min-w-[104px] lg:min-w-[120px]">
                      الاسم
                    </th>
                    {selectedMatches.map(m => (
                      <th
                        key={m.id}
                        className="px-2 py-2 md:px-3 md:py-2.5 text-center min-w-[104px] sm:min-w-[112px] md:min-w-[136px] lg:min-w-[160px] border-r border-[#1f1f24]/60"
                      >
                        <div className="text-[10px] md:text-xs lg:text-sm text-[#94a3b8] font-bold leading-tight truncate max-w-[100px] sm:max-w-[120px] md:max-w-[140px] lg:max-w-[160px] mx-auto">
                          {m.home_team} vs {m.away_team}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {participants.map(p => (
                    <tr key={p.id} className="border-b border-[#1f1f24]/50 last:border-0">
                      <td className="sticky right-0 z-10 bg-[#0a0a0a] px-3 py-2 md:px-4 md:py-2.5 text-white text-sm md:text-base font-medium truncate max-w-[100px] md:max-w-[120px] lg:max-w-[140px]">
                        {p.name}
                      </td>
                      {selectedMatches.map(m => {
                        const cell = getCell(predGrid, p.id, m.id)
                        const saved = isCellSaved(predGrid, savedSnapshot, p.id, m.id)
                        return (
                          <td
                            key={m.id}
                            className={cn(
                              'px-2 py-2 md:px-3 md:py-2.5 border-r border-[#1f1f24]/40',
                              saved ? 'bg-[#0b1a10]' : 'bg-transparent',
                            )}
                          >
                            <div
                              className={cn(
                                'relative flex items-end justify-center gap-1.5 md:gap-2 rounded-lg px-1 py-1 md:px-1.5 md:py-1.5',
                                saved && 'border border-[#166534]/60',
                              )}
                            >
                              {saved && (
                                <button
                                  type="button"
                                  onClick={() => deleteCell(p.id, m.id)}
                                  className="absolute top-0 left-0 w-5 h-5 flex items-center justify-center rounded-full bg-[#7f1d1d] text-[#fca5a5] text-xs hover:bg-[#991b1b] transition-colors"
                                  title="حذف التوقع"
                                >×</button>
                              )}
                              <div className="flex flex-col items-center gap-0.5 md:gap-1">
                                <span
                                  className="text-[9px] md:text-[10px] lg:text-xs text-[#64748b] font-semibold truncate max-w-[44px] sm:max-w-[52px] md:max-w-[64px] lg:max-w-[80px]"
                                  title={m.home_team}
                                >
                                  {m.home_team}
                                </span>
                                <input
                                  type="number"
                                  inputMode="numeric"
                                  min={0}
                                  max={20}
                                  value={cell.home}
                                  onChange={e => updateCell(p.id, m.id, 'home', e.target.value)}
                                  placeholder="-"
                                  className="w-10 h-9 sm:w-11 sm:h-10 md:w-12 md:h-11 lg:w-14 lg:h-12 bg-[#111115] border border-[#1f1f24] text-white text-center text-sm md:text-base lg:text-lg font-bold rounded-md md:rounded-lg outline-none focus:border-[#22c55e]"
                                />
                              </div>
                              <span className="text-[#374151] font-bold text-xs md:text-sm pb-2 md:pb-2.5">-</span>
                              <div className="flex flex-col items-center gap-0.5 md:gap-1">
                                <span
                                  className="text-[9px] md:text-[10px] lg:text-xs text-[#64748b] font-semibold truncate max-w-[44px] sm:max-w-[52px] md:max-w-[64px] lg:max-w-[80px]"
                                  title={m.away_team}
                                >
                                  {m.away_team}
                                </span>
                                <input
                                  type="number"
                                  inputMode="numeric"
                                  min={0}
                                  max={20}
                                  value={cell.away}
                                  onChange={e => updateCell(p.id, m.id, 'away', e.target.value)}
                                  placeholder="-"
                                  className="w-10 h-9 sm:w-11 sm:h-10 md:w-12 md:h-11 lg:w-14 lg:h-12 bg-[#111115] border border-[#1f1f24] text-white text-center text-sm md:text-base lg:text-lg font-bold rounded-md md:rounded-lg outline-none focus:border-[#22c55e]"
                                />
                              </div>
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
              disabled={savingPreds || activeSelectedMatchIds.length === 0}
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
