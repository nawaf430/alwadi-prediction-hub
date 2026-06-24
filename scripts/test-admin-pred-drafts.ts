/**
 * Unit tests for unified admin prediction draft (admin_pred_draft key).
 * Run: npx tsx scripts/test-admin-pred-drafts.ts
 */

import {
  ADMIN_PRED_DRAFT_KEY,
  LEGACY_DRAFT_PREFIX,
  clearUnifiedDraft,
  loadDraftWithMigration,
  loadUnifiedDraft,
  migrateLegacyDrafts,
  saveUnifiedDraft,
  type UnifiedPredDraft,
} from '../lib/admin-pred-drafts'
import {
  collectSaveRows,
  hasUnsavedChanges,
  type PredGrid,
  type SavedSnapshot,
} from '../lib/admin-pred-grid'

const storage = new Map<string, string>()

function installMockLocalStorage() {
  const g = globalThis as typeof globalThis & { localStorage?: Storage; window?: Window & typeof globalThis }
  g.window = g as Window & typeof globalThis
  g.localStorage = {
    get length() { return storage.size },
    key(i: number) { return [...storage.keys()][i] ?? null },
    getItem(k: string) { return storage.get(k) ?? null },
    setItem(k: string, v: string) { storage.set(k, v) },
    removeItem(k: string) { storage.delete(k) },
    clear() { storage.clear() },
  }
}

function ok(label: string) { console.log(`  ✓ ${label}`) }
function fail(label: string, detail: string) {
  console.error(`  ✗ ${label}: ${detail}`)
  process.exitCode = 1
}

installMockLocalStorage()

console.log('\n── Unified draft tests ──')

const matchA = 'match-a'
const matchB = 'match-b'
const p1 = 'participant-1'
const p2 = 'participant-2'

// Save/load unified draft
{
  storage.clear()
  const draft: UnifiedPredDraft = {
    selectedMatchIds: [matchA, matchB],
    predGrid: {
      [p1]: {
        [matchA]: { home: '2', away: '1' },
        [matchB]: { home: '0', away: '0' },
      },
    },
    savedSnapshot: {},
    updatedAt: new Date().toISOString(),
  }
  saveUnifiedDraft(draft)
  const loaded = loadUnifiedDraft()
  if (loaded?.selectedMatchIds.length === 2 && loaded.predGrid[p1][matchA].home === '2') {
    ok('unified draft save/load')
  } else {
    fail('unified draft save/load', JSON.stringify(loaded))
  }
}

// Legacy migration
{
  storage.clear()
  storage.set(`${LEGACY_DRAFT_PREFIX}${matchA}`, JSON.stringify({
    matchId: matchA,
    predInputs: {
      [p1]: { participant_id: p1, predicted_home: '1', predicted_away: '0' },
    },
    savedPredSet: [],
    editingPreds: [],
    updatedAt: '2026-06-20T10:00:00Z',
  }))
  const migrated = migrateLegacyDrafts()
  if (migrated?.predGrid[p1]?.[matchA]?.home === '1' && !storage.has(`${LEGACY_DRAFT_PREFIX}${matchA}`)) {
    ok('legacy per-match draft migrated and removed')
  } else {
    fail('legacy migration', JSON.stringify(migrated))
  }
}

// loadDraftWithMigration
{
  storage.clear()
  saveUnifiedDraft({
    selectedMatchIds: [matchB],
    predGrid: { [p2]: { [matchB]: { home: '3', away: '3' } } },
    savedSnapshot: {},
    updatedAt: new Date().toISOString(),
  })
  const d = loadDraftWithMigration()
  if (d?.predGrid[p2]?.[matchB]?.home === '3') ok('loadDraftWithMigration')
  else fail('loadDraftWithMigration', '')
}

// Multi-match unsaved detection
{
  const grid: PredGrid = {
    [p1]: {
      [matchA]: { home: '2', away: '1' },
      [matchB]: { home: '1', away: '1' },
    },
  }
  const snapshot: SavedSnapshot = {
    [p1]: { [matchA]: { home: 2, away: 1 } },
  }
  if (hasUnsavedChanges(grid, snapshot, [matchA, matchB])) ok('detects unsaved on match B')
  else fail('hasUnsavedChanges', 'expected true')

  if (!hasUnsavedChanges(grid, snapshot, [matchA])) ok('match A fully saved')
  else fail('match A saved check', '')
}

// collectSaveRows across matches
{
  const grid: PredGrid = {
    [p1]: {
      [matchA]: { home: '2', away: '0' },
      [matchB]: { home: '', away: '' },
    },
    [p2]: {
      [matchA]: { home: '1', away: '1' },
    },
  }
  const rows = collectSaveRows(grid, [matchA, matchB])
  if (rows.length === 2) ok(`collectSaveRows found ${rows.length} complete entries`)
  else fail('collectSaveRows', `got ${rows.length}`)
}

// Simulated multi-match workflow (no wipe on deselect)
{
  storage.clear()
  let grid: PredGrid = { [p1]: { [matchA]: { home: '2', away: '1' } } }
  let selected = [matchA, matchB]

  // Deselect match A column — data stays in grid
  selected = [matchB]
  if (grid[p1][matchA]?.home === '2') ok('deselecting match keeps grid data')

  saveUnifiedDraft({
    selectedMatchIds: selected,
    predGrid: grid,
    savedSnapshot: {},
    updatedAt: new Date().toISOString(),
  })

  const restored = loadUnifiedDraft()
  if (restored?.predGrid[p1]?.[matchA]?.home === '2') ok('draft preserves deselected match data')
  else fail('draft after deselect', '')
}

clearUnifiedDraft()
if (!loadUnifiedDraft()) ok('clearUnifiedDraft')

console.log(process.exitCode ? '\n❌ Some tests failed' : '\n✅ All draft tests passed')
