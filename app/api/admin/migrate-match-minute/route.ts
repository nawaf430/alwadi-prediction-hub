import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-server'

function isAuthorized(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET
  if (req.headers.get('x-cron-secret') === cronSecret) return true
  if (req.headers.get('authorization') === `Bearer ${cronSecret}`) return true
  return false
}

/** Apply match_minute column migration via RPC (requires supabase/match_minute.sql run once). */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()

  const { error: checkErr } = await supabase.from('matches').select('match_minute').limit(1)
  if (!checkErr) {
    return NextResponse.json({ ok: true, already_applied: true })
  }

  const { error: migrateErr } = await supabase.rpc('admin_apply_match_minute_schema', {
    admin_pin: 'WADI2026',
  })

  if (migrateErr) {
    return NextResponse.json({
      ok: false,
      error: migrateErr.message,
      hint: 'Run supabase/match_minute.sql once in Supabase SQL Editor, then retry.',
    }, { status: 500 })
  }

  const { error: verifyErr } = await supabase.from('matches').select('match_minute').limit(1)
  return NextResponse.json({
    ok: !verifyErr,
    migrated: !verifyErr,
    verify_error: verifyErr?.message,
  })
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const { error } = await supabase.from('matches').select('match_minute').limit(1)
  return NextResponse.json({ ok: true, match_minute_column: !error })
}
