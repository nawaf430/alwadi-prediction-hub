'use client'

import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { flag } from '@/lib/flags'
import type { MatchGoalEvent } from '@/lib/365scores-api'

type MatchCard = {
  id: string
  home_team: string
  away_team: string
  kickoff_time: string
  home_score: number | null
  away_score: number | null
  status: string
  match_minute: string | null
  match_events: MatchGoalEvent[] | null
}

type LivePred = {
  name: string
  predicted_home: number
  predicted_away: number
}

type PredsMap = Map<string, LivePred[]>

// ── Helpers ─────────────────────────────────────────────────────────────────

function fmtKSAKickoff(utcIso: string): string {
  const d = new Date(utcIso)
  const weekday = d.toLocaleString('ar-SA', { timeZone: 'Asia/Riyadh', weekday: 'long' })
  const day     = d.toLocaleString('ar-SA', { timeZone: 'Asia/Riyadh', day: 'numeric' })
  const month   = d.toLocaleString('ar-SA', { timeZone: 'Asia/Riyadh', month: 'long' })
  const time    = d.toLocaleString('ar-SA', { timeZone: 'Asia/Riyadh', hour: 'numeric', minute: '2-digit', hour12: true })
  return `${weekday} · ${day} ${month} · ${time}`
}

function outcome(h: number, a: number): 'home' | 'draw' | 'away' {
  return h > a ? 'home' : h < a ? 'away' : 'draw'
}

type ChipStatus = 'exact' | 'correct' | 'amber' | 'wrong' | 'pending'

function chipStatus(
  pred: LivePred,
  liveOutcome: 'home' | 'draw' | 'away' | null,
  match: { home_score: number | null; away_score: number | null } | null,
): ChipStatus {
  if (liveOutcome === null) return 'pending'
  if (pred.predicted_home === match?.home_score && pred.predicted_away === match?.away_score) {
    return 'exact'
  }
  const predOut = outcome(pred.predicted_home, pred.predicted_away)
  if (predOut === liveOutcome) return 'correct'
  if (predOut === 'draw' && liveOutcome === 'draw') return 'amber'
  console.log(
    '[LiveMatchCard] chip debug', pred.name,
    `pred:${pred.predicted_home}-${pred.predicted_away}`,
    `live:${match?.home_score ?? '?'}-${match?.away_score ?? '?'}`,
    `→ wrong`,
  )
  return 'wrong'
}

/** Returns [now, now+12h] for the upcoming-matches window */
function next12hRange(): [string, string] {
  const now = new Date()
  const end = new Date(now.getTime() + 12 * 60 * 60 * 1000)
  return [now.toISOString(), end.toISOString()]
}

/** Returns [now-4h, now] — recently-finished matches (by kickoff time) stay visible this long */
function past4hRange(): [string, string] {
  const now = new Date()
  const start = new Date(now.getTime() - 4 * 60 * 60 * 1000)
  return [start.toISOString(), now.toISOString()]
}

const MATCH_SELECT_WITH_MINUTE =
  'id, home_team, away_team, kickoff_time, home_score, away_score, status, match_minute, match_events'
const MATCH_SELECT_BASE =
  'id, home_team, away_team, kickoff_time, home_score, away_score, status'

function normalizeMatchRow(m: unknown): MatchCard {
  const row = m as MatchCard & { match_minute?: string | null; match_events?: MatchGoalEvent[] | null }
  const events = row.match_events
  return {
    id: row.id,
    home_team: row.home_team,
    away_team: row.away_team,
    kickoff_time: row.kickoff_time,
    home_score: row.home_score,
    away_score: row.away_score,
    status: row.status,
    match_minute: row.match_minute ?? null,
    match_events: Array.isArray(events) ? events : null,
  }
}

const MAX_GOALS_DISPLAY = 6

// ── Single card (pure render) ────────────────────────────────────────────────

const CHIP_STYLES: Record<ChipStatus, string> = {
  exact:   'bg-gradient-to-r from-[#fde68a] via-[#fbbf24] to-[#f59e0b] border border-[#fde68a] text-[#3a2a00] font-bold shadow-[0_0_10px_rgba(251,191,36,0.65)]',
  correct: 'bg-[rgba(34,197,94,0.12)] border border-[rgba(34,197,94,0.25)] text-[#4ade80]',
  amber:   'bg-[rgba(245,158,11,0.12)] border border-[rgba(245,158,11,0.25)] text-[#fbbf24]',
  wrong:   'bg-[rgba(239,68,68,0.10)] border border-[rgba(239,68,68,0.20)] text-[#f87171]',
  pending: 'bg-[rgba(148,163,184,0.08)] border border-[rgba(148,163,184,0.15)] text-[#94a3b8]',
}
const CHIP_ICON: Record<ChipStatus, string> = { exact: '⭐', correct: '✓', amber: '~', wrong: '✗', pending: '·' }

function MatchCardUI({ match, preds }: { match: MatchCard; preds: LivePred[] }) {
  const isLive = match.status === 'live'
  const isFinished = match.status === 'finished'
  const hasResult = isLive || isFinished
  const liveOutcome =
    hasResult && match.home_score !== null && match.away_score !== null
      ? outcome(match.home_score, match.away_score)
      : null
  const goals = match.match_events ?? []
  const visibleGoals = goals.slice(0, MAX_GOALS_DISPLAY)
  const hiddenGoals = goals.length - visibleGoals.length

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{
        background: 'linear-gradient(135deg, #0c1628 0%, #0f1e3d 100%)',
        border: '1px solid #1e3a6e',
      }}
    >
      <div style={{ height: 2, background: 'linear-gradient(90deg, transparent, #3b82f6, transparent)' }} />

      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          {isLive ? (
            <span
              className="flex items-center gap-1.5 text-xs font-bold text-[#fca5a5] px-2.5 py-1 rounded-full"
              style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)' }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full bg-[#ef4444] shrink-0"
                style={{ boxShadow: '0 0 6px #ef4444' }}
              />
              مباشر{match.match_minute ? ` · ${match.match_minute}` : ''}
            </span>
          ) : isFinished ? (
            <span
              className="text-xs font-bold text-[#94a3b8] px-2.5 py-1 rounded-full"
              style={{ background: 'rgba(148,163,184,0.10)', border: '1px solid rgba(148,163,184,0.25)' }}
            >
              انتهت المباراة
            </span>
          ) : (
            <span
              className="text-xs font-bold text-[#94a3b8] px-2.5 py-1 rounded-full"
              style={{ background: 'rgba(59,130,246,0.10)', border: '1px solid rgba(59,130,246,0.25)' }}
            >
              مباراة اليوم
            </span>
          )}
          <span className="text-[#94a3b8] text-xs text-left leading-relaxed">
            {fmtKSAKickoff(match.kickoff_time)}
          </span>
        </div>

        {hasResult ? (
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 flex-1 justify-end min-w-0">
              <span className="text-[#e2e8f0] font-bold text-sm truncate">{match.home_team}</span>
              <span className="text-base shrink-0">{flag(match.home_team)}</span>
            </div>
            <span className={cn('font-black text-2xl tabular-nums px-3 shrink-0 tracking-tight', isFinished ? 'text-[#94a3b8]' : 'text-[#60a5fa]')}>
              {match.home_score ?? 0} - {match.away_score ?? 0}
            </span>
            <div className="flex items-center gap-1.5 flex-1 justify-start min-w-0">
              <span className="text-base shrink-0">{flag(match.away_team)}</span>
              <span className="text-[#e2e8f0] font-bold text-sm truncate">{match.away_team}</span>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 flex-1 justify-end min-w-0">
              <span className="text-[#e2e8f0] font-bold text-sm truncate">{match.home_team}</span>
              <span className="text-base shrink-0">{flag(match.home_team)}</span>
            </div>
            <span className="text-[#2a3a55] font-bold text-sm px-3 shrink-0">vs</span>
            <div className="flex items-center gap-1.5 flex-1 justify-start min-w-0">
              <span className="text-base shrink-0">{flag(match.away_team)}</span>
              <span className="text-[#e2e8f0] font-bold text-sm truncate">{match.away_team}</span>
            </div>
          </div>
        )}

        {hasResult && visibleGoals.length > 0 && (
          <div
            className="mt-3 pt-3 space-y-1.5"
            style={{ borderTop: '1px solid rgba(30,58,110,0.35)' }}
          >
            {visibleGoals.map((g, i) => (
              <div
                key={`${g.minute}-${g.player}-${i}`}
                className="flex items-center gap-2 text-[11px] text-[#94a3b8]"
                dir="rtl"
              >
                <span className="shrink-0">⚽</span>
                <span className="text-[#60a5fa] font-bold tabular-nums shrink-0">{g.minute}</span>
                <span className="text-[#e2e8f0] font-medium truncate">
                  {g.player}
                  <span className="text-[#64748b] font-normal">
                    {' '}({g.side === 'home' ? match.home_team : match.away_team})
                  </span>
                </span>
              </div>
            ))}
            {hiddenGoals > 0 && (
              <p className="text-[10px] text-[#64748b] pr-6">+{hiddenGoals} أهداف أخرى</p>
            )}
          </div>
        )}
      </div>

      {hasResult && preds.length > 0 && (
        <div
          className="px-4 pt-2.5 pb-3"
          style={{ borderTop: '1px solid rgba(30,58,110,0.5)' }}
        >
          <p className="text-[#2a3a55] text-[10px] font-semibold mb-2 uppercase tracking-wider">
            توقعات اللاعبين
          </p>
          <div className="flex flex-wrap gap-1.5">
            {preds.map(pred => {
              const status = chipStatus(pred, liveOutcome, match)
              return (
                <span
                  key={pred.name}
                  className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1', CHIP_STYLES[status])}
                >
                  <span>{pred.name}</span>
                  <span className="opacity-60 text-[9px]">{pred.predicted_home}-{pred.predicted_away}</span>
                  <span>{CHIP_ICON[status]}</span>
                </span>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────────────────

export function LiveMatchCard() {
  const [matches, setMatches]       = useState<MatchCard[]>([])
  const [predsMap, setPredsMap]     = useState<PredsMap>(new Map())
  const [initialized, setInitialized] = useState(false)

  // Refs so realtime callback reads latest state without stale closures
  const matchesRef = useRef<MatchCard[]>([])
  useEffect(() => { matchesRef.current = matches }, [matches])

  async function fetchPredsForMatch(matchId: string): Promise<LivePred[]> {
    const [userRes, partRes] = await Promise.all([
      supabase
        .from('predictions')
        .select('predicted_home, predicted_away, profiles(username)')
        .eq('match_id', matchId),
      supabase
        .from('participant_predictions')
        .select('predicted_home, predicted_away, participants(name)')
        .eq('match_id', matchId),
    ])

    const combined: LivePred[] = []

    userRes.data?.forEach(p => {
      const prof = Array.isArray(p.profiles)
        ? (p.profiles as { username: string }[])[0]
        : (p.profiles as { username: string } | null)
      if (prof?.username) {
        combined.push({ name: prof.username, predicted_home: p.predicted_home, predicted_away: p.predicted_away })
      }
    })

    partRes.data?.forEach(p => {
      const part = Array.isArray(p.participants)
        ? (p.participants as { name: string }[])[0]
        : (p.participants as { name: string } | null)
      if (part?.name) {
        combined.push({ name: part.name, predicted_home: p.predicted_home, predicted_away: p.predicted_away })
      }
    })

    return combined.sort((a, b) => a.name.localeCompare(b.name, 'ar'))
  }

  async function fetchAllMatches() {
    const [windowStart, windowEnd] = next12hRange()
    const [finishedStart, finishedEnd] = past4hRange()

    let selectCols = MATCH_SELECT_WITH_MINUTE
    let liveRes = await supabase
      .from('matches')
      .select(selectCols)
      .eq('status', 'live')
      .order('kickoff_time', { ascending: true })

    if (liveRes.error?.message?.includes('match_minute') || liveRes.error?.message?.includes('match_events')) {
      selectCols = MATCH_SELECT_BASE
      liveRes = await supabase
        .from('matches')
        .select(selectCols)
        .eq('status', 'live')
        .order('kickoff_time', { ascending: true })
    }

    const finishedRes = await supabase
      .from('matches')
      .select(selectCols)
      .eq('status', 'finished')
      .gte('kickoff_time', finishedStart)
      .lt('kickoff_time', finishedEnd)
      .order('kickoff_time', { ascending: false })

    const upcomingRes = await supabase
      .from('matches')
      .select(selectCols)
      .eq('status', 'not_started')
      .gte('kickoff_time', windowStart)
      .lt('kickoff_time', windowEnd)
      .order('kickoff_time', { ascending: true })

    const liveMatchesData = (liveRes.data ?? []).map(normalizeMatchRow)

    let allMatches: MatchCard[] = [
      ...liveMatchesData,
      ...(finishedRes.data ?? []).map(normalizeMatchRow),
      ...(upcomingRes.data ?? []).map(normalizeMatchRow),
    ]

    // Fallback to API route (service-role, bypasses RLS) when the anon client
    // returns nothing — e.g. anonymous users on /public/leaderboard.
    if (allMatches.length === 0) {
      try {
        const res  = await fetch('/api/public/match-card', { cache: 'no-store' })
        const json = await res.json() as { matches?: MatchCard[] }
        if (json.matches?.length) {
          // API already returns live-first ordering
          allMatches = json.matches
        }
      } catch {
        // ignore
      }
    }

    setMatches(allMatches)

    // Fetch predictions for every live or recently-finished match in parallel
    const matchesNeedingPreds = allMatches.filter(m => m.status === 'live' || m.status === 'finished')
    const predResults = await Promise.all(
      matchesNeedingPreds.map(m => fetchPredsForMatch(m.id).then(p => [m.id, p] as const))
    )
    const newMap: PredsMap = new Map(predResults)
    setPredsMap(newMap)

    setInitialized(true)
  }

  // Ref for polling: only poll when there is at least one live match
  const hasLiveRef = useRef(false)
  useEffect(() => {
    hasLiveRef.current = matches.some(m => m.status === 'live')
  }, [matches])

  useEffect(() => {
    fetchAllMatches()

    const scoreRefreshInterval = setInterval(async () => {
      if (!hasLiveRef.current) return
      try {
        await fetch('/api/public/score-refresh', { cache: 'no-store' })
      } catch {
        // ignore
      }
    }, 45_000)

    const dbRefetchInterval = setInterval(async () => {
      try {
        await fetchAllMatches()
      } catch {
        // ignore
      }
    }, 30_000)

    const channel = supabase
      .channel('live-match-card-' + Math.random().toString(36).slice(2))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches' }, async (payload) => {
        const updated = payload.new as MatchCard
        const current = matchesRef.current
        const existing = current.find(m => m.id === updated.id)

        if (existing) {
          const statusChanged = existing.status !== updated.status
          if (statusChanged) {
            // Any status transition (→ live, → finished) → full re-fetch so the
            // live-first list is always rebuilt correctly. Never miss a live match.
            await fetchAllMatches()
          } else {
            // Score / minute / goals change on a known match → patch in-place (smooth, no flicker)
            setMatches(prev => prev.map(m =>
              m.id === updated.id ? normalizeMatchRow({ ...m, ...updated }) : m,
            ))
          }
        } else if (updated.status === 'live') {
          // A match we weren't tracking just went live → re-fetch full list
          await fetchAllMatches()
        }
      })
      // A brand-new row inserted directly as live must also surface immediately
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'matches' }, async (payload) => {
        const inserted = payload.new as MatchCard
        if (inserted.status === 'live') await fetchAllMatches()
      })
      .subscribe()

    return () => {
      clearInterval(scoreRefreshInterval)
      clearInterval(dbRefetchInterval)
      supabase.removeChannel(channel)
    }
  }, [])

  if (!initialized || matches.length === 0) return null

  return (
    <div className="flex flex-col gap-3 mb-4">
      {matches.map(match => (
        <MatchCardUI
          key={match.id}
          match={match}
          preds={predsMap.get(match.id) ?? []}
        />
      ))}
    </div>
  )
}
