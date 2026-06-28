import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-server'
import { ADMIN_PIN } from '@/lib/constants'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { admin_pin, participant_id, match_id } = body

  if (admin_pin !== ADMIN_PIN) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const { error } = await supabase
    .from('participant_predictions')
    .delete()
    .eq('participant_id', participant_id)
    .eq('match_id', match_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
