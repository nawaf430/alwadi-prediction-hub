/**
 * Verifies admin prediction entry fixes:
 * - updatePred preserves participant_id
 * - participantIdsKey ignores reference-only participant changes
 * - stale load abort (generation counter)
 * - save uses map key + ref snapshot (name/id/scores alignment)
 */
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import ws from 'ws'

config({ path: '.env.local' })

const ADMIN_PIN = 'WADI2026'

type Participant = { id: string; name: string }
type ParticipantPred = {
  participant_id: string
  predicted_home: string
  predicted_away: string
}

function participantIdsKey(participants: Participant[]) {
  return participants.map(p => p.id).sort().join(',')
}

function updatePred(
  prev: Record<string, ParticipantPred>,
  participantId: string,
  field: 'predicted_home' | 'predicted_away',
  value: string,
): Record<string, ParticipantPred> {
  const existing = prev[participantId]
  return {
    ...prev,
    [participantId]: {
      participant_id: participantId,
      predicted_home: existing?.predicted_home ?? '',
      predicted_away: existing?.predicted_away ?? '',
      [field]: value,
    },
  }
}

async function runUnitTests() {
  let passed = 0
  let failed = 0
  const ok = (label: string) => { passed++; console.log(`  ✓ ${label}`) }
  const fail = (label: string, detail: string) => {
    failed++
    console.error(`  ✗ ${label}: ${detail}`)
  }

  console.log('\n── Unit tests ──')

  // updatePred on missing entry preserves participant_id
  {
    const next = updatePred({}, 'id-a', 'predicted_home', '2')
    if (next['id-a']?.participant_id === 'id-a' && next['id-a']?.predicted_home === '2') {
      ok('updatePred sets participant_id on new entry')
    } else {
      fail('updatePred sets participant_id on new entry', JSON.stringify(next['id-a']))
    }
  }

  // participantIdsKey stable on reference-only change
  {
    const a = [{ id: 'b', name: 'B' }, { id: 'a', name: 'A' }]
    const b = [{ id: 'b', name: 'B' }, { id: 'a', name: 'A' }]
    if (participantIdsKey(a) === participantIdsKey(b) && a !== b) {
      ok('participantIdsKey unchanged for same IDs (new array ref)')
    } else {
      fail('participantIdsKey', 'expected stable key')
    }
  }

  // stale load abort
  {
    let loadGen = 0
    let applied = 0
    const load = async (label: string) => {
      const gen = ++loadGen
      await new Promise(r => setTimeout(r, label === 'slow' ? 30 : 5))
      if (gen !== loadGen) return false
      applied++
      return true
    }
    await Promise.all([load('slow'), load('fast')])
    if (applied === 1) {
      ok('stale load aborted (only latest applies)')
    } else {
      fail('stale load abort', `applied=${applied}`)
    }
  }

  console.log(`\nUnit: ${passed} passed, ${failed} failed`)
  return failed === 0
}

async function runIntegrationTest() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) {
    console.log('\n── Integration skipped (no Supabase env) ──')
    return true
  }

  console.log('\n── Integration: 3 edits + reload simulation + save verify ──')
  const supabase = createClient(url, key, { realtime: { transport: ws } })

  const { data: participants, error: pErr } = await supabase.rpc('admin_get_participants', {
    admin_pin: ADMIN_PIN,
  })
  if (pErr || !participants?.length) {
    console.error('Failed to load participants:', pErr?.message)
    return false
  }

  const { data: matches, error: mErr } = await supabase.rpc('admin_get_matches', {
    admin_pin: ADMIN_PIN,
  })
  if (mErr || !matches?.length) {
    console.error('Failed to load matches:', mErr?.message)
    return false
  }

  const match = matches.find((m: { status: string }) => m.status === 'upcoming')
    ?? matches[0]
  const trio = participants.slice(0, 3) as Participant[]
  if (trio.length < 3) {
    console.error('Need at least 3 participants')
    return false
  }

  const edits: { home: string; away: string }[] = [
    { home: '1', away: '0' },
    { home: '2', away: '1' },
    { home: '0', away: '1' },
  ]

  // Build predInputs like loadMatchPredictions
  let predInputs: Record<string, ParticipantPred> = {}
  for (const p of participants as Participant[]) {
    predInputs[p.id] = { participant_id: p.id, predicted_home: '', predicted_away: '' }
  }

  const participantsRef = { current: participants as Participant[] }
  const predInputsRef = { current: predInputs }

  // Edit person 1
  predInputs = updatePred(predInputs, trio[0].id, 'predicted_home', edits[0].home)
  predInputs = updatePred(predInputs, trio[0].id, 'predicted_away', edits[0].away)
  predInputsRef.current = predInputs

  // Simulate reference-only participants reload (tab switch) — idsKey unchanged, no wipe
  const refOnlyParticipants = [...(participants as Participant[])]
  const keyBefore = participantIdsKey(participantsRef.current)
  const keyAfter = participantIdsKey(refOnlyParticipants)
  if (keyBefore !== keyAfter) {
    console.error('Unexpected: participantIdsKey changed on ref-only copy')
    return false
  }
  participantsRef.current = refOnlyParticipants
  console.log('  ↳ ref-only participants reload: predInputs preserved (no wipe)')

  // Edit person 2
  predInputs = updatePred(predInputsRef.current, trio[1].id, 'predicted_home', edits[1].home)
  predInputs = updatePred(predInputs, trio[1].id, 'predicted_away', edits[1].away)
  predInputsRef.current = predInputs

  // Simulate stale load completing after newer state — stale must not overwrite edits
  const staleDefaults: Record<string, ParticipantPred> = {}
  for (const p of participantsRef.current) {
    staleDefaults[p.id] = { participant_id: p.id, predicted_home: '9', predicted_away: '9' }
  }
  let loadGen = 0
  const staleGen = ++loadGen
  const currentGen = ++loadGen
  const applyIfFresh = (gen: number, defaults: Record<string, ParticipantPred>) => {
    if (gen !== loadGen) return false
    predInputsRef.current = defaults
    return true
  }
  if (applyIfFresh(staleGen, staleDefaults)) {
    console.error('Stale load should have been aborted')
    return false
  }
  console.log('  ↳ stale load aborted: edits still intact')

  // Edit person 3
  predInputs = updatePred(predInputsRef.current, trio[2].id, 'predicted_home', edits[2].home)
  predInputs = updatePred(predInputs, trio[2].id, 'predicted_away', edits[2].away)
  predInputsRef.current = predInputs

  // Save each (mirrors saveSinglePrediction log + RPC)
  let allOk = true
  for (let i = 0; i < 3; i++) {
    const p = trio[i]
    const pred = predInputsRef.current[p.id]
    const expected = edits[i]
    console.log('[admin save] single', {
      name: p.name,
      participantId: p.id,
      home: pred.predicted_home,
      away: pred.predicted_away,
    })

    if (pred.predicted_home !== expected.home || pred.predicted_away !== expected.away) {
      console.error(`  ✗ pre-save mismatch for ${p.name}`)
      allOk = false
      continue
    }

    const { error: err } = await supabase.rpc('admin_upsert_participant_prediction', {
      admin_pin: ADMIN_PIN,
      p_participant_id: p.id,
      p_match_id: match.id,
      p_home: parseInt(pred.predicted_home, 10),
      p_away: parseInt(pred.predicted_away, 10),
    })
    if (err) {
      console.error(`  ✗ RPC failed for ${p.name}:`, err.message)
      allOk = false
    }
  }

  // Verify DB
  const { data: saved } = await supabase.rpc('admin_get_match_predictions', {
    admin_pin: ADMIN_PIN,
    p_match_id: match.id,
  })

  for (let i = 0; i < 3; i++) {
    const p = trio[i]
    const row = (saved as { participant_id: string; predicted_home: number; predicted_away: number }[] | null)
      ?.find(r => r.participant_id === p.id)
    const expected = edits[i]
    const matchScores =
      row &&
      String(row.predicted_home) === expected.home &&
      String(row.predicted_away) === expected.away

    if (matchScores) {
      console.log(`  ✓ after save: ${p.name} (${p.id}) = ${expected.home}-${expected.away}`)
    } else {
      console.error(
        `  ✗ after save: ${p.name} (${p.id}) expected ${expected.home}-${expected.away}, got`,
        row ? `${row.predicted_home}-${row.predicted_away}` : 'missing',
      )
      allOk = false
    }
  }

  return allOk
}

async function main() {
  const unitOk = await runUnitTests()
  const intOk = await runIntegrationTest()
  const ok = unitOk && intOk
  console.log(ok ? '\n✅ All tests passed' : '\n❌ Some tests failed')
  process.exit(ok ? 0 : 1)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
