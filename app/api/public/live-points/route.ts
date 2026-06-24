import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-server'

function calcPoints(predH: number, predA: number, actualH: number, actualA: number): number {
  if (predH === actualH && predA === actualA) return 3
  const predOut = predH > predA ? 'H' : predH < predA ? 'A' : 'D'
  const actualOut = actualH > actualA ? 'H' : actualH < actualA ? 'A' : 'D'
  return predOut === actualOut ? 1 : 0
}

export type LivePointsResponse = {
  byUserId: Record<string, number>
  byParticipantId: Record<string, number>
}

export async function GET() {
  try {
    const supabase = createServiceClient()

    const { data: liveMatches } = await supabase
      .from('matches')
      .select('id, home_score, away_score')
      .eq('status', 'live')

    if (!liveMatches || liveMatches.length === 0) {
      return NextResponse.json({ byUserId: {}, byParticipantId: {} })
    }

    const liveIds = liveMatches.map(m => m.id)
    const liveMatchMap = new Map(liveMatches.map(m => [m.id, m]))

    const [userPredsRes, partPredsRes] = await Promise.all([
      supabase
        .from('predictions')
        .select('user_id, predicted_home, predicted_away, match_id')
        .in('match_id', liveIds),
      supabase
        .from('participant_predictions')
        .select('participant_id, predicted_home, predicted_away, match_id')
        .in('match_id', liveIds),
    ])

    const byUserId: Record<string, number> = {}
    for (const pred of (userPredsRes.data ?? [])) {
      const m = liveMatchMap.get(pred.match_id)
      if (!m || m.home_score === null || m.away_score === null) continue
      const pts = calcPoints(pred.predicted_home, pred.predicted_away, m.home_score, m.away_score)
      byUserId[pred.user_id] = (byUserId[pred.user_id] ?? 0) + pts
    }

    const byParticipantId: Record<string, number> = {}
    for (const pred of (partPredsRes.data ?? [])) {
      const m = liveMatchMap.get(pred.match_id)
      if (!m || m.home_score === null || m.away_score === null) continue
      const pts = calcPoints(pred.predicted_home, pred.predicted_away, m.home_score, m.away_score)
      byParticipantId[pred.participant_id] = (byParticipantId[pred.participant_id] ?? 0) + pts
    }

    return NextResponse.json({ byUserId, byParticipantId } satisfies LivePointsResponse)
  } catch {
    return NextResponse.json({ byUserId: {}, byParticipantId: {} })
  }
}
