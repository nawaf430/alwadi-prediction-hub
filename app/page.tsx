'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'

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

  const inputClass = 'bg-[#1a1a1e] border-[#2a2a2e] text-white h-12 text-base focus-visible:ring-primary focus-visible:border-primary'

  return (
    <div dir="rtl" className="min-h-screen bg-background flex items-center justify-center p-4 overflow-x-hidden">
      <div className="w-full max-w-[380px]">
        <Card className="border-border bg-card shadow-2xl py-0 overflow-hidden">
          <CardContent className="p-6">
            <div className="flex flex-col items-center mb-7">
              <div className="w-16 h-16 rounded-2xl bg-[#1a2e1a] flex items-center justify-center text-[40px] mb-4">
                ⚽
              </div>
              <h1 className="text-xl font-bold text-foreground">تحدي التوقعات</h1>
              <p className="text-muted-foreground text-sm mt-1">الوادي · كأس العالم 2026</p>
            </div>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-sm text-muted-foreground">اسمك في المنافسة</Label>
                <Input
                  dir="rtl"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm text-muted-foreground">رمز الدخول الشخصي</Label>
                <Input
                  dir="rtl"
                  value={inviteCode}
                  onChange={e => setInviteCode(e.target.value)}
                  className={inputClass}
                />
              </div>

              {error && (
                <p className="text-destructive-foreground bg-destructive/20 text-sm px-3 py-2 rounded-lg text-center">
                  {error}
                </p>
              )}

              <Button
                onClick={handleLogin}
                disabled={loading || !username || !inviteCode}
                className="w-full h-12 text-base font-bold bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                {loading ? 'جاري التحميل...' : 'تسجيل الدخول'}
              </Button>
            </div>
          </CardContent>
        </Card>
        <p className="text-center text-[#2a2a2e] text-[10px] mt-3">v1.0.1 · linked ✓</p>
      </div>
    </div>
  )
}
