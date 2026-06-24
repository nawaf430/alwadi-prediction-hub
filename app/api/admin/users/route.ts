import { adminUnauthorized, verifyAdminPin } from '@/lib/admin-api'
import { createServiceClient } from '@/lib/supabase-server'

export async function GET(request: Request) {
  if (!verifyAdminPin(request)) return adminUnauthorized()

  try {
    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('profiles')
      .select('id, username, total_points, exact_scores, is_banned, invite_code_used')
      .order('username', { ascending: true })

    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json(data)
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'Server error' },
      { status: 500 }
    )
  }
}

export async function PATCH(request: Request) {
  if (!verifyAdminPin(request)) return adminUnauthorized()

  try {
    const body = await request.json()
    const { id, is_banned } = body

    if (!id || typeof is_banned !== 'boolean') {
      return Response.json({ error: 'بيانات غير صالحة' }, { status: 400 })
    }

    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('profiles')
      .update({ is_banned })
      .eq('id', id)
      .select()
      .single()

    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json(data)
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'Server error' },
      { status: 500 }
    )
  }
}
