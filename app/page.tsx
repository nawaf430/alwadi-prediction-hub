'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Label } from '@/components/ui/label'

export default function LoginPage() {
  const router = useRouter()
  const [tab, setTab] = useState<'register' | 'login'>('register')
  const [inviteCode, setInviteCode] = useState('')
  const [username, setUsername] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // The user enters just the number (e.g. "65"); we combine it with their name
  // to form the full invite code: "نواف-65"
  function buildFullCode(name: string, num: string) {
    return `${name.trim()}_${num.trim()}`
  }

  // Collision-free login email derived from a SHA-256 hash of the username.
  // The previous scheme hex-encoded the name and truncated to 20 chars, so any
  // two names sharing a 20-hex-char prefix (e.g. "محمد ال...") collided to the
  // same email. SHA-256 removes that entire class of collisions.
  async function deriveEmail(name: string): Promise<string> {
    const data = new TextEncoder().encode(name.trim())
    const buf = await crypto.subtle.digest('SHA-256', data)
    const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
    return `u_${hex.substring(0, 32)}@alwadi-wc.com`
  }

  async function handleRegister() {
    setLoading(true)
    setError('')

    if (!username.trim() || !inviteCode.trim()) {
      setError('يرجى ملء جميع الحقول')
      setLoading(false)
      return
    }

    const fullCode = buildFullCode(username, inviteCode)

    console.log('[register] username raw:', JSON.stringify(username))
    console.log('[register] inviteCode raw:', JSON.stringify(inviteCode))
    console.log('[register] fullCode built:', JSON.stringify(fullCode))
    console.log('[register] fullCode chars:', [...fullCode].map(c => `${c}(U+${c.charCodeAt(0).toString(16).padStart(4,'0')})`).join(' '))

    const { data: code, error: codeError } = await supabase
      .from('invite_codes')
      .select('*')
      .eq('code', fullCode)
      .eq('is_active', true)
      .single()

    console.log('[register] supabase response data:', code)
    console.log('[register] supabase response error:', codeError)

    if (!code) {
      setError('رمز الدخول غير صحيح أو منتهي الصلاحية')
      setLoading(false)
      return
    }

    if (code.times_used >= code.max_uses) {
      setError('رمز الدخول ممتلئ')
      setLoading(false)
      return
    }

    const { data: existing } = await supabase
      .from('profiles')
      .select('id')
      .eq('username', username.trim())
      .single()

    if (existing) {
      setError('هذا الاسم مستخدم بالفعل، اختر اسماً آخر')
      setLoading(false)
      return
    }

    const fakeEmail = await deriveEmail(username)
    const password = fullCode  // e.g. "نواف-65"

    const { data: auth, error: authError } = await supabase.auth.signUp({
      email: fakeEmail,
      password,
      options: { data: { username: username.trim(), invite_code: fullCode } },
    })

    if (authError || !auth.user) {
      setError('حدث خطأ، حاول مرة أخرى')
      setLoading(false)
      return
    }

    await supabase.from('profiles').insert({
      id: auth.user.id,
      username: username.trim(),
      invite_code_used: fullCode,
    })

    await supabase.from('invite_codes').update({ times_used: code.times_used + 1 }).eq('id', code.id)

    // If a participant row with the same name exists, carry over their points
    const { data: participant } = await supabase
      .from('participants')
      .select('id, total_points, exact_scores')
      .eq('name', username.trim())
      .maybeSingle()

    if (participant) {
      await supabase.from('profiles').update({
        total_points: participant.total_points,
        exact_scores: participant.exact_scores,
      }).eq('id', auth.user.id)
    }

    router.push('/dashboard')
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

    console.log('[login] username raw:', JSON.stringify(username))
    console.log('[login] inviteCode raw:', JSON.stringify(inviteCode))
    console.log('[login] fullCode built:', JSON.stringify(fullCode))

    const fakeEmail = await deriveEmail(username)
    const password = fullCode  // e.g. "نواف-65"

    console.log('[login] fakeEmail:', fakeEmail)
    console.log('[login] password:', JSON.stringify(password))

    let { error: authError } = await supabase.auth.signInWithPassword({ email: fakeEmail, password })

    // Transitional fallback: accounts created under the legacy truncated-email
    // scheme still resolve until their email is migrated. Safe to remove once
    // every auth user has been migrated to the SHA-256 email.
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

  const inputClass = "bg-[#1a1a1e] border-[#2a2a2e] text-white h-12 text-base placeholder:text-muted-foreground focus-visible:ring-primary focus-visible:border-primary"

  return (
    <div dir="rtl" className="min-h-screen bg-background flex items-center justify-center p-4 overflow-x-hidden">
      <div className="w-full max-w-[380px]">
        <Card className="border-border bg-card shadow-2xl py-0 overflow-hidden">
          <CardContent className="p-6">
            {/* Logo */}
            <div className="flex flex-col items-center mb-7">
              <div className="w-16 h-16 rounded-2xl bg-[#1a2e1a] flex items-center justify-center text-[40px] mb-4">
                ⚽
              </div>
              <h1 className="text-xl font-bold text-foreground">تحدي التوقعات</h1>
              <p className="text-muted-foreground text-sm mt-1">الوادي · كأس العالم 2026</p>
            </div>

            {/* Tabs */}
            <Tabs
              value={tab}
              onValueChange={(v) => { setTab(v as 'register' | 'login'); setError('') }}
              className="w-full"
            >
              <TabsList className="w-full h-11 bg-[#1a1a1e] p-1 mb-5">
                <TabsTrigger
                  value="register"
                  className="flex-1 h-full text-sm font-semibold data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=inactive]:text-muted-foreground"
                >
                  تسجيل
                </TabsTrigger>
                <TabsTrigger
                  value="login"
                  className="flex-1 h-full text-sm font-semibold data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=inactive]:text-muted-foreground"
                >
                  دخول
                </TabsTrigger>
              </TabsList>

              {/* Shared fields — rendered once, outside TabsContent to avoid remounting */}
              <div className="space-y-4 pt-2">
                <div className="space-y-1.5">
                  <Label className="text-sm text-muted-foreground">اسمك في المنافسة</Label>
                  <Input
                    dir="rtl"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    placeholder="اكتب اسمك كما أرسله لك المسؤول"
                    className={inputClass}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm text-muted-foreground">رمز الدخول الشخصي</Label>
                  <Input
                    dir="rtl"
                    value={inviteCode}
                    onChange={e => setInviteCode(e.target.value)}
                    placeholder="مثال: 65"
                    className={inputClass}
                  />
                </div>

                {error && (
                  <p className="text-destructive-foreground bg-destructive/20 text-sm px-3 py-2 rounded-lg text-center">
                    {error}
                  </p>
                )}

                <TabsContent value="register" className="mt-0">
                  <Button
                    onClick={handleRegister}
                    disabled={loading || !username || !inviteCode}
                    className="w-full h-12 text-base font-bold bg-primary hover:bg-primary/90 text-primary-foreground"
                  >
                    {loading ? 'جاري التحميل...' : 'انضم الآن'}
                  </Button>
                </TabsContent>

                <TabsContent value="login" className="mt-0">
                  <Button
                    onClick={handleLogin}
                    disabled={loading || !username || !inviteCode}
                    className="w-full h-12 text-base font-bold bg-primary hover:bg-primary/90 text-primary-foreground"
                  >
                    {loading ? 'جاري التحميل...' : 'دخول'}
                  </Button>
                </TabsContent>
              </div>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
