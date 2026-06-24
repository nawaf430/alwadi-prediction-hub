/**
 * Applies supabase/match_minute.sql when DATABASE_URL or SUPABASE_DB_PASSWORD is set.
 * Otherwise prints the SQL to run in Supabase SQL Editor.
 */
import { readFileSync } from 'fs'
import { resolve } from 'path'
import pg from 'pg'
import * as dotenv from 'dotenv'

dotenv.config({ path: resolve(process.cwd(), '.env.local') })

async function main() {
  const sql = readFileSync(resolve(process.cwd(), 'supabase/match_minute.sql'), 'utf8')
  const dbUrl = process.env.DATABASE_URL?.trim()
  const dbPassword = process.env.SUPABASE_DB_PASSWORD?.trim()
  const ref = 'rnsberoabvqkhfrxmezq'

  let connectionString = dbUrl
  if (!connectionString && dbPassword) {
    connectionString =
      `postgresql://postgres.${ref}:${encodeURIComponent(dbPassword)}@aws-0-us-east-1.pooler.supabase.com:6543/postgres`
  }

  if (!connectionString) {
    console.log('No DATABASE_URL or SUPABASE_DB_PASSWORD — run this in Supabase SQL Editor:\n')
    console.log(sql)
    process.exit(1)
  }

  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    await client.query(sql)
    console.log('✓ match_minute migration applied')
  } finally {
    await client.end()
  }
}

main().catch(err => {
  console.error('Migration failed:', err.message)
  process.exit(1)
})
