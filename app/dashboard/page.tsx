'use client'

import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { flag } from '@/lib/flags'
import { BottomNav } from '@/components/BottomNav'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

// ─── Types ────────────────────────────────────────────────────────────────────

type Match = {
  id: string
  home_team: string
  away_team: string
  kickoff_time: string
  match_day_deadline: string
  status: string
  home_score: number | null
  away_score: number | null
  api_match_id: string
}

type Prediction = {
  id: string
  user_id: string
  match_id: string
  predicted_home: number
  predicted_away: number
  points_earned: number | null
}

// ─── KSA timezone helpers (UTC+3) ────────────────────────────────────────────

const KSA_MS = 3 * 60 * 60 * 1000

function toKSADateStr(utcIso: string): string {
  const d = new Date(new Date(utcIso).getTime() + KSA_MS)
  return d.toISOString().slice(0, 10)
}

function todayKSA(): string {
  return toKSADateStr(new Date().toISOString())
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function formatKSATime(utcIso: string): string {
  const d = new Date(new Date(utcIso).getTime() + KSA_MS)
  const h = d.getUTCHours().toString().padStart(2, '0')
  const m = d.getUTCMinutes().toString().padStart(2, '0')
  return `${h}:${m}`
}

const AR_WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
const AR_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']

function weekdayName(dateStr: string): string {
  return AR_WEEKDAYS[new Date(dateStr + 'T00:00:00Z').getUTCDay()]
}

function dayNum(dateStr: string): number {
  return parseInt(dateStr.slice(8, 10), 10)
}

function fullDateLabel(dateStr: string): string {
  const d = parseInt(dateStr.slice(8, 10), 10)
  const m = parseInt(dateStr.slice(5, 7), 10) - 1
  return `${d} ${AR_MONTHS[m]}`
}

// ─── Dashboard page ──────────────────────────────────────────────────────────

export default function Dashboard() {
  const router = useRouter()
  const [userId, setUserId] = useState<string | null>(null)
  const [profile, setProfile] = useState<{ username: string; total_points: number; is_banned?: boolean } | null>(null)
  const [matches, setMatches] = useState<Match[]>([])
  const [predictions, setPredictions] = useState<Record<string, Prediction>>({})
  const [loading, setLoading] = useState(true)
  const [showLogout, setShowLogout] = useState(false)

  const today = todayKSA()
  const [selectedDay, setSelectedDay] = useState(today)
  const tabsRef = useRef<HTMLDivElement>(null)

  // 7 days centered on selectedDay
  const days = Array.from({ length: 7 }, (_, i) => addDays(selectedDay, i - 3))

  // Scroll selected tab into center whenever it changes
  useEffect(() => {
    const el = tabsRef.current
    if (!el) return
    const selBtn = el.querySelector('[data-selected="true"]') as HTMLElement | null
    if (selBtn) {
      const offset = selBtn.offsetLeft - el.clientWidth / 2 + selBtn.clientWidth / 2
      el.scrollTo({ left: offset, behavior: 'auto' })
    }
  }, [selectedDay, loading])

  useEffect(() => { init() }, [])

  async function init() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { router.push('/'); return }
    const uid = session.user.id
    setUserId(uid)

    const [profResult, matchResult, predResult] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', uid).single(),
      supabase.from('matches').select('*').order('kickoff_time', { ascending: true }),
      supabase.from('predictions').select('*').eq('user_id', uid),
    ])

    const prof = profResult.data
    if (!prof) { router.push('/'); return }
    if (prof.is_banned) { await supabase.auth.signOut(); router.push('/'); return }
    setProfile(prof)

    const allMatches: Match[] = matchResult.data || []
    setMatches(allMatches)

    // Smart default: select nearest day with matches
    const matchDates = [...new Set(allMatches.map(m => toKSADateStr(m.kickoff_time)))].sort()
    if (matchDates.length > 0) {
      const t = todayKSA()
      const futureDate = matchDates.find(d => d >= t)
      const nearest = futureDate ?? matchDates[matchDates.length - 1]
      setSelectedDay(nearest)
    }

    const predMap: Record<string, Prediction> = {}
    predResult.data?.forEach(p => { predMap[p.match_id] = p })
    setPredictions(predMap)

    setLoading(false)
  }

  // Realtime: update match scores/status live
  useEffect(() => {
    const channel = supabase
      .channel('matches-rt-' + Math.random().toString(36).slice(2))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches' }, payload => {
        setMatches(prev => prev.map(m => m.id === payload.new.id ? { ...m, ...(payload.new as Match) } : m))
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/')
  }

  // Group by KSA date
  const matchesByDay: Record<string, Match[]> = {}
  matches.forEach(m => {
    const d = toKSADateStr(m.kickoff_time)
    if (!matchesByDay[d]) matchesByDay[d] = []
    matchesByDay[d].push(m)
  })

  const selectedMatches = matchesByDay[selectedDay] || []
  const firstDeadline = selectedMatches[0]?.match_day_deadline ?? null

  const pastDaysWithMatches = Object.keys(matchesByDay)
    .filter(d => d < today)
    .sort()
    .reverse()

  const allMatchDates = Object.keys(matchesByDay).sort()
  const nearestMatchDay = allMatchDates.find(d => d >= today) ?? allMatchDates[allMatchDates.length - 1] ?? null

  if (loading) {
    return (
      <div dir="rtl" className="min-h-screen bg-[#0d0d0f] overflow-x-hidden">
        <div className="mx-auto w-full max-w-[480px] flex flex-col min-h-screen">
          <div className="sticky top-0 z-20 bg-[#0d0d0f]/95 border-b border-[#1f1f24] px-4 py-3 flex items-center justify-between">
            <div className="h-7 w-12 rounded-lg bg-[#1f1f24] animate-pulse" />
            <div className="h-4 w-20 rounded-lg bg-[#1f1f24] animate-pulse" />
            <div className="h-8 w-8 rounded-lg bg-[#1f1f24] animate-pulse" />
          </div>
          <div className="border-b border-[#1f1f24] px-4 py-2.5 flex gap-5">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-8 w-10 rounded-lg bg-[#1f1f24] animate-pulse" />
            ))}
          </div>
          <div className="flex-1 px-4 pt-3 pb-24 space-y-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-28 rounded-2xl bg-[#111115] animate-pulse" />
            ))}
          </div>
          <BottomNav />
        </div>
      </div>
    )
  }

  return (
    <div dir="rtl" className="min-h-screen bg-[#0d0d0f] overflow-x-hidden">
      <div className="mx-auto w-full max-w-[480px] flex flex-col min-h-screen">

        {/* ── Header ──────────────────────────────────────────────────── */}
        <div className="sticky top-0 z-20 bg-[#0d0d0f]/95 backdrop-blur-md border-b border-[#1f1f24] px-4 py-3 flex items-center justify-between">
          <div className="flex items-baseline gap-1.5">
            <span className="text-[#22c55e] font-bold text-2xl tabular-nums leading-none">
              {profile?.total_points ?? 0}
            </span>
            <span className="text-[#6b7280] text-xs">نقطة</span>
          </div>
          <span className="text-white font-semibold text-sm">{profile?.username}</span>
          <button
            onClick={() => setShowLogout(true)}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-[#6b7280] hover:text-white hover:bg-[#1f1f24] transition-colors"
            aria-label="خروج"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </div>

        {/* ── Day tabs ─────────────────────────────────────────────────── */}
        <div className="sticky top-[57px] z-10 bg-[#0d0d0f]/95 backdrop-blur-md border-b border-[#1f1f24]">
          <div
            ref={tabsRef}
            className="flex overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] px-1"
          >
            {days.map(day => {
              const isToday = day === today
              const isSel = day === selectedDay
              return (
                <button
                  key={day}
                  data-selected={isSel ? 'true' : undefined}
                  onClick={() => setSelectedDay(day)}
                  className={cn(
                    'flex-shrink-0 flex flex-col items-center gap-0.5 px-3.5 py-2.5 border-b-2 transition-colors',
                    isSel ? 'border-[#22c55e]' : 'border-transparent'
                  )}
                >
                  <span className={cn(
                    'text-[10px] font-medium',
                    isSel ? 'text-[#86efac]' : 'text-[#4b5563]'
                  )}>
                    {weekdayName(day)}
                  </span>
                  <div className="flex items-center gap-1">
                    <span className={cn(
                      'text-sm font-bold tabular-nums',
                      isSel ? 'text-white' : 'text-[#6b7280]'
                    )}>
                      {dayNum(day)}
                    </span>
                    {isToday && (
                      <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e] shrink-0" />
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* ── Content ──────────────────────────────────────────────────── */}
        <div className="flex-1 px-4 pt-3 pb-24 space-y-3">

          {firstDeadline && (
            <DeadlineBanner
              deadline={firstDeadline}
              day={selectedDay}
              today={today}
            />
          )}

          {selectedMatches.length === 0 && (() => {
            const matchDates = [...new Set(matches.map(m => toKSADateStr(m.kickoff_time)))].sort()
            const nearestFuture = matchDates.find(d => d > selectedDay)
            const nearestPast = [...matchDates].reverse().find(d => d < selectedDay)
            const jumpTo = nearestFuture ?? nearestPast ?? null
            return (
              <div className="flex flex-col items-center justify-center py-20 gap-4">
                <p className="text-[#4b5563] text-sm">لا توجد مباريات</p>
                {jumpTo && (
                  <button
                    onClick={() => setSelectedDay(jumpTo)}
                    className="flex items-center gap-2 bg-[#111115] border border-[#1f1f24] hover:border-[#22c55e]/40 text-[#86efac] text-sm font-medium px-5 py-2.5 rounded-xl transition-colors"
                  >
                    <span>انتقل لأقرب مباراة</span>
                    <span className="text-base">←</span>
                  </button>
                )}
              </div>
            )
          })()}

          {selectedMatches.map(match => (
            <MatchCard
              key={match.id}
              match={match}
              prediction={predictions[match.id]}
              userId={userId}
              onPredictionSaved={pred => setPredictions(prev => ({ ...prev, [match.id]: pred }))}
            />
          ))}

          {selectedDay === today && pastDaysWithMatches.length > 0 && (
            <div className="pt-2">
              <p className="text-[#4b5563] text-xs text-center mb-3">الأيام السابقة</p>
              <div className="space-y-2">
                {pastDaysWithMatches.map(day => (
                  <PastDayRow
                    key={day}
                    day={day}
                    matches={matchesByDay[day]}
                    predictions={predictions}
                    userId={userId}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {nearestMatchDay && selectedDay !== nearestMatchDay && (
          <div className="fixed bottom-16 inset-x-0 flex justify-center z-30 pointer-events-none">
            <button
              onClick={() => setSelectedDay(nearestMatchDay)}
              className="pointer-events-auto flex items-center gap-1.5 bg-[#14532d] text-[#86efac] text-xs font-medium px-4 py-2 rounded-full shadow-lg shadow-black/40 transition-opacity"
            >
              <span>←</span>
              <span>العودة لأقرب مباراة</span>
            </button>
          </div>
        )}

        <BottomNav />
      </div>

      <Dialog open={showLogout} onOpenChange={setShowLogout}>
        <DialogContent
          showCloseButton={false}
          className="max-w-[320px] bg-[#111115] border-[#1f1f24]"
          dir="rtl"
        >
          <DialogHeader>
            <DialogTitle className="text-center text-white">هل تريد الخروج؟</DialogTitle>
          </DialogHeader>
          <DialogFooter className="flex-row gap-3 mt-2">
            <Button
              variant="outline"
              className="flex-1 h-11 border-[#1f1f24] text-[#6b7280] hover:text-white bg-transparent"
              onClick={() => setShowLogout(false)}
            >
              إلغاء
            </Button>
            <Button
              className="flex-1 h-11 bg-[#7f1d1d] text-[#fca5a5] hover:bg-[#991b1b] border-0"
              onClick={handleLogout}
            >
              خروج
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Deadline banner ──────────────────────────────────────────────────────────

function DeadlineBanner({
  deadline,
  day,
  today,
}: {
  deadline: string
  day: string
  today: string
}) {
  const [tick, setTick] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const diff = new Date(deadline).getTime() - tick

  // Future day — show when predictions lock
  if (day > today) {
    const deadlineDate = toKSADateStr(deadline)
    return (
      <div className="rounded-xl bg-[#0b1a10] border border-[#166534] px-4 py-2.5 flex items-center gap-2">
        <span className="text-base">📅</span>
        <span className="text-[#86efac] text-sm">
          يُغلق التوقع يوم {weekdayName(deadlineDate)} {dayNum(deadlineDate)}
        </span>
      </div>
    )
  }

  // Today but deadline passed
  if (diff <= 0) {
    return (
      <div className="rounded-xl bg-[#1c0505] border border-[#7f1d1d] px-4 py-2.5 flex items-center gap-2">
        <span className="text-base">🔒</span>
        <span className="text-[#fca5a5] text-sm font-medium">انتهى وقت التوقع</span>
      </div>
    )
  }

  // Today, deadline approaching
  const h = Math.floor(diff / 3600000)
  const m = Math.floor((diff % 3600000) / 60000)
  const urgent = diff < 30 * 60 * 1000

  return (
    <div className={cn(
      'rounded-xl border px-4 py-2.5 flex items-center justify-between',
      urgent ? 'bg-[#1c0a00] border-[#c2410c]' : 'bg-[#1c1300] border-[#b45309]'
    )}>
      <div className="flex items-center gap-2">
        <span className="text-base">⏰</span>
        <span className={cn('text-sm font-medium', urgent ? 'text-[#fb923c]' : 'text-[#fbbf24]')}>
          آخر موعد للتوقع
        </span>
      </div>
      <span className={cn(
        'font-mono font-bold tabular-nums text-sm',
        urgent ? 'text-[#ef4444]' : 'text-[#f59e0b]'
      )}>
        {h > 0 ? `${h}س ${m}د` : `${m}د`}
      </span>
    </div>
  )
}

// ─── Match card ───────────────────────────────────────────────────────────────

function MatchCard({
  match,
  prediction,
  userId,
  onPredictionSaved,
}: {
  match: Match
  prediction?: Prediction
  userId: string | null
  onPredictionSaved: (p: Prediction) => void
}) {
  const [home, setHome] = useState(prediction?.predicted_home?.toString() ?? '')
  const [away, setAway] = useState(prediction?.predicted_away?.toString() ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [deadlinePassed, setDeadlinePassed] = useState(
    () => Date.now() > new Date(match.match_day_deadline).getTime()
  )

  useEffect(() => {
    setHome(prediction?.predicted_home?.toString() ?? '')
    setAway(prediction?.predicted_away?.toString() ?? '')
  }, [prediction])

  // Watch deadline — locks editing when passed
  useEffect(() => {
    if (deadlinePassed) return
    const ts = new Date(match.match_day_deadline).getTime()
    const id = setInterval(() => {
      if (Date.now() > ts) setDeadlinePassed(true)
    }, 1000)
    return () => clearInterval(id)
  }, [match.match_day_deadline, deadlinePassed])

  async function handleSave() {
    if (home === '' || away === '') { setError('أدخل النتيجة كاملة'); return }
    if (!userId) return
    setSaving(true)
    setError('')
    const payload = {
      predicted_home: parseInt(home, 10),
      predicted_away: parseInt(away, 10),
    }
    if (prediction?.id) {
      const { data, error: err } = await supabase
        .from('predictions')
        .update({ ...payload, last_edited_at: new Date().toISOString() })
        .eq('id', prediction.id)
        .select()
        .single()
      if (err) setError('حدث خطأ')
      else if (data) { setSaved(true); onPredictionSaved(data as Prediction); setTimeout(() => setSaved(false), 2500) }
    } else {
      const { data, error: err } = await supabase
        .from('predictions')
        .insert({ user_id: userId, match_id: match.id, ...payload })
        .select()
        .single()
      if (err) setError('حدث خطأ')
      else if (data) { setSaved(true); onPredictionSaved(data as Prediction); setTimeout(() => setSaved(false), 2500) }
    }
    setSaving(false)
  }

  const isLive = match.status === 'live'
  const isFinished = match.status === 'finished'
  const hasScore = isLive || isFinished

  return (
    <div className="rounded-2xl bg-[#111115] border border-[#1f1f24] overflow-hidden">
      {/* ── Match header ───────────────────────────────────────────── */}
      <div className="p-4">
        <div className="flex items-center justify-between mb-2.5">
          <span className="text-[#4b5563] text-xs">{formatKSATime(match.kickoff_time)}</span>
          {isLive ? (
            <span className="flex items-center gap-1.5 text-xs bg-[#7f1d1d] text-[#fca5a5] px-2 py-0.5 rounded-full">
              <span className="live-dot" />
              مباشر
            </span>
          ) : isFinished ? (
            <span className="text-xs bg-[#1a1a1e] text-[#6b7280] px-2 py-0.5 rounded-full">انتهت</span>
          ) : deadlinePassed ? (
            <span className="text-xs bg-[#1a1a1e] text-[#6b7280] px-2 py-0.5 rounded-full">مغلق</span>
          ) : (
            <span className="text-xs bg-[#0b1a10] text-[#86efac] px-2 py-0.5 rounded-full border border-[#166534]/60">
              متاح للتوقع
            </span>
          )}
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 flex-1 justify-end min-w-0">
            <span className="text-white font-bold text-sm truncate">{match.home_team}</span>
            <span className="text-base shrink-0">{flag(match.home_team)}</span>
          </div>
          <span className={cn(
            'font-bold text-base px-3 tabular-nums shrink-0',
            hasScore ? 'text-[#22c55e]' : 'text-[#374151]'
          )}>
            {hasScore ? `${match.home_score} - ${match.away_score}` : 'VS'}
          </span>
          <div className="flex items-center gap-1.5 flex-1 justify-start min-w-0">
            <span className="text-base shrink-0">{flag(match.away_team)}</span>
            <span className="text-white font-bold text-sm truncate">{match.away_team}</span>
          </div>
        </div>
      </div>

      {/* ── Input form — only when deadline hasn't passed ──────────── */}
      {!deadlinePassed && (
        <div className="border-t border-[#1f1f24] px-4 py-3">
          <div className="flex items-center justify-center gap-4 mb-3">
            <input
              type="number"
              min="0"
              max="20"
              inputMode="numeric"
              value={home}
              onChange={e => setHome(e.target.value)}
              className={cn(
                'w-[68px] h-[52px] rounded-xl bg-[#1a1a1e] text-white text-center text-2xl font-bold outline-none border transition-colors',
                home !== '' ? 'border-[#22c55e]' : 'border-[#2a2a2e]',
                'focus:border-[#22c55e]'
              )}
            />
            <span className="text-[#374151] font-bold text-xl select-none">—</span>
            <input
              type="number"
              min="0"
              max="20"
              inputMode="numeric"
              value={away}
              onChange={e => setAway(e.target.value)}
              className={cn(
                'w-[68px] h-[52px] rounded-xl bg-[#1a1a1e] text-white text-center text-2xl font-bold outline-none border transition-colors',
                away !== '' ? 'border-[#22c55e]' : 'border-[#2a2a2e]',
                'focus:border-[#22c55e]'
              )}
            />
          </div>
          {error && <p className="text-[#f87171] text-xs text-center mb-2">{error}</p>}
          {saved ? (
            <div className="h-11 flex items-center justify-center text-[#22c55e] text-sm font-semibold gap-1.5">
              ✓ محفوظ
            </div>
          ) : (
            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full h-11 rounded-xl bg-[#14532d] text-[#86efac] hover:bg-[#166534] font-bold text-sm transition-colors disabled:opacity-50"
            >
              {saving ? 'جاري الحفظ...' : prediction ? 'تعديل التوقع' : 'حفظ التوقع'}
            </button>
          )}
        </div>
      )}

      {/* Own prediction — visible after deadline (no other players' predictions) */}
      {deadlinePassed && prediction && (
        <div className="border-t border-[#1f1f24] px-4 py-3 bg-[#0d0d0f]/60">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[#86efac] text-xs font-semibold shrink-0">توقعك</span>
            <span className="text-white font-mono text-sm tabular-nums flex-1 text-center">
              {prediction.predicted_home} - {prediction.predicted_away}
            </span>
            {isFinished && (
              <span className={cn(
                'text-xs font-bold shrink-0',
                prediction.points_earned === 3 ? 'text-[#22c55e]' :
                prediction.points_earned === 1 ? 'text-[#f59e0b]' : 'text-[#4b5563]'
              )}>
                {prediction.points_earned === 3 ? '🎯 3' :
                 prediction.points_earned === 1 ? '✅ 1' : '❌ 0'}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Past day row (collapsed summary) ─────────────────────────────────────────

function PastDayRow({
  day,
  matches,
  predictions,
  userId,
}: {
  day: string
  matches: Match[]
  predictions: Record<string, Prediction>
  userId: string | null
}) {
  const [expanded, setExpanded] = useState(false)

  const dayPoints = matches.reduce(
    (sum, m) => sum + (predictions[m.id]?.points_earned ?? 0),
    0
  )

  return (
    <div className="rounded-2xl bg-[#0e0e11] border border-[#1f1f24] overflow-hidden">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-[#111115] transition-colors"
      >
        <div className="flex items-center gap-2">
          <svg
            width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2.5"
            className={cn('text-[#4b5563] transition-transform shrink-0', expanded ? 'rotate-180' : '')}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
          <span className="text-[#6b7280] text-sm">
            {weekdayName(day)}، {fullDateLabel(day)}
          </span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-[#4b5563] text-xs">{matches.length} مباريات</span>
          <span className={cn(
            'font-bold text-sm tabular-nums',
            dayPoints > 0 ? 'text-[#22c55e]' : 'text-[#4b5563]'
          )}>
            {dayPoints > 0 ? `+${dayPoints}` : '0'}
          </span>
        </div>
      </button>

      {expanded && (
        <div className="px-3 pb-3 pt-1 space-y-2 border-t border-[#1f1f24]">
          {matches.map(match => (
            <MatchCard
              key={match.id}
              match={match}
              prediction={predictions[match.id]}
              userId={userId}
              onPredictionSaved={() => {}}
            />
          ))}
        </div>
      )}
    </div>
  )
}
