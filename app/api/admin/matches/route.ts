import { adminUnauthorized, verifyAdminPin } from '@/lib/admin-api'
import { createServiceClient } from '@/lib/supabase-server'

export async function GET(request: Request) {
  if (!verifyAdminPin(request)) return adminUnauthorized()

  try {
    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('matches')
      .select('*')
      .order('kickoff_time', { ascending: true })

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
    const { id, home_score, away_score, status } = body

    if (!id) {
      return Response.json({ error: 'معرف المباراة مطلوب' }, { status: 400 })
    }

    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('matches')
      .update({
        home_score: home_score ?? 0,
        away_score: away_score ?? 0,
        status: status ?? 'not_started',
      })
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
