'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const router = useRouter()
  const [inviteCode, setInviteCode] = useState('')
  const [username, setUsername] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  function buildFullCode(name: string, num: string) {
    return `${name.trim()}_${num.trim()}`
  }

  async function deriveEmail(name: string): Promise<string> {
    const data = new TextEncoder().encode(name.trim())
    const buf = await crypto.subtle.digest('SHA-256', data)
    const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
    return `u_${hex.substring(0, 32)}@alwadi-wc.com`
  }

  async function handleLogin() {
    setLoading(true)
    setError('')

    if (!username.trim() || !inviteCode.trim()) {
      setError('يرجى ملء جميع الحقول')
      setLoading(false)
      return
    }

    const fullCode = buildFullCode(username, inviteCode)
    const fakeEmail = await deriveEmail(username)
    const password = fullCode

    let { error: authError } = await supabase.auth.signInWithPassword({ email: fakeEmail, password })

    if (authError) {
      const legacyEmail = `u_${username.trim().split('').map(c => c.charCodeAt(0).toString(16)).join('').substring(0, 20)}@alwadi-wc.com`
      if (legacyEmail !== fakeEmail) {
        const retry = await supabase.auth.signInWithPassword({ email: legacyEmail, password })
        authError = retry.error
      }
    }

    if (authError) {
      setError('اسم المستخدم أو رمز الدخول غير صحيح')
      setLoading(false)
      return
    }

    router.push('/dashboard')
  }

  return (
    <div
      dir="rtl"
      className="min-h-screen flex flex-col items-center justify-center p-5 overflow-x-hidden"
      style={{ background: 'radial-gradient(ellipse at 50% 0%, #0d2518 0%, #080b12 55%)' }}
    >
      {/* Glow */}
      <div
        className="pointer-events-none fixed top-0 left-1/2 -translate-x-1/2 w-[500px] h-[200px] opacity-20"
        style={{ background: 'radial-gradient(ellipse, #22c55e, transparent 70%)' }}
      />

      <div className="w-full max-w-[400px]">

        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div
            className="w-20 h-20 rounded-3xl flex items-center justify-center text-4xl mb-5 shadow-2xl"
            style={{ background: 'linear-gradient(135deg, #14532d, #166534)', boxShadow: '0 0 40px rgba(34,197,94,0.2)' }}
          >
            ⚽
          </div>
          <h1 className="text-[28px] font-black text-white tracking-tight mb-1">تحدي التوقعات</h1>
          <div className="flex items-center gap-2 text-sm text-[#4b5563]">
            <span>الوادي</span>
            <span className="w-1 h-1 rounded-full bg-[#22c55e] opacity-60" />
            <span>كأس العالم 2026</span>
          </div>
        </div>

        {/* Card */}
        <div
          className="rounded-3xl p-6 shadow-2xl"
          style={{ background: '#0f1117', border: '1px solid #1f2937' }}
        >
          <div className="space-y-4">

            {/* Name field */}
            <div className="space-y-1.5">
              <label className="text-[#9ca3af] text-xs font-semibold tracking-wide">اسمك</label>
              <input
                dir="rtl"
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleLogin()}
                placeholder="أدخل اسمك"
                className="w-full h-13 px-4 rounded-2xl text-white text-base outline-none transition-all placeholder:text-[#374151]"
                style={{
                  background: '#161b25',
                  border: username ? '1.5px solid #22c55e' : '1.5px solid #1f2937',
                  height: '52px',
                }}
              />
            </div>

            {/* Code field */}
            <div className="space-y-1.5">
              <label className="text-[#9ca3af] text-xs font-semibold tracking-wide">رمز الدخول الشخصي</label>
              <input
                dir="rtl"
                type="text"
                value={inviteCode}
                onChange={e => setInviteCode(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleLogin()}
                placeholder="أدخل الرمز"
                className="w-full px-4 rounded-2xl text-white text-base outline-none transition-all placeholder:text-[#374151]"
                style={{
                  background: '#161b25',
                  border: inviteCode ? '1.5px solid #22c55e' : '1.5px solid #1f2937',
                  height: '52px',
                }}
              />
            </div>

            {/* Error */}
            {error && (
              <div
                className="px-4 py-3 rounded-xl text-sm text-center"
                style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}
              >
                {error}
              </div>
            )}

            {/* Button */}
            <button
              onClick={handleLogin}
              disabled={loading || !username || !inviteCode}
              className="w-full rounded-2xl font-bold text-base transition-all disabled:opacity-40"
              style={{
                height: '52px',
                background: 'linear-gradient(135deg, #16a34a, #15803d)',
                color: '#fff',
                boxShadow: '0 4px 20px rgba(22,163,74,0.3)',
              }}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                  </svg>
                  جاري الدخول...
                </span>
              ) : 'تسجيل الدخول'}
            </button>
          </div>
        </div>

        {/* Footer flags */}
        <div className="flex justify-center gap-1.5 mt-6 opacity-30 text-lg flex-wrap px-4">
          {['🇸🇦','🇧🇷','🇫🇷','🇩🇪','🇦🇷','🇪🇸','🇵🇹','🇬🇧','🇳🇱','🇧🇪','🇺🇸','🇯🇵'].map(f => (
            <span key={f}>{f}</span>
          ))}
        </div>
      </div>
    </div>
  )
}
