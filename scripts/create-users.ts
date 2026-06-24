import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import * as path from 'path'
import ws from 'ws'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  realtime: { transport: ws },
})

// username → code
// Password = "username-code" e.g. "نواف-65"
// Email    = "u_<hex-encoded-username>@alwadi-wc.com"
const USERS: { username: string; code: string }[] = [
  { username: 'نواف',          code: '65' },
  { username: 'حمد',           code: '21' },
  { username: 'عبدالحميد',    code: '96' },
  { username: 'محمد الزيداني',        code: '60' },
  { username: 'محمد الخنيني',        code: '11' },
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
  { username: 'مؤيد',          code: '44' },
  { username: 'حمد الخالد',    code: '69' },
  { username: 'مساعد',  code: '83' },
]

function makeEmail(username: string): string {
  const sanitized = username.split('').map(c => c.charCodeAt(0).toString(16)).join('').substring(0, 20)
  return `u_${sanitized}@alwadi-wc.com`
}

async function main() {
  console.log(`Creating ${USERS.length} users...\n`)

  let created = 0
  let skipped = 0
  let failed = 0

  for (const { username, code } of USERS) {
    const fullCode = `${username}_${code}`
    const email = makeEmail(username)
    const password = fullCode

    // Create auth user (bypasses email confirmation)
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { username, invite_code: fullCode },
    })

    if (authError) {
      if (authError.message.includes('already been registered') || authError.message.includes('already exists')) {
        console.log(`⏭  SKIP   ${fullCode} — auth user already exists`)
        skipped++
      } else {
        console.error(`✗  FAIL   ${fullCode} — auth error: ${authError.message}`)
        failed++
      }
      continue
    }

    const userId = authData.user.id

    // Insert profile
    const { error: profileError } = await supabase.from('profiles').upsert({
      id: userId,
      username,
      invite_code_used: fullCode,
      total_points: 0,
      exact_scores: 0,
    }, { onConflict: 'id', ignoreDuplicates: false })

    if (profileError) {
      console.error(`✗  FAIL   ${fullCode} — profile error: ${profileError.message}`)
      failed++
      continue
    }

    // Check participants table for matching name → carry over points
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
      console.log(`✓  OK     ${fullCode} (carried over ${participant.total_points}pts from participants)`)
    } else {
      console.log(`✓  OK     ${fullCode}`)
    }

    created++
  }

  console.log(`\n─────────────────────────────`)
  console.log(`Created: ${created}  Skipped: ${skipped}  Failed: ${failed}`)
}

main().catch(err => {
  console.error('Fatal:', err.message)
  process.exit(1)
})
