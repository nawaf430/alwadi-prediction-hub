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

function makeEmail(username: string): string {
  const sanitized = username.split('').map(c => c.charCodeAt(0).toString(16)).join('').substring(0, 20)
  return `u_${sanitized}@alwadi-wc.com`
}

async function main() {
  const username = 'فهد'
  const code = '62'
  const fullCode = `${username}_${code}`
  const email = makeEmail(username)
  const password = fullCode

  console.log(`Creating ${fullCode} (${email})...\n`)

  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username, invite_code: fullCode },
  })

  if (authError) {
    console.error(`✗ FAIL  ${fullCode}: ${authError.message}`)
    process.exit(1)
  }

  const userId = authData.user.id

  const { error: profileError } = await supabase.from('profiles').upsert({
    id: userId,
    username,
    invite_code_used: fullCode,
    total_points: 0,
    exact_scores: 0,
  }, { onConflict: 'id' })

  if (profileError) {
    console.error(`✗ FAIL  ${fullCode} (profile): ${profileError.message}`)
    process.exit(1)
  }

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
  } else if (participant) {
    console.log(`✓ OK    ${fullCode}  (participant found, 0 pts)`)
  } else {
    console.log(`✓ OK    ${fullCode}`)
  }
}

main().catch(err => {
  console.error('Fatal:', err.message)
  process.exit(1)
})
