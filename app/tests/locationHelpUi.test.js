import test from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { locationHelpHarness } from './helpers/locationHelpHarness.js'
import { clearLocationSelection, locationFailureMessage, recoverLocationAccess } from '../src/utils/locationAccess.js'

const user = { id: 'store-user' }, site = { id: 'site', name: 'Assigned Wash' }
const profile = { role: 'store', location_id: site.id, locations: site }
const Repair = () => null, Help = () => null, Nav = () => null

function provider() {
  let callback, sessionResolve, read = async () => ({ profile, locations: [site] }), calls = 0
  const timers = new Map(); let timer = 0
  const client = {
    auth: {
      onAuthStateChange(fn) { callback = fn; return { data: { subscription: { unsubscribe() {} } } } },
      getSession() { return new Promise(resolve => { sessionResolve = resolve }) },
      signOut() { assert.fail('Repair must not sign out') },
    },
  }
  const h = locationHelpHarness('contexts/AuthContext', {
    supabase: client, clearLocationSelection() {}, locationFailureMessage,
    recoverLocationAccess: async (...args) => { calls++; return read(...args) },
    setTimeout(fn) { const id = ++timer; timers.set(id, fn); return id },
    clearTimeout(id) { timers.delete(id) },
  }, {}, 'AuthProvider')
  h.render()
  return Object.assign(h, {
    value: () => h.render().props.value,
    event: session => callback('SIGNED_IN', session),
    session: value => sessionResolve(value),
    query: fn => { read = fn },
    runTimers() { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); h.render() },
    calls: () => calls,
  })
}

test('Help stays beside Sign Out with no profile/location, for Store and Admin, and opens its panel', () => {
  for (const profile of [null, { role: 'store' }, { role: 'admin' }]) {
    const h = locationHelpHarness('components/NavBar', {
      useAuth: () => ({ profile, signOut() {} }), useNavigate: () => () => {}, useLocation: () => ({ pathname: '/' }),
      useDarkModeCtx: () => [false, () => {}], Link: () => null, tmLogo: '', SettingsModal: () => null, TargetsBell: () => null, HelpPanel: Help,
    })
    const help = h.find(n => n.type === 'button' && n.props.children === 'Help')
    assert.equal(help.props['aria-haspopup'], 'dialog')
    assert.ok(h.find(n => n.type === 'button' && n.props.children === 'Sign Out'))
    help.props.onClick()
    assert.ok(h.find(n => n.type === Help))
  }
})

test('missing assignment, query failure, success and busy repair have clear UI outcomes', async () => {
  let calls = 0
  for (const state of [
    { profile, locations: [], locationError: '' },
    { profile: null, locations: [], locationError: 'Check your connection and try again.' },
    { profile, locations: [site], locationRepairMessage: 'Your locations have been reloaded.' },
  ]) {
    const h = locationHelpHarness('components/LocationRepair', { useAuth: () => ({ ...state, reloadMyLocation() { calls++ } }) })
    const text = h.find(n => n.type === 'p').props.children
    assert.ok(/Admin must assign|Check your connection|reloaded/.test(text))
    const button = h.find(n => n.type === 'button')
    assert.equal(button.props.children, 'Reload My Location'); button.props.onClick()
  }
  assert.equal(calls, 3)
  const h = locationHelpHarness('components/LocationRepair', { useAuth: () => ({ profile, locations: [], repairingLocation: true }) })
  assert.equal(h.find(n => n.type === 'button').props.disabled, true)
})

test('protected pages retain Help and recovery during profile failure or signed-in initialization', () => {
  for (const state of [{ user, loading: false, locationError: 'offline' }, { user, loading: true }]) {
    const h = locationHelpHarness('App', { useAuth: () => state, NavBar: Nav, LocationRepair: Repair }, {}, 'ProtectedRoute')
    assert.ok(h.find(n => n.type === Nav)); assert.ok(h.find(n => n.type === Repair))
  }
})

test('failed initial query remains retryable and manual repair rereads assignments and resets selection', async () => {
  const h = provider(); h.query(async () => { throw new Error('offline') })
  h.event({ user }); h.runTimers(); await h.flush()
  assert.match(h.value().locationError, /connection/)
  assert.equal(h.value().loading, false)
  h.query(async () => ({ profile, locations: [site] }))
  await h.value().reloadMyLocation(); await h.flush()
  assert.equal(h.calls(), 2)
  assert.deepEqual(h.value().locations, [site])
  assert.equal(h.value().locationSelectionVersion, 1)
  assert.match(h.value().locationRepairMessage, /reloaded/)
  assert.equal(h.value().locationError, '')
  h.event({ user }); h.runTimers(); await h.flush()
  assert.equal(h.calls(), 2, 'healthy token refresh does not reset forms')
  h.unmount()
})

test('failed initial fetch retries on the next same-user auth event and runs outside the callback', async () => {
  const h = provider(); h.query(async () => { throw new Error('offline') })
  h.event({ user }); assert.equal(h.calls(), 0)
  h.runTimers(); await h.flush()
  h.query(async () => ({ profile, locations: [site] }))
  h.event({ user }); h.runTimers(); await h.flush()
  assert.equal(h.calls(), 2); assert.deepEqual(h.value().locations, [site])
  h.unmount()
})

test('stale getSession and account requests cannot overwrite a later auth event or sign-out', async () => {
  const h = provider(); let finish
  h.query(() => new Promise(resolve => { finish = resolve }))
  h.event({ user }); h.runTimers()
  h.event(null)
  h.session({ data: { session: { user } } }); await h.flush()
  finish({ profile, locations: [site] }); await h.flush()
  assert.equal(h.value().user, null); assert.deepEqual(h.value().locations, []); assert.equal(h.value().profile, null)
  h.unmount()
})

test('account switch discards the old user response and commits only the new assignment', async () => {
  const h = provider(); let finish
  h.query(() => new Promise(resolve => { finish = resolve }))
  h.event({ user }); h.runTimers()
  h.query(async () => ({ profile: { ...profile, location_id: 'new' }, locations: [{ id: 'new' }] }))
  h.event({ user: { id: 'new-user' } }); h.runTimers(); await h.flush()
  finish({ profile, locations: [site] }); await h.flush()
  assert.equal(h.value().user.id, 'new-user'); assert.deepEqual(h.value().locations, [{ id: 'new' }])
  h.unmount()
})

test('manual no-assignment result explains Admin assignment and duplicate clicks do not duplicate reads', async () => {
  const h = provider(); h.event({ user }); h.runTimers(); await h.flush()
  let finish
  h.query(() => new Promise(resolve => { finish = resolve }))
  const repair = h.value().reloadMyLocation()
  await h.value().reloadMyLocation()
  finish({ profile: { role: 'store', location_id: null }, locations: [] })
  await repair; await h.flush()
  assert.equal(h.calls(), 2); assert.match(h.value().locationRepairMessage, /Admin must assign/)
  h.unmount()
})

test('getSession failure exits loading and a late session cannot clear a newer successful sign-in', async () => {
  const h = provider()
  h.session({ error: new Error('offline') }); await h.flush()
  assert.equal(h.value().loading, false)
  assert.match(h.value().locationError, /session could not be loaded/)
  h.event({ user }); h.runTimers(); await h.flush()
  assert.equal(h.value().locationError, '')
  assert.deepEqual(h.value().locations, [site])
  h.unmount()
  const late = provider()
  late.event({ user }); late.runTimers(); await late.flush()
  late.session({ data: { session: null } }); await late.flush()
  assert.equal(late.value().user.id, user.id)
  assert.deepEqual(late.value().locations, [site])
  late.unmount()
})


test('illustrated Edge fallback follows self-repair, uses the exact host and preserves all screenshot dimensions', () => {
  const assets = {
    edgeSettings: '/assets/edge-settings.png', edgeManageCookies: '/assets/edge-manage-cookies.png',
    edgeSiteData: '/assets/edge-site-data.png', edgeDeleteSite: '/assets/edge-delete-site.png',
  }
  const SelfRepair = () => 'Reload My Location'
  const h = locationHelpHarness('components/HelpPanel', {
    ...assets, LocationRepair: SelfRepair, window: { location: { hostname: 'ops.tmcw.app' } },
    useRef: () => ({ current: { showModal() {}, close() {} } }),
  }, { onClose() {} })
  assert.equal(h.find(n => n.type === 'details').props.open, undefined, 'fallback starts collapsed')
  const html = renderToStaticMarkup(h.render())
  assert.ok(html.indexOf('Reload My Location') < html.indexOf('<details'))
  assert.match(html, /ops\.tmcw\.app/)
  assert.match(html, /Do not use Delete displayed data or clear all browser cookies/)
  assert.match(html, /Leave github\.com, github\.dev and other unrelated sites alone/)
  assert.match(html, /Example only/)
  const screenshots = h.all(n => n.type?.name === 'EdgeScreenshot')
  assert.equal(screenshots.length, 4)
  for (const screenshot of screenshots) {
    const { src, width, height, alt } = screenshot.props
    const png = readFileSync(new URL(`../src/assets/help/${src.split('/').pop()}`, import.meta.url))
    assert.equal(png.readUInt32BE(16), width)
    assert.equal(png.readUInt32BE(20), height)
    assert.ok(alt)
    assert.ok(html.includes(`href="${src}"`), 'full-size image link is present')
  }
  assert.equal((html.match(/loading="lazy"/g) || []).length, 4)
  assert.equal((html.match(/h-auto w-full max-w-full/g) || []).length, 4)
  h.unmount()
})
