#!/usr/bin/env node
/**
 * Run: DATABASE_URL="postgresql://..." node scripts/run-admin-sql.mjs
 * Get DATABASE_URL from Supabase → Project Settings → Database → Connection string (URI)
 */
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import pg from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
const sql = readFileSync(join(__dirname, '../supabase/admin_functions.sql'), 'utf8')
const url = process.env.DATABASE_URL

if (!url) {
  console.error('Missing DATABASE_URL. Add it to .env.local or pass inline.')
  process.exit(1)
}

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })

try {
  await client.connect()
  await client.query(sql)
  console.log('✅ admin_functions.sql applied successfully')
} catch (e) {
  console.error('❌ Failed:', e.message)
  process.exit(1)
} finally {
  await client.end()
}
