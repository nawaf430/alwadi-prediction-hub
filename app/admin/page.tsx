'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ADMIN_PIN } from '@/lib/constants'
import { supabase } from '@/lib/supabase'
import { AdminPredictionsEntry } from '@/components/AdminPredictionsEntry'
import type { MatchForGrid } from '@/lib/admin-pred-grid'
import { MobileShell } from '@/components/MobileShell'
import { cn } from '@/lib/utils'

const ADMIN_SESSION_KEY = 'alwadi_admin_unlocked'

// ─── Types ────────────────────────────────────────────────────────────────────

type Match = {
  id: string
  home_team: string
  away_team: string
  home_score: number | null
  away_score: number | null
  status: string
  kickoff_time: string
  penalties: boolean
}

type User = {
  id: string
  username: string
  total_points: number
  exact_scores: number
  is_banned: boolean | null
  invite_code_used: string | null
}

type Participant = {
  id: string
  name: string
  total_points: number
  exact_scores: number
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// ─── Admin page ───────────────────────────────────────────────────────────────

export default function AdminPage() {
  const router = useRouter()
  const [pin, setPin] = useState('')
  const [unlocked, setUnlocked] = useState(false)
  const [tab, setTab] = useState<'matches' | 'users' | 'participants' | 'predictions'>('matches')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Matches tab
  const [matches, setMatches] = useState<Match[]>([])
  const [savingId, setSavingId] = useState<string | null>(null)

  // Users tab
  const [users, setUsers] = useState<User[]>([])

  // Participants tab
  const [participants, setParticipants] = useState<Participant[]>([])
  const [newName, setNewName] = useState('')
  const [addingParticipant, setAddingParticipant] = useState(false)

  // API status
  const [apiRunning, setApiRunning] = useState(false)
  const [apiLastRun, setApiLastRun] = useState<{ ran_at: string; checked: number; updated: number } | null>(null)

  useEffect(() => {
    if (sessionStorage.getItem(ADMIN_SESSION_KEY) === 'true') setUnlocked(true)
    setLoading(false)
    const stored = localStorage.getItem('alwadi_api_last_run')
    if (stored) { try { setApiLastRun(JSON.parse(stored)) } catch {} }
  }, [])

  async function triggerScoreUpdate() {
    setApiRunning(true)
    try {
      const res = await fetch('/api/update-scores', {
        method: 'GET',
        headers: { 'x-cron-secret': 'wadi2026secret' },
      })
      const data = await res.json()
      if (data.ran_at) {
        const info = { ran_at: data.ran_at, checked: data.checked, updated: data.updated }
        setApiLastRun(info)
        localStorage.setItem('alwadi_api_last_run', JSON.stringify(info))
      }
    } catch (e) {
      console.error('API trigger failed:', e)
    }
    setApiRunning(false)
  }

  useEffect(() => {
    if (!unlocked) return
    if (tab === 'matches') loadMatches()
    else if (tab === 'users') loadUsers()
    else if (tab === 'participants') loadParticipants()
    else if (tab === 'predictions') { loadMatches(); loadParticipants() }
  }, [unlocked, tab])

  function handleUnlock() {
    if (pin.trim() === ADMIN_PIN) {
      sessionStorage.setItem(ADMIN_SESSION_KEY, 'true')
      setUnlocked(true)
      setError('')
    } else {
      setError('رمز المسؤول غير صحيح')
    }
  }

  function handleAdminLogout() {
    sessionStorage.removeItem(ADMIN_SESSION_KEY)
    setUnlocked(false)
    setPin('')
  }

  // ── Matches ────────────────────────────────────────────────────────────────

  async function loadMatches() {
    const { data, error: err } = await supabase.rpc('admin_get_matches', { admin_pin: ADMIN_PIN })
    if (err) { setError(err.message); return }
    setMatches(data || [])
    setError('')
  }

  async function saveMatch(match: Match) {
    setSavingId(match.id)
    const { error: err } = await supabase.rpc('admin_update_match', {
      admin_pin: ADMIN_PIN,
      match_id: match.id,
      p_home_score: match.home_score ?? 0,
      p_away_score: match.away_score ?? 0,
      p_status: match.status,
      p_penalties: match.penalties,
    })
    setSavingId(null)
    if (err) setError(err.message)
    else await loadMatches()
  }

  function updateMatch(id: string, field: keyof Match, value: string | number) {
    setMatches(prev => prev.map(m => m.id === id ? { ...m, [field]: value } : m))
  }

  // ── Users ──────────────────────────────────────────────────────────────────

  async function loadUsers() {
    const { data, error: err } = await supabase.rpc('admin_get_users', { admin_pin: ADMIN_PIN })
    if (err) { setError(err.message); return }
    setUsers(data || [])
    setError('')
  }

  async function toggleBan(user: User) {
    setSavingId(user.id)
    const { error: err } = await supabase.rpc('admin_set_user_banned', {
      admin_pin: ADMIN_PIN,
      user_id: user.id,
      banned: !user.is_banned,
    })
    setSavingId(null)
    if (err) setError(err.message)
    else await loadUsers()
  }

  // ── Participants ───────────────────────────────────────────────────────────

  async function loadParticipants() {
    const { data, error: err } = await supabase.rpc('admin_get_participants', { admin_pin: ADMIN_PIN })
    if (err) { setError(err.message); return }
    setParticipants(data || [])
    setError('')
  }

  async function addParticipant() {
    if (!newName.trim()) return
    setAddingParticipant(true)
    const { error: err } = await supabase.rpc('admin_add_participant', {
      admin_pin: ADMIN_PIN,
      p_name: newName.trim(),
    })
    setAddingParticipant(false)
    if (err) { setError(err.message); return }
    setNewName('')
    await loadParticipants()
  }

  async function deleteParticipant(id: string) {
    setSavingId(id)
    const { error: err } = await supabase.rpc('admin_delete_participant', {
      admin_pin: ADMIN_PIN,
      p_id: id,
    })
    setSavingId(null)
    if (err) { setError(err.message); return }
    await loadParticipants()
  }

  // ── Predictions helpers (used by AdminPredictionsEntry) ───────────────────

  const runPointsRecalc = useCallback(async (match: MatchForGrid) => {
    const { error: rpcErr } = await supabase.rpc('admin_recalculate_match_participant_points', {
      admin_pin: ADMIN_PIN,
      p_match_id: match.id,
    })
    if (rpcErr) {
      console.warn('admin_recalculate_match_participant_points error:', rpcErr.message)
    }

    await supabase.rpc('admin_update_match', {
      admin_pin: ADMIN_PIN,
      match_id: match.id,
      p_home_score: match.home_score ?? 0,
      p_away_score: match.away_score ?? 0,
      p_status: 'finished',
    })
  }, [])

  const refreshLeaderboard = useCallback(async () => {
    try {
      await fetch('/api/update-scores', {
        method: 'GET',
        headers: { 'x-cron-secret': 'wadi2026secret' },
      })
    } catch {
      // silent — not critical
    }
  }, [])

  // ── Render: loading ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div dir="rtl" className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <p className="text-white">جاري التحميل...</p>
      </div>
    )
  }

  // ── Render: PIN gate ───────────────────────────────────────────────────────

  if (!unlocked) {
    return (
      <div dir="rtl" className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-4">
        <div className="w-full max-w-[480px] rounded-3xl border border-[#1f1f24] bg-[#111115] p-8">
          <div className="text-center mb-6">
            <div className="text-5xl mb-2">🔐</div>
            <h1 className="text-xl font-bold text-white">لوحة المسؤول</h1>
          </div>
          <input
            type="password"
            value={pin}
            onChange={e => setPin(e.target.value)}
            placeholder="رمز المسؤول"
            className="w-full h-12 bg-[#0a0a0a] border border-[#1f1f24] text-white rounded-xl px-4 mb-3 outline-none focus:border-[#22c55e]"
            onKeyDown={e => e.key === 'Enter' && handleUnlock()}
          />
          {error && <p className="text-red-400 text-sm text-center mb-3">{error}</p>}
          <button
            onClick={handleUnlock}
            className="w-full h-12 rounded-xl bg-[#22c55e] text-black font-bold mb-3"
          >
            دخول
          </button>
          <button
            onClick={() => router.push('/')}
            className="w-full h-12 text-[#6b7280]"
          >
            العودة للرئيسية
          </button>
        </div>
      </div>
    )
  }

  // ── Render: admin panel ────────────────────────────────────────────────────

  const upcomingMatches = [...matches]
    .filter(m => m.status === 'not_started')
    .sort((a, b) => a.kickoff_time.localeCompare(b.kickoff_time))
  const nextThreeIds = new Set(upcomingMatches.slice(0, 3).map(m => m.id))
  const firstNextMatchId = upcomingMatches[0]?.id ?? null

  const TABS: { id: typeof tab; label: string }[] = [
    { id: 'matches', label: 'المباريات' },
    { id: 'users', label: 'المستخدمون' },
    { id: 'participants', label: 'المشاركون' },
    { id: 'predictions', label: 'التوقعات' },
  ]

  return (
    <MobileShell showNav={false} maxWidthClass="max-w-full sm:max-w-[480px] md:max-w-4xl lg:max-w-6xl">
      {/* Header */}
      <header className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-bold text-white">⚙️ المسؤول</h1>
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/dashboard')}
            className="text-[#6b7280] text-sm h-10 px-2"
          >
            الرئيسية
          </button>
          <button
            onClick={handleAdminLogout}
            className="text-red-400 text-sm h-10 px-2"
          >
            خروج
          </button>
        </div>
      </header>

      {error && (
        <div className="bg-red-950/40 border border-red-900/60 rounded-xl px-4 py-2.5 mb-4">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {/* ── حالة API ─────────────────────────────────────────────────────── */}
      {(() => {
        const minAgo = apiLastRun
          ? Math.floor((Date.now() - new Date(apiLastRun.ran_at).getTime()) / 60000)
          : null
        const statusColor =
          minAgo === null ? '#6b7280'
          : minAgo < 5 ? '#22c55e'
          : minAgo < 15 ? '#f59e0b'
          : '#ef4444'
        const statusLabel =
          minAgo === null ? 'لم يعمل بعد'
          : minAgo < 1 ? 'منذ أقل من دقيقة'
          : `منذ ${minAgo} دقيقة`

        return (
          <div className="rounded-xl border border-[#1f1f24] bg-[#111115] px-4 py-3 mb-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-white text-sm font-bold mb-0.5">حالة API النتائج</p>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="flex items-center gap-1.5 text-xs" style={{ color: statusColor }}>
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: statusColor }} />
                  {statusLabel}
                </span>
                {apiLastRun && (
                  <span className="text-[#6b7280] text-xs">
                    · فحص {apiLastRun.checked} · تحديث {apiLastRun.updated}
                  </span>
                )}
              </div>
              <p className="text-[#4b5563] text-[10px] mt-0.5">يعمل تلقائيًا كل 3 دقائق</p>
            </div>
            <button
              onClick={triggerScoreUpdate}
              disabled={apiRunning}
              className={cn(
                'shrink-0 h-9 px-3 rounded-lg text-xs font-bold transition-colors',
                apiRunning
                  ? 'bg-[#1f1f24] text-[#6b7280] cursor-not-allowed'
                  : 'bg-[#22c55e]/10 border border-[#22c55e]/30 text-[#22c55e] hover:bg-[#22c55e]/20'
              )}
            >
              {apiRunning ? '⏳ جارٍ...' : 'تشغيل يدوي'}
            </button>
          </div>
        )
      })()}

      {/* Tabs */}
      <div className="flex rounded-xl border border-[#1f1f24] bg-[#0a0a0a] p-1 mb-4 gap-1 overflow-x-auto [&::-webkit-scrollbar]:hidden">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => { setTab(t.id); setError('') }}
            className={cn(
              'flex-1 min-w-fit h-10 rounded-lg text-sm font-bold whitespace-nowrap px-3 transition-colors',
              tab === t.id ? 'bg-[#22c55e] text-black' : 'text-[#6b7280] hover:text-white'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab: Matches ─────────────────────────────────────────────────── */}
      {tab === 'matches' && (
        <div className="space-y-3">
          {firstNextMatchId && (
            <button
              onClick={() => document.getElementById('next-match-anchor')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              className="w-full h-10 rounded-xl text-sm font-bold text-[#f59e0b] border border-[#f59e0b]/30 bg-[#f59e0b]/5 hover:bg-[#f59e0b]/10 transition-colors"
            >
              ⚡ انتقل للمباريات القادمة
            </button>
          )}
          {matches.map(match => {
            const isNext = nextThreeIds.has(match.id)
            return (
            <div
              key={match.id}
              id={match.id === firstNextMatchId ? 'next-match-anchor' : undefined}
              className={cn(
                'rounded-2xl border bg-[#111115] p-4',
                isNext ? 'border-[#f59e0b]/50' : 'border-[#1f1f24]',
              )}
            >
              {isNext && (
                <div className="flex justify-start mb-2">
                  <span className="text-[10px] font-bold text-[#f59e0b] bg-[#f59e0b]/10 border border-[#f59e0b]/30 px-2 py-0.5 rounded-full">
                    ⚡ قادمة
                  </span>
                </div>
              )}
              <p className="text-white font-bold text-base text-center mb-3">
                {match.home_team} <span className="text-[#4b5563]">vs</span> {match.away_team}
              </p>
              <div className="flex gap-3 justify-center mb-3">
                <input
                  type="number" min={0}
                  value={match.home_score ?? 0}
                  onChange={e => updateMatch(match.id, 'home_score', parseInt(e.target.value) || 0)}
                  className="w-16 h-14 bg-[#0a0a0a] border border-[#1f1f24] text-white text-center text-xl font-bold rounded-xl outline-none focus:border-[#22c55e]"
                />
                <span className="self-center text-[#4b5563] font-bold text-xl">-</span>
                <input
                  type="number" min={0}
                  value={match.away_score ?? 0}
                  onChange={e => updateMatch(match.id, 'away_score', parseInt(e.target.value) || 0)}
                  className="w-16 h-14 bg-[#0a0a0a] border border-[#1f1f24] text-white text-center text-xl font-bold rounded-xl outline-none focus:border-[#22c55e]"
                />
              </div>
              <select
                value={match.status}
                onChange={e => updateMatch(match.id, 'status', e.target.value)}
                className="w-full h-11 bg-[#0a0a0a] border border-[#1f1f24] text-white rounded-xl px-3 mb-3 outline-none"
              >
                <option value="not_started">لم تبدأ</option>
                <option value="live">مباشر</option>
                <option value="finished">انتهت</option>
              </select>
              {/* Penalties toggle — only relevant for knockout finished matches */}
              <button
                type="button"
                onClick={() => setMatches(prev => prev.map(m => m.id === match.id ? { ...m, penalties: !m.penalties } : m))}
                className={cn(
                  'w-full h-10 rounded-xl text-sm font-bold mb-3 border transition-colors',
                  match.penalties
                    ? 'bg-[#fef3c7] text-[#92400e] border-[#f59e0b]'
                    : 'bg-[#0a0a0a] text-[#4b5563] border-[#1f1f24] hover:text-white'
                )}
              >
                {match.penalties ? '🟡 وصلت للبنلتيات' : 'لم تصل للبنلتيات'}
              </button>
              <button
                onClick={() => saveMatch(match)}
                disabled={savingId === match.id}
                className="w-full h-11 rounded-xl bg-[#22c55e] text-black font-bold text-sm disabled:opacity-50"
              >
                {savingId === match.id ? 'جاري الحفظ...' : 'حفظ'}
              </button>
            </div>
            )
          })}
          {matches.length === 0 && (
            <p className="text-[#4b5563] text-center py-10">لا توجد مباريات</p>
          )}
        </div>
      )}

      {/* ── Tab: Users ────────────────────────────────────────────────────── */}
      {tab === 'users' && (
        <div className="space-y-2">
          {users.map(user => (
            <div
              key={user.id}
              className={cn(
                'rounded-xl border p-4 flex items-center justify-between gap-3',
                user.is_banned ? 'border-red-900/50 bg-red-950/20' : 'border-[#1f1f24] bg-[#111115]'
              )}
            >
              <div className="min-w-0">
                <p className="text-white font-bold text-sm truncate">{user.username}</p>
                <p className="text-[#6b7280] text-xs mt-0.5">
                  {user.total_points} نقطة · {user.exact_scores} صحيح
                </p>
              </div>
              <button
                onClick={() => toggleBan(user)}
                disabled={savingId === user.id}
                className={cn(
                  'shrink-0 h-9 px-4 rounded-lg text-xs font-bold disabled:opacity-50',
                  user.is_banned ? 'bg-[#22c55e]/20 text-[#22c55e]' : 'bg-red-900/40 text-red-300'
                )}
              >
                {user.is_banned ? 'إلغاء الحظر' : 'حظر'}
              </button>
            </div>
          ))}
          {users.length === 0 && (
            <p className="text-[#4b5563] text-center py-10">لا يوجد مستخدمون</p>
          )}
        </div>
      )}

      {/* ── Tab: Participants ─────────────────────────────────────────────── */}
      {tab === 'participants' && (
        <div>
          <div className="flex gap-2 mb-4">
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="اسم المشارك"
              onKeyDown={e => e.key === 'Enter' && addParticipant()}
              className="flex-1 h-11 bg-[#0a0a0a] border border-[#1f1f24] text-white rounded-xl px-4 text-sm outline-none focus:border-[#22c55e] placeholder:text-[#4b5563]"
            />
            <button
              onClick={addParticipant}
              disabled={addingParticipant || !newName.trim()}
              className="h-11 px-4 rounded-xl bg-[#14532d] text-[#86efac] text-sm font-bold disabled:opacity-50 whitespace-nowrap"
            >
              {addingParticipant ? '...' : '+ إضافة'}
            </button>
          </div>
          <div className="space-y-2">
            {participants.map(p => (
              <div key={p.id} className="rounded-xl border border-[#1f1f24] bg-[#111115] px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-white font-semibold text-sm truncate">{p.name}</p>
                  <p className="text-[#6b7280] text-xs mt-0.5">
                    {p.total_points} نقطة · {p.exact_scores} صحيح
                  </p>
                </div>
                <button
                  onClick={() => deleteParticipant(p.id)}
                  disabled={savingId === p.id}
                  className="shrink-0 h-8 w-8 flex items-center justify-center rounded-lg bg-red-950/40 text-red-400 text-base disabled:opacity-50 hover:bg-red-900/40 transition-colors"
                  aria-label="حذف"
                >
                  ×
                </button>
              </div>
            ))}
            {participants.length === 0 && (
              <p className="text-[#4b5563] text-center py-10">لا يوجد مشاركون بعد</p>
            )}
          </div>
        </div>
      )}

      {/* ── Tab: Predictions entry ────────────────────────────────────────── */}
      {tab === 'predictions' && (
        <AdminPredictionsEntry
          matches={matches}
          participants={participants}
          onError={setError}
          onRunPointsRecalc={runPointsRecalc}
          onRefreshLeaderboard={refreshLeaderboard}
        />
      )}

    </MobileShell>
  )
}
