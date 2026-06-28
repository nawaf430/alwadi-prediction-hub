'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { MobileShell } from '@/components/MobileShell'
import { cn } from '@/lib/utils'
import { fetchCombinedLeaderboard, type LeaderboardEntry } from '@/lib/leaderboard'
import { LiveMatchCard } from '@/components/LiveMatchCard'

const RANK_MEDALS = ['🏆', '🥈', '🥉']

export default function Leaderboard() {
  const router = useRouter()
  const [players, setPlayers] = useState<LeaderboardEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [currentUsername, setCurrentUsername] = useState<string | null>(null)

  const rowRefs = useRef<Map<string, HTMLElement>>(new Map())
  const beforeSnapshot = useRef<Map<string, number> | undefined>(undefined)

  function animatedSetPlayers(newData: LeaderboardEntry[]) {
    const snapshot = new Map<string, number>()
    rowRefs.current.forEach((el, name) => { snapshot.set(name, el.getBoundingClientRect().top) })
    if (snapshot.size > 0) beforeSnapshot.current = snapshot
    setPlayers(newData)
  }

  useLayoutEffect(() => {
    if (!beforeSnapshot.current) return
    const snap = beforeSnapshot.current
    beforeSnapshot.current = undefined
    rowRefs.current.forEach((el, name) => {
      const before = snap.get(name)
      if (before === undefined) return
      const after = el.getBoundingClientRect().top
      const dy = before - after
      if (Math.abs(dy) < 2) return
      el.style.transform = `translateY(${dy}px)`
      el.style.transition = 'none'
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          el.style.transform = 'translateY(0px)'
          el.style.transition = 'transform 600ms ease-in-out'
          el.addEventListener('transitionend', () => { el.style.transform = ''; el.style.transition = '' }, { once: true })
        })
      })
    })
  }, [players])

  function setRowRef(name: string, el: HTMLElement | null) {
    if (el) rowRefs.current.set(name, el)
    else rowRefs.current.delete(name)
  }

  useEffect(() => {
    const channel = supabase
      .channel('leaderboard-' + Math.random())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'participants' }, load)
      // Live re-ranking: when a live match score/status changes, recompute projected
      // points and re-sort immediately (the FLIP animation handles the row movement).
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches' }, load)
      .subscribe()

    async function init() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.push('/'); setLoading(false); return }
      const username = session.user.user_metadata?.username as string | undefined
      if (username) setCurrentUsername(username)
      await load()
    }

    async function load() {
      const entries = await fetchCombinedLeaderboard()
      animatedSetPlayers(entries)
      setLoading(false)
    }

    init()
    return () => { supabase.removeChannel(channel) }
  }, [])

  if (loading) {
    return (
      <MobileShell bgClassName="bg-[#080b12]">
        <div className="mb-4 mt-2">
          <div className="h-6 w-24 rounded-lg bg-[#1a2035] animate-pulse mb-2" />
          <div className="h-3 w-44 rounded-lg bg-[#1a2035] animate-pulse" />
        </div>
        <div className="grid grid-cols-3 gap-2 mb-4">
          <div className="h-28 rounded-2xl bg-[#0d1220] animate-pulse border border-[#1a2035]" />
          <div className="h-36 rounded-2xl bg-[#0c1628] animate-pulse border border-[#1a2035]" />
          <div className="h-28 rounded-2xl bg-[#0d1220] animate-pulse border border-[#1a2035]" />
        </div>
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-16 rounded-xl bg-[#0d1220] animate-pulse border border-[#1a2035]" />
          ))}
        </div>
      </MobileShell>
    )
  }

  const podium = players.slice(0, 3)
  const rest = players.slice(3)

  return (
    <MobileShell bgClassName="bg-[#080b12]">
      <LiveMatchCard />

      {/* ── Header ──────────────────────────────────────── */}
      <div
        className="rounded-2xl px-4 py-3 mb-4"
        style={{ background: 'linear-gradient(135deg, #0d1220 0%, #080b12 100%)', border: '1px solid #1a2035' }}
      >
        <h1 className="text-xl font-bold text-[#e2e8f0]">الترتيب</h1>
        <p className="text-[#2a3a55] text-sm mt-0.5">
          كأس العالم 2026 · {players.length} مشارك
        </p>
      </div>

      {/* ── Horizontal podium ───────────────────────────── */}
      {podium.length > 0 && (
        <div className="grid grid-cols-[1fr_1.15fr_1fr] gap-2 mb-3 items-end">
          {[podium[1], podium[0], podium[2]].map((player, slot) => {
            if (!player) return <div key={slot} />
            const rank = slot === 1 ? 0 : slot === 0 ? 1 : 2
            const isMe = currentUsername === player.name
            const isFirst = rank === 0

            return (
              <div
                key={player.name}
                ref={el => setRowRef(player.name, el)}
                className={cn(
                  'rounded-2xl overflow-hidden flex flex-col items-center text-center px-2 gap-1',
                  isFirst ? 'pt-6 pb-5' : 'pt-4 pb-4',
                )}
                style={isFirst ? {
                  background: 'linear-gradient(160deg, #0f2044 0%, #0c1628 100%)',
                  border: `1px solid ${isMe ? '#3b82f6' : '#2563eb'}`,
                  boxShadow: isMe ? '0 0 16px rgba(59,130,246,0.2)' : undefined,
                } : {
                  background: '#0d1220',
                  border: `1px solid ${isMe ? '#3b82f6' : '#1a2540'}`,
                }}
              >
                {/* Top gradient line for #1 */}
                {isFirst && (
                  <div
                    className="absolute inset-x-0 top-0 h-0.5 rounded-t-2xl"
                    style={{ background: 'linear-gradient(90deg, transparent, #3b82f6, transparent)' }}
                  />
                )}
                <span className="text-xl leading-none mb-0.5">{RANK_MEDALS[rank]}</span>
                <div
                  className={cn('rounded-full flex items-center justify-center shrink-0', isFirst ? 'w-12 h-12' : 'w-9 h-9')}
                  style={isFirst ? {
                    background: 'linear-gradient(135deg, #1d4ed8, #3b82f6)',
                    boxShadow: '0 0 16px rgba(59,130,246,0.4)',
                  } : { background: '#1a2035' }}
                >
                  <span className="text-[#e2e8f0] font-bold text-sm">{player.name.charAt(0)}</span>
                </div>
                <div className="w-full min-w-0 mt-0.5">
                  <p className={cn(
                    'font-bold text-xs leading-tight truncate w-full',
                    isFirst ? 'text-[#e2e8f0]' : 'text-[#94a3b8]'
                  )}>
                    {player.name}
                  </p>
                  {isMe && (
                    <span
                      className="text-[9px] font-bold text-[#60a5fa] px-1.5 py-0.5 rounded-full"
                      style={{ background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)' }}
                    >أنت</span>
                  )}
                </div>
                <p className={cn(
                  'font-black tabular-nums leading-none mt-0.5',
                  isFirst ? 'text-3xl text-[#60a5fa]' : 'text-2xl text-[#94a3b8]'
                )}>
                  {player.total_points + player.live_points}
                </p>
                <p className="text-[10px] text-[#2a3a55] -mt-0.5">نقطة</p>
                {player.live_points > 0 && (
                  <span
                    className="text-[9px] font-bold px-1.5 py-0.5 rounded-full animate-pulse"
                    style={{ background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.3)', color: '#4ade80' }}
                  >
                    +{player.live_points} مباشر
                  </span>
                )}
                <p className="text-[9px] text-[#94a3b8] mt-0.5">
                  توقع صحيح {player.exact_scores}
                </p>
              </div>
            )
          })}
        </div>
      )}

      {/* Gradient separator */}
      {podium.length > 0 && rest.length > 0 && (
        <div className="h-px mb-3" style={{ background: 'linear-gradient(90deg, transparent, #1a2035, transparent)' }} />
      )}

      {/* ── List ranks 4+ ────────────────────────────────── */}
      {rest.length > 0 && (
        <div className="space-y-1.5 mb-4">
          {/* Header */}
          <div className="grid grid-cols-[2rem_1fr_4rem_2.5rem] gap-2 px-3 pb-1">
            <span className="text-xs text-[#4b5563] text-center font-medium">#</span>
            <span className="text-xs text-[#6b7280] font-medium">الاسم</span>
            <span className="text-xs text-[#60a5fa] text-center font-semibold">توقع صحيح</span>
            <span className="text-xs text-[#6b7280] text-left font-medium">نقاط</span>
          </div>

          {rest.map((player, i) => {
            const isMe = currentUsername === player.name
            const globalRank = i + 4
            return (
              <div
                key={player.name}
                ref={el => setRowRef(player.name, el)}
                className="grid grid-cols-[2rem_1fr_4rem_2.5rem] gap-2 items-center px-3 py-3 rounded-xl"
                style={isMe ? {
                  background: 'linear-gradient(135deg, #0c1e3d 0%, #0d1628 100%)',
                  border: '1px solid #1d4ed8',
                  boxShadow: '0 0 12px rgba(59,130,246,0.12)',
                } : {
                  background: '#0d1220',
                  border: '1px solid #1a2035',
                }}
              >
                <span className="text-xs font-mono text-[#2a3a55] text-center tabular-nums">
                  {String(globalRank).padStart(2, '0')}
                </span>

                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className={cn('text-sm font-semibold truncate', isMe ? 'text-[#60a5fa]' : 'text-[#e2e8f0]')}>
                      {player.name}
                    </span>
                    {isMe && (
                      <span
                        className="shrink-0 text-[9px] font-bold text-[#60a5fa] px-1.5 py-0.5 rounded-full"
                        style={{ background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)' }}
                      >أنت</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <p className="text-[10px] text-[#2a3a55]">
                      عدد التوقعات: {player.prediction_count}
                    </p>
                    {player.live_points > 0 && (
                      <span
                        className="text-[9px] font-bold px-1.5 py-0.5 rounded-full animate-pulse shrink-0"
                        style={{ background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.3)', color: '#4ade80' }}
                      >
                        +{player.live_points} مباشر
                      </span>
                    )}
                  </div>
                </div>

                <span className="text-xs font-semibold text-[#94a3b8] tabular-nums text-center">
                  {player.exact_scores}
                </span>

                <span className="text-sm font-bold tabular-nums text-left text-[#3b82f6]">
                  {player.total_points + player.live_points}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {players.length === 0 && (
        <p className="text-[#1a2035] text-center py-12">لا يوجد مشاركون بعد</p>
      )}

      {players.length > 0 && (
        <p className="text-[#2a3a55] text-[10px] text-center mt-2 pb-2">
          في حالة التعادل · الأكثر نتائج صحيحة يفوز
        </p>
      )}
    </MobileShell>
  )
}
