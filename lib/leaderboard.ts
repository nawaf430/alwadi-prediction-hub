import { supabase } from '@/lib/supabase'
import type { LivePointsResponse } from '@/app/api/public/live-points/route'

/**
 * Supabase/PostgREST caps unpaginated selects at 1000 rows. Tables like
 * participant_predictions can exceed that, silently undercounting anything
 * built from a single unpaginated fetch. This loops in pages until exhausted.
 */
async function fetchAllRows<T>(
  table: string,
  column: string,
): Promise<T[]> {
  const pageSize = 1000
  let from = 0
  const all: T[] = []
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(column)
      .range(from, from + pageSize - 1)
    if (error || !data) break
    all.push(...(data as unknown as T[]))
    if (data.length < pageSize) break
    from += pageSize
  }
  return all
}

export type LeaderboardEntry = {
  name: string
  total_points: number
  exact_scores: number
  prediction_count: number
  /** Projected points from currently-live matches (0 when no live match). */
  live_points: number
  type: 'user' | 'participant'
}

/**
 * Fetches profiles + participants, merges into a single sorted list.
 *
 * Live projected points come from /api/public/live-points (service-role key, so it
 * bypasses RLS and works for anonymous users on /public/leaderboard). Rankings are
 * sorted by (total_points + live_points) so they shift in real time while a match
 * is live, then settle on total_points once the match is finished and points are
 * permanently applied.
 */
export async function fetchCombinedLeaderboard(): Promise<LeaderboardEntry[]> {
  const [usersRes, participantsRes, userPredRows, partPredRows, liveRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, username, total_points, exact_scores, is_banned')
      .or('is_banned.eq.false,is_banned.is.null'),
    supabase
      .from('participants')
      .select('id, name, total_points, exact_scores'),
    fetchAllRows<{ user_id: string }>('predictions', 'user_id'),
    fetchAllRows<{ participant_id: string }>('participant_predictions', 'participant_id'),
    fetch('/api/public/live-points', { cache: 'no-store' })
      .then(r => r.json() as Promise<LivePointsResponse>)
      .catch(() => ({ byUserId: {}, byParticipantId: {} } as LivePointsResponse)),
  ])

  // Prediction counts
  const userPredCount = new Map<string, number>()
  for (const row of userPredRows) {
    userPredCount.set(row.user_id, (userPredCount.get(row.user_id) ?? 0) + 1)
  }
  const partPredCount = new Map<string, number>()
  for (const row of partPredRows) {
    partPredCount.set(row.participant_id, (partPredCount.get(row.participant_id) ?? 0) + 1)
  }

  const { byUserId, byParticipantId } = liveRes

  // Map participant name → participant_id so registered users can also pick up
  // live points from participant_predictions (admin enters predictions there,
  // keyed by participant, not into the predictions table).
  const nameToPartId = new Map<string, string>()
  for (const p of (participantsRes.data ?? [])) {
    nameToPartId.set((p.name as string).trim(), p.id as string)
  }

  const userEntries: LeaderboardEntry[] = (usersRes.data ?? []).map(u => {
    const fromPredictions = byUserId[u.id] ?? 0
    const partId = nameToPartId.get((u.username as string).trim())
    const fromParticipantPreds = partId ? (byParticipantId[partId] ?? 0) : 0
    const live_points = fromPredictions || fromParticipantPreds
    // Count from both tables — admin-entered predictions are in participant_predictions
    const userCount = userPredCount.get(u.id) ?? 0
    const partCount = partId ? (partPredCount.get(partId) ?? 0) : 0
    return {
      name: u.username as string,
      total_points: (u.total_points as number) ?? 0,
      exact_scores: (u.exact_scores as number) ?? 0,
      prediction_count: userCount || partCount,
      live_points,
      type: 'user' as const,
    }
  })

  const registeredNames = new Set(userEntries.map(u => u.name.trim()))

  const participantEntries: LeaderboardEntry[] = (participantsRes.data ?? [])
    .filter(p => !registeredNames.has((p.name as string).trim()))
    .map(p => ({
      name: p.name as string,
      total_points: (p.total_points as number) ?? 0,
      exact_scores: (p.exact_scores as number) ?? 0,
      prediction_count: partPredCount.get(p.id) ?? 0,
      live_points: byParticipantId[p.id] ?? 0,
      type: 'participant' as const,
    }))

  return [...userEntries, ...participantEntries].sort((a, b) => {
    const aTotal = a.total_points + a.live_points
    const bTotal = b.total_points + b.live_points
    if (bTotal !== aTotal) return bTotal - aTotal
    return b.exact_scores - a.exact_scores
  })
}
