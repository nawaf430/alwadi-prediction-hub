'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { fetchCombinedLeaderboard, type LeaderboardEntry as Entry } from '@/lib/leaderboard'
import { supabase } from '@/lib/supabase'
import { LiveMatchCard } from '@/components/LiveMatchCard'

const RANK_MEDALS = ['🏆', '🥈', '🥉']

export default function PublicLeaderboard() {
  const router = useRouter()
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const [shared, setShared] = useState(false)
  const [currentUsername, setCurrentUsername] = useState<string | null>(null)

  const rowRefs = useRef<Map<string, HTMLElement>>(new Map())
  const beforeSnapshot = useRef<Map<string, number> | undefined>(undefined)

  function animatedSetEntries(newData: Entry[]) {
    const snapshot = new Map<string, number>()
    rowRefs.current.forEach((el, name) => { snapshot.set(name, el.getBoundingClientRect().top) })
    if (snapshot.size > 0) beforeSnapshot.current = snapshot
    setEntries(newData)
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
  }, [entries])

  function setRowRef(name: string, el: HTMLElement | null) {
    if (el) rowRefs.current.set(name, el)
    else rowRefs.current.delete(name)
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      const username = session?.user?.user_metadata?.username as string | undefined
      if (username) setCurrentUsername(username)
    })

    async function load() {
      const data = await fetchCombinedLeaderboard()
      animatedSetEntries(data)
      setLoading(false)
    }

    load()

    const channel = supabase
      .channel('public-leaderboard-' + Math.random())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'participants' }, load)
      // Live re-ranking: when a live match score/status changes, recompute projected
      // points and re-sort immediately (the FLIP animation handles the row movement).
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches' }, load)
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  async function handleShare() {
    const url = window.location.href
    if (navigator.share) {
      await navigator.share({ title: 'الترتيب - تحدي الوادي', url })
    } else {
      await navigator.clipboard.writeText(url)
      setShared(true)
      setTimeout(() => setShared(false), 2000)
    }
  }

  const podium = entries.slice(0, 3)
  const rest = entries.slice(3)

  if (loading) {
    return (
      <div dir="rtl" className="min-h-screen bg-[#080b12] px-4 pt-6 pb-10 max-w-[480px] mx-auto">
        <LiveMatchCard />
        <div className="h-7 w-32 rounded-lg bg-[#1a2035] animate-pulse mb-2" />
        <div className="h-4 w-48 rounded-lg bg-[#1a2035] animate-pulse mb-6" />
        <div className="grid grid-cols-3 gap-2 mb-4">
          <div className="h-28 rounded-2xl bg-[#0d1220] animate-pulse border border-[#1a2035]" />
          <div className="h-36 rounded-2xl bg-[#0c1628] animate-pulse border border-[#1a2035]" />
          <div className="h-28 rounded-2xl bg-[#0d1220] animate-pulse border border-[#1a2035]" />
        </div>
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-14 rounded-xl bg-[#0d1220] animate-pulse border border-[#1a2035] mb-2" />
        ))}
      </div>
    )
  }

  return (
    <div dir="rtl" className="min-h-screen bg-[#080b12] overflow-x-hidden">
      <div className="mx-auto w-full max-w-[480px] px-4 pt-6 pb-16">

        <LiveMatchCard />

        {/* ── Header ──────────────────────────────────────── */}
        <div
          className="rounded-2xl px-4 py-3 mb-4 flex items-center justify-between"
          style={{ background: 'linear-gradient(135deg, #0d1220 0%, #080b12 100%)', border: '1px solid #1a2035' }}
        >
          <div>
            <h1 className="text-xl font-bold text-[#e2e8f0]">الترتيب</h1>
            <p className="text-[#2a3a55] text-sm mt-0.5">كأس العالم 2026 · {entries.length} مشارك</p>
          </div>
          <button
            onClick={handleShare}
            className="flex items-center gap-1.5 h-9 px-3 rounded-xl text-[#60a5fa] text-xs font-medium transition-colors"
            style={{ background: 'rgba(59,130,246,0.10)', border: '1px solid rgba(59,130,246,0.25)' }}
          >
            {shared ? '✓ تم النسخ' : (
              <>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
                  <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                </svg>
                شارك
              </>
            )}
          </button>
        </div>

        {/* ── Horizontal podium ───────────────────────────── */}
        {podium.length > 0 && (
          <div className="grid grid-cols-[1fr_1.15fr_1fr] gap-2 mb-3 items-end">
            {[podium[1], podium[0], podium[2]].map((entry, slot) => {
              if (!entry) return <div key={slot} />
              const rank = slot === 1 ? 0 : slot === 0 ? 1 : 2
              const isMe = currentUsername === entry.name
              const isFirst = rank === 0

              return (
                <div
                  key={entry.name}
                  ref={el => setRowRef(entry.name, el)}
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
                    <span className="text-[#e2e8f0] font-bold text-sm">{entry.name.charAt(0)}</span>
                  </div>
                  <div className="w-full min-w-0 mt-0.5">
                    <p className={cn('font-bold text-xs leading-tight truncate w-full', isFirst ? 'text-[#e2e8f0]' : 'text-[#94a3b8]')}>
                      {entry.name}
                    </p>
                    {isMe && (
                      <span
                        className="text-[9px] font-bold text-[#60a5fa] px-1.5 py-0.5 rounded-full"
                        style={{ background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)' }}
                      >أنت</span>
                    )}
                  </div>
                  <p className={cn('font-black tabular-nums leading-none mt-0.5', isFirst ? 'text-3xl text-[#60a5fa]' : 'text-2xl text-[#94a3b8]')}>
                    {entry.total_points + entry.live_points}
                  </p>
                  <p className="text-[10px] text-[#2a3a55] -mt-0.5">نقطة</p>
                  {entry.live_points > 0 && (
                    <span
                      className="text-[9px] font-bold px-1.5 py-0.5 rounded-full animate-pulse"
                      style={{ background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.3)', color: '#4ade80' }}
                    >
                      +{entry.live_points} مباشر
                    </span>
                  )}
                  <p className="text-[9px] text-[#94a3b8] mt-0.5">توقع صحيح {entry.exact_scores}</p>
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
          <div className="space-y-1.5 mb-6">
            {/* Header */}
            <div className="grid grid-cols-[2rem_1fr_4rem_2.5rem] gap-2 px-3 pb-1">
              <span className="text-[10px] text-[#2a3a55] text-center">#</span>
              <span className="text-[10px] text-[#2a3a55]">الاسم</span>
              <span className="text-[10px] text-[#60a5fa] text-center">توقع صحيح</span>
              <span className="text-[10px] text-[#2a3a55] text-left">نقاط</span>
            </div>

            {rest.map((entry, i) => {
              const isMe = currentUsername === entry.name
              const globalRank = i + 4
              return (
                <div
                  key={entry.name}
                  ref={el => setRowRef(entry.name, el)}
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
                        {entry.name}
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
                        عدد التوقعات: {entry.prediction_count}
                      </p>
                      {entry.live_points > 0 && (
                        <span
                          className="text-[9px] font-bold px-1.5 py-0.5 rounded-full animate-pulse shrink-0"
                          style={{ background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.3)', color: '#4ade80' }}
                        >
                          +{entry.live_points} مباشر
                        </span>
                      )}
                    </div>
                  </div>

                  <span className="text-xs font-semibold text-[#94a3b8] tabular-nums text-center">
                    {entry.exact_scores}
                  </span>

                  <span className="text-sm font-bold tabular-nums text-left text-[#3b82f6]">
                    {entry.total_points + entry.live_points}
                  </span>
                </div>
              )
            })}
          </div>
        )}

        {entries.length === 0 && (
          <p className="text-[#1a2035] text-center py-16">لا يوجد مشاركون بعد</p>
        )}

        {entries.length > 0 && (
          <p className="text-[#2a3a55] text-[10px] text-center mb-4">
            في حالة التعادل · الأكثر نتائج صحيحة يفوز
          </p>
        )}

        {/* Login CTA */}
        <div className="flex justify-center mt-2">
          <button
            onClick={() => router.push('/')}
            className="flex items-center gap-2 h-10 px-5 rounded-xl text-[#94a3b8] text-xs transition-colors hover:text-[#e2e8f0]"
            style={{ background: '#0d1220', border: '1px solid #1a2035' }}
          >
            <span>🔒</span>
            <span>سجل دخولك لتوقع النتائج</span>
          </button>
        </div>
      </div>
    </div>
  )
}
