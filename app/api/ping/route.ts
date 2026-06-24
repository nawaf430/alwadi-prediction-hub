import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-server'

export async function GET() {
  try {
    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('matches')
      .select('id')
      .limit(1)
      .maybeSingle()

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      ping_at: new Date().toISOString(),
      match: data,
    })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Server error' },
      { status: 500 }
    )
  }
}
