import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchLocationAccess, recoverLocationAccess, clearLocationSelection, entryLocationOptions, resolveEntryLocation } from '../src/utils/locationAccess.js'

const own = { id: 'own', market: 'East' }, other = { id: 'other', market: 'West' }
function api(profile, { profileError, locationError, mappings = [] } = {}) {
  const calls = []
  const client = { from(table) {
    const call = { table, filters: [] }; calls.push(call)
    const query = {
      select() { return query },
      eq(key, value) { call.filters.push([key, value]); return query },
      single: async () => ({ data: profile, error: profileError }),
      order: async () => ({ data: [own, other], error: locationError }),
      then(resolve) { return Promise.resolve({ data: mappings, error: locationError }).then(resolve) },
    }
    return query
  }, auth: { refreshSession() { assert.fail('No session refresh expected') } } }
  return { client, calls }
}

test('Store reads only its freshly fetched profile assignment; no company location fallback', async () => {
  const { client, calls } = api({ role: 'store', location_id: 'own', locations: own })
  const result = await fetchLocationAccess(client, 'user')
  assert.deepEqual(result.locations, [own])
  assert.deepEqual(calls, [{ table: 'user_profiles', filters: [['id', 'user']] }])
})

test('genuine missing assignment is empty; inaccessible or mismatched assignment is an error', async () => {
  const none = api({ role: 'store', location_id: null })
  assert.deepEqual((await fetchLocationAccess(none.client, 'user')).locations, [])
  for (const locations of [null, other]) {
    const { client } = api({ role: 'store', location_id: 'own', locations })
    await assert.rejects(fetchLocationAccess(client, 'user'), /assigned location is unavailable/)
  }
})

test('Admin and Area Manager keep their existing query scopes', async () => {
  const admin = api({ role: 'admin' })
  assert.deepEqual((await fetchLocationAccess(admin.client, 'admin')).locations, [own, other])
  assert.equal(admin.calls[1].table, 'locations')
  const manager = api({ role: 'area_manager' }, { mappings: [{ locations: own }] })
  assert.deepEqual((await fetchLocationAccess(manager.client, 'manager')).locations, [own])
  assert.deepEqual(manager.calls[1], { table: 'manager_locations', filters: [['manager_id', 'manager']] })
})

test('query errors and rejected requests propagate rather than masquerading as missing assignments', async () => {
  for (const role of ['store', 'admin', 'area_manager']) {
    const { client } = api({ role }, { profileError: { code: 'offline' } })
    await assert.rejects(fetchLocationAccess(client, 'user'), e => e.code === 'offline')
  }
  for (const role of ['admin', 'area_manager']) {
    const { client } = api({ role }, { locationError: { code: '42501' } })
    await assert.rejects(fetchLocationAccess(client, 'user'), e => e.code === '42501')
  }
  await assert.rejects(fetchLocationAccess({ from() { throw new Error('offline') } }, 'user'), /offline/)
})

test('expired session refreshes once, validates identity and rereads current assignments', async () => {
  const { client } = api({ role: 'store', location_id: 'own', locations: own })
  const from = client.from; let reads = 0, refreshes = 0
  client.from = table => {
    if (++reads === 1) return { select() { return this }, eq() { return this }, single: async () => ({ error: { code: 'PGRST301' } }) }
    return from(table)
  }
  client.auth.refreshSession = async () => { refreshes++; return { data: { session: { user: { id: 'user' } } } } }
  assert.deepEqual((await recoverLocationAccess(client, 'user')).locations, [own])
  assert.equal(reads, 2); assert.equal(refreshes, 1)
})

test('network errors, denied access and missing assignments do not trigger authentication refresh', async () => {
  for (const code of ['offline', '42501', 'PGRST116']) {
    const { client } = api(null, { profileError: { code } })
    await assert.rejects(recoverLocationAccess(client, 'user'), e => e.code === code)
  }
  const { client } = api({ role: 'store', location_id: null })
  assert.deepEqual((await recoverLocationAccess(client, 'user')).locations, [])
})

test('failed refresh, identity change and repeated JWT failures stop safely', async () => {
  for (const result of [{ error: { message: 'expired' } }, { data: { session: null } }, { data: { session: { user: { id: 'different' } } } }]) {
    const { client } = api(null, { profileError: { status: 401 } })
    client.auth.refreshSession = async () => result
    await assert.rejects(recoverLocationAccess(client, 'user'), /sign in again/)
  }
  const { client } = api(null, { profileError: { status: 401 } }); let calls = 0
  client.auth.refreshSession = async () => { calls++; return { data: { session: { user: { id: 'user' } } } } }
  await assert.rejects(recoverLocationAccess(client, 'user'), e => e.status === 401)
  assert.equal(calls, 1)
})

test('repair clears only site selection preferences, preserving authentication, dates and reports', () => {
  const data = new Map(['tm_selected_location', 'tm_market_filter', 'tm_entry_market_filter', 'sb-auth-token', 'tm_selected_date', 'tm_active_tab', 'tm_reports_filter'].map(key => [key, 'value']))
  clearLocationSelection({ removeItem: key => data.delete(key) })
  assert.deepEqual([...data.keys()], ['sb-auth-token', 'tm_selected_date', 'tm_active_tab', 'tm_reports_filter'])
  assert.doesNotThrow(() => clearLocationSelection({ removeItem() { throw new Error('Storage disabled') } }))
})

test('stale saved sites and market filters cannot hide a valid Store assignment; switching stays in scope', () => {
  const stores = entryLocationOptions({ role: 'store' }, [own], 'West')
  assert.deepEqual(stores, [own])
  assert.equal(resolveEntryLocation(stores, 'deleted-site'), 'own')
  assert.equal(resolveEntryLocation([], 'old-site'), null)
  assert.equal(resolveEntryLocation([own, other], 'own'), 'own')
  assert.equal(resolveEntryLocation([own, other], 'other'), 'other')
  assert.equal(resolveEntryLocation([own, other], 'outside'), null)
  assert.deepEqual(entryLocationOptions({ role: 'admin' }, [own, other], 'West'), [other])
  assert.deepEqual(entryLocationOptions({ role: 'admin' }, [own, other], 'obsolete-market'), [own, other])
})
