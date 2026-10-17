import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { entryLocations, assignedStoreLocations, canAdminister, canEditOperationalLocation, canReadCompanyPerformance } from '../src/utils/permissions.js'

const a = { id: 'A', site_code: '001' }
const b = { id: 'B', site_code: '002' }
const store = { id: 'store', role: 'store', is_active: true, deleted_at: null, location_id: 'A', locations: a }

test('Store can read company performance but can edit only primary and explicit additional sites', () => {
  const sites = assignedStoreLocations(store, [{ locations: b }, { locations: a }, { locations: null }])
  assert.deepEqual(sites, [a, b])
  assert.equal(canReadCompanyPerformance(store), true)
  assert.equal(canAdminister(store), false)
  assert.equal(canEditOperationalLocation(store, sites, 'A'), true)
  assert.equal(canEditOperationalLocation(store, sites, 'B'), true)
  assert.equal(canEditOperationalLocation(store, sites, 'C'), false)
  assert.equal(canEditOperationalLocation(store, sites, null), false)
})

test('active unassigned Store can read company performance but has no operational write scope', () => {
  const unassigned = { ...store, location_id: null, locations: null }
  assert.deepEqual(assignedStoreLocations(unassigned), [])
  assert.equal(canReadCompanyPerformance(unassigned), true)
  assert.equal(canEditOperationalLocation(unassigned, [], 'A'), false)
})

test('Admin retains company administration and unrestricted location edits', () => {
  const admin = { ...store, role: 'admin' }
  assert.equal(canAdminister(admin), true)
  assert.equal(canReadCompanyPerformance(admin), true)
  assert.equal(canEditOperationalLocation(admin, [], 'C'), true)
})

test('inactive, deleted, absent, and legacy profiles receive no new role privileges', () => {
  for (const profile of [null, { ...store, is_active: false }, { ...store, deleted_at: '2026-10-17' }, { ...store, role: 'area_manager' }, { ...store, role: 'unknown' }]) {
    assert.equal(canAdminister(profile), false)
    assert.equal(canReadCompanyPerformance(profile), false)
    assert.equal(canEditOperationalLocation(profile, [a], 'A'), false)
    assert.deepEqual(assignedStoreLocations(profile, [{ locations: a }]), [])
  }
})

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
test('a Store with no primary location can edit explicitly assigned additional locations only', () => {
  const profile = { ...store, location_id: null, locations: null }
  const sites = assignedStoreLocations(profile, [{ locations: b }])
  assert.deepEqual(sites, [b])
  assert.equal(canEditOperationalLocation(profile, sites, 'B'), true)
  assert.equal(canEditOperationalLocation(profile, sites, 'A'), false)
  assert.equal(canAdminister(profile), false)
})

test('refreshed assignment scope removes revoked additional sites and a replaced primary site', () => {
  const primaryOnly = assignedStoreLocations(store, [])
  assert.equal(canEditOperationalLocation(store, primaryOnly, 'B'), false)
  const transferred = { ...store, location_id: 'B', locations: b }
  const transferredSites = assignedStoreLocations(transferred, [])
  assert.equal(canEditOperationalLocation(transferred, transferredSites, 'B'), true)
  assert.equal(canEditOperationalLocation(transferred, transferredSites, 'A'), false)
})

test('account management Edge Functions retain real authentication and require active Admins', () => {
  for (const file of ['admin-users', 'invite-user']) {
    const code = read(`../supabase/functions/${file}/index.ts`)
    assert.match(code, /auth.getUser\(\)/)
    assert.match(code, /is_active !== true/)
    assert.match(code, /deleted_at/)
    assert.doesNotMatch(code, /area_manager/)
  }
  assert.match(read('../supabase/functions/admin-users/index.ts'), /Only admins can reset passwords/)
  assert.match(read('../supabase/functions/invite-user/index.ts'), /prof.role !== 'admin'/)
})

test('profile conversion is not silently exposed in the local Admin UI', () => {
  const code = read('../src/pages/Admin.jsx')
  assert.match(code, /Legacy role — migration review required/)
  assert.match(code, /disabled=\{!\['admin', 'store'\].includes\(u.role\)\}/)
  assert.doesNotMatch(code, /area_manager/)
})

test('entry scope ignores reporting and retained Admin market filters for Store', () => {
  const sites = assignedStoreLocations(store, [{ locations: b }])
  for (const market of ['', 'Unassigned Market', '["West"]']) {
    assert.deepEqual(entryLocations(store, sites, market), [a, b])
    assert.equal(canEditOperationalLocation(store, sites, 'C'), false)
  }
  assert.deepEqual(entryLocations({ ...store, role: 'admin' }, [{ ...a, market: 'East' }, { ...b, market: 'West' }], 'West'), [{ ...b, market: 'West' }])
  const entry = readFileSync(new URL('../src/pages/Dashboard.jsx', import.meta.url), 'utf8')
  const reporting = readFileSync(new URL('../src/pages/Insights.jsx', import.meta.url), 'utf8')
  assert.match(entry, /tm_entry_market_filter/)
  assert.match(reporting, /tm_reporting_market_filter/)
  assert.doesNotMatch(entry + reporting, /['"]tm_market_filter['"]/)
})
