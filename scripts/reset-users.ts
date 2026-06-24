/**
 * Deletes all alwadi-wc.com auth users, then re-creates them with underscore separator.
 * Run after: GRANT ALL ON TABLE profiles TO service_role; in Supabase SQL Editor
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import * as path from 'path'
import ws from 'ws'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { realtime: { transport: ws } }
)

const USERS: { username: string; code: string }[] = [
  { username: 'نواف',          code: '65' },
  { username: 'حمد',           code: '21' },
  { username: 'عبدالحميد',    code: '96' },
  { username: 'محمد ع',        code: '60' },
  { username: 'محمد ص',        code: '11' },
  { username: 'محمد الحماد',   code: '79' },
  { username: 'احمد',           code: '15' },
  { username: 'ابو تركي',      code: '13' },
  { username: 'انس',           code: '73' },
  { username: 'تميم',          code: '91' },
  { username: 'ريان',          code: '84' },
  { username: 'حازم',          code: '27' },
  { username: 'ابو راكان',     code: '36' },
  { username: 'راكان',         code: '42' },
  { username: 'رامي',          code: '51' },
  { username: 'عبدالرحيم',    code: '38' },
  { username: 'عبدالله',      code: '64' },
  { username: 'عزام',          code: '47' },
  { username: 'عمر الخالد',    code: '22' },
  { username: 'ابو رعد',       code: '69' },
  { username: 'فيصل',          code: '39' },
  { username: 'مصطفى',        code: '58' },
  { username: 'نايف',          code: '23' },
  { username: 'يزيد',          code: '25' },
  { username: 'صالح',          code: '76' },
]

function makeEmail(username: string): string {
  const sanitized = username.split('').map(c => c.charCodeAt(0).toString(16)).join('').substring(0, 20)
  return `u_${sanitized}@alwadi-wc.com`
}

async function main() {
  // Step 1: delete all existing alwadi-wc.com auth users
  console.log('Fetching existing auth users...')
  const { data: listData, error: listErr } = await supabase.auth.admin.listUsers({ perPage: 200 })
  if (listErr) throw new Error(listErr.message)

  const existing = listData.users.filter(u => u.email?.endsWith('@alwadi-wc.com'))
  console.log(`Found ${existing.length} existing auth users — deleting...`)

  for (const u of existing) {
    const { error } = await supabase.auth.admin.deleteUser(u.id)
    if (error) console.error(`  ✗ delete ${u.email}: ${error.message}`)
    else console.log(`  ✓ deleted ${u.email}`)
  }

  // Also clear profiles table
  console.log('\nClearing profiles table...')
  const { error: delProfErr } = await supabase.from('profiles').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  if (delProfErr) {
    console.error('Could not clear profiles:', delProfErr.message)
    console.error('Make sure you ran: GRANT ALL ON TABLE profiles TO service_role;')
    process.exit(1)
  }
  console.log('Profiles cleared.\n')

  // Step 2: create fresh with underscore separator
  console.log(`Creating ${USERS.length} users with _ separator...\n`)
  let created = 0
  let failed = 0

  for (const { username, code } of USERS) {
    const fullCode = `${username}_${code}`   // e.g. "نواف_65"
    const email = makeEmail(username)
    const password = fullCode

    let userId: string

    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { username, invite_code: fullCode },
    })

    if (authError) {
      if (authError.message.includes('already been registered')) {
        // User exists — find their ID and update password + profile
        const { data: listData } = await supabase.auth.admin.listUsers({ perPage: 200 })
        const existing = listData?.users.find(u => u.email === email)
        if (!existing) {
          console.error(`✗ FAIL  ${fullCode}: could not locate existing user`)
          failed++
          continue
        }
        userId = existing.id
        await supabase.auth.admin.updateUserById(userId, { password })
      } else {
        console.error(`✗ FAIL  ${fullCode}: ${authError.message}`)
        failed++
        continue
      }
    } else {
      userId = authData.user.id
    }

    const { error: profErr } = await supabase.from('profiles').upsert({
      id: userId,
      username,
      invite_code_used: fullCode,
      total_points: 0,
      exact_scores: 0,
    }, { onConflict: 'id' })

    if (profErr) {
      console.error(`✗ FAIL  ${fullCode} (profile): ${profErr.message}`)
      failed++
      continue
    }

    // Carry over points from participants if exists
    const { data: participant } = await supabase
      .from('participants')
      .select('total_points, exact_scores')
      .eq('name', username)
      .maybeSingle()

    if (participant && (participant.total_points > 0 || participant.exact_scores > 0)) {
      await supabase.from('profiles').update({
        total_points: participant.total_points,
        exact_scores: participant.exact_scores,
      }).eq('id', userId)
      console.log(`✓ OK    ${fullCode}  (carried ${participant.total_points}pts from participants)`)
    } else {
      console.log(`✓ OK    ${fullCode}`)
    }

    created++
  }

  console.log(`\n─────────────────────────────`)
  console.log(`Created: ${created}  Failed: ${failed}`)
}

main().catch(err => {
  console.error('Fatal:', err.message)
  process.exit(1)
})
