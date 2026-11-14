import test from 'node:test'
import assert from 'node:assert/strict'
import { locationHelpHarness } from './helpers/locationHelpHarness.js'
import { validateChecklist, validateEvidence, checklistTimestamp, isChecklistItemActive, checklistPeriod, localChecklistDate } from '../src/utils/checklistRules.js'
import { findChecklistOccurrence } from '../src/utils/checklistAccess.js'

const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : node?.props ? text(node.props.children) : ''
const button = (h, label) => h.find(n => n.type === 'button' && text(n) === label)
const question = { id: 'one', section: 'Checks', number: 1, text: 'Is the area ready?', type: 'choice', options: ['Yes', 'No'], failure_values: ['No'] }
const template = { key: 'opening', name: 'Fictional Opening', cadence: 'daily', definition: [question], timezone: 'America/Chicago' }
const base = { id: 'fictional-record', created_by: 'fictional-user', location_id: 'fictional-site', template_key: 'opening', period_date: '2026-11-13', status: 'draft', revision: 3, updated_at: '2026-11-13T18:00:00Z', submitted_at: null, answers: { one: { value: 'Yes' } }, manager_name: 'Fictional Manager', template_snapshot: template }
const caps = { can_edit: true, can_upload: true, can_begin_edit: false, can_discard: false }
const finalSignature = { id: 'fictional-signature', kind: 'signature', item_id: null }
function form({ guest = true, row = base, evidence = [finalSignature], cached = null } = {}) {
  let state = { row: structuredClone(row), evidence: structuredClone(evidence), capabilities: { ...caps } }, saveError = null, readError = null, confirm = true
  const calls = [], confirmations = [], saved = [], events = new Map(), cache = new Map()
  const key = `tm_checklist_draft_${guest ? 'fictional-tab' : 'fictional-user'}_${row.id}_${row.working_copy_id || 'original'}`
  if (cached) cache.set(key, JSON.stringify(cached))
  const transport = {
    guest, recoveryKey: 'fictional-tab',
    async load() { calls.push({ action: 'read' }); if (readError) throw readError; return structuredClone(state) },
    async save(record, values) { calls.push({ action: 'save', record: structuredClone(record), values: structuredClone(values) }); if (saveError) throw saveError; state = { ...state, row: { ...record, revision: record.revision + 1, answers: values.answers, manager_name: values.name, status: values.submit ? 'submitted' : 'draft' } }; return structuredClone(state) },
    async upload() { calls.push({ action: 'upload' }); return structuredClone(state) },
  }
  const h = locationHelpHarness('components/ChecklistForm', {
    supabase: { from() { throw Error('Shared transport must enforce access') } }, validateChecklist, validateEvidence, checklistTimestamp, isChecklistItemActive, ChecklistSignature: () => null,
    window: { confirm(message) { confirmations.push(message); return confirm }, history: { state: {} }, location: { href: 'https://example.invalid/' }, addEventListener: (k, v) => events.set(k, v), removeEventListener: k => events.delete(k) },
    document: { addEventListener() {}, removeEventListener() {} },
    sessionStorage: { getItem: k => cache.get(k) || null, setItem: (k, v) => cache.set(k, v), removeItem: k => cache.delete(k) },
    URL: { revokeObjectURL() {} }, AbortController,
  }, { initial: row, initialEvidence: evidence, initialCapabilities: caps, transport, user: guest ? undefined : { id: 'fictional-user' }, onSaved: value => saved.push(value), onClose() {} })
  return { ...h, calls, confirmations, saved, cache, events, key, state: value => { state = structuredClone(value) }, failSave: value => { saveError = value }, failRead: value => { readError = value }, confirm: value => { confirm = value } }
}
const footer = h => h.find(n => n.props?.['aria-label'] === 'Checklist save and submit')
function attachTarget(node) {
  const calls = []
  node.ref({ focus: options => calls.push(['focus', options]), scrollIntoView: options => calls.push(['scroll', options]) })
  return calls
}
for (const scenario of ['question', 'photo', 'item signature', 'final signature', 'name']) test(`mobile validation scrolls to first invalid ${scenario} and preserves entered answers`, async () => {
  const item = { ...question, photo_required: scenario === 'photo', signature_required: scenario === 'item signature' }
  const row = { ...base, template_snapshot: { ...template, definition: [item] }, answers: { one: { value: scenario === 'question' ? '' : 'Yes', explanation: 'Keep this entered text' } }, manager_name: scenario === 'name' ? '' : base.manager_name }
  const h = form({ row, evidence: scenario === 'final signature' ? [] : [finalSignature] }); await h.flush()
  const node = scenario === 'photo' ? h.find(n => n.props?.['aria-label'] === 'Photo evidence one') : scenario === 'item signature' ? h.find(n => n.props?.['aria-label'] === 'Required signature one') : scenario === 'final signature' ? h.find(n => n.props?.['aria-label'] === 'Final auditor signature') : scenario === 'name' ? h.find(n => n.type === 'label' && typeof n.ref === 'function') : h.find(n => n.type === 'div' && n.key?.endsWith('$one'))
  const moved = attachTarget(node)
  button(h, 'Submit').props.onClick(); await h.flush()
  assert.deepEqual(moved.map(c => c[0]), ['focus', 'scroll'])
  assert.equal(h.calls.filter(c => c.action === 'save').length, 0)
  assert.equal(h.find(n => n.type === 'textarea').props.value, 'Keep this entered text')
  assert.match(text(footer(h)), scenario === 'question' ? /Is the area ready\?.*Choose a response/ : scenario === 'photo' ? /Is the area ready\?.*Required photo missing/ : scenario === 'item signature' ? /Required signature missing/ : scenario === 'final signature' ? /Draw and save your signature/ : /Enter your full manager name/)
  h.unmount()
})
test('signature drawing explains the disabled Submit beside the drawing and footer; clear/save state unblocks it', async () => {
  const h = form(); await h.flush()
  const signature = h.find(n => n.props?.onDirty)
  signature.props.onDirty(true); await h.flush()
  assert.equal(button(h, 'Submit').props.disabled, true)
  assert.match(text(h.find(n => n.props?.['aria-label'] === 'Final auditor signature')), /Save this drawn signature before submitting/)
  assert.match(text(footer(h)), /Save your drawn signature before submitting/)
  signature.props.onDirty(false); await h.flush()
  assert.equal(button(h, 'Submit').props.disabled, false); h.unmount()
})
for (const guest of [true, false]) test(`${guest ? 'QR' : 'account'} conflict retains local recovery, requires explicit reload consent, then uses latest revision`, async () => {
  const h = form({ guest }); await h.flush()
  h.find(n => n.type === 'input' && n.props['aria-label'] === 'Manager full name').props.onChange({ target: { value: 'Unsaved local name' } }); await h.flush()
  h.failSave(Object.assign(new Error('Checklist changed elsewhere. Reload before saving.'), { status: 409 }))
  await button(h, 'Save Draft').props.onClick(); await h.flush()
  assert.match(text(footer(h)), /A newer saved version exists/)
  assert.equal(h.saved.length, 0)
  assert.match(h.cache.get(h.key), /Unsaved local name/)
  assert.equal(button(h, 'Save Draft').props.disabled, true)
  h.state({ row: { ...base, revision: 8, manager_name: 'Latest saved name' }, evidence: [finalSignature], capabilities: caps })
  await h.events.get('focus')(); await h.flush()
  assert.equal(h.find(n => n.props?.['aria-label'] === 'Manager full name').props.value, 'Unsaved local name')
  h.confirm(false); const reads = h.calls.filter(c => c.action === 'read').length
  await button(h, 'Reload Latest Saved Version').props.onClick(); await h.flush()
  assert.equal(h.calls.filter(c => c.action === 'read').length, reads)
  assert.match(h.confirmations.at(-1), /Unsaved answers and signature drawings on this device may be lost/)
  assert.match(h.cache.get(h.key), /Unsaved local name/)
  h.confirm(true); h.failSave(null)
  await button(h, 'Reload Latest Saved Version').props.onClick(); await h.flush()
  assert.equal(h.find(n => n.props?.['aria-label'] === 'Manager full name').props.value, 'Latest saved name')
  assert.equal(h.cache.has(h.key), false); assert.equal(button(h, 'Reload Latest Saved Version'), undefined)
  assert.equal(h.calls.filter(c => c.action === 'save').length, 1)
  await button(h, 'Save Draft').props.onClick(); await h.flush()
  assert.equal(h.calls.filter(c => c.action === 'save').at(-1).record.revision, 8); h.unmount()
})
test('failed confirmed reload keeps local recovery and honors revoked access', async () => {
  const h = form(); await h.flush()
  h.find(n => n.props?.['aria-label'] === 'Manager full name').props.onChange({ target: { value: 'Keep me' } }); await h.flush()
  h.failSave(Object.assign(new Error('Checklist changed elsewhere'), { status: 409 }))
  await button(h, 'Save Draft').props.onClick(); await h.flush()
  h.failRead(Object.assign(new Error('Access revoked'), { status: 403 }))
  await button(h, 'Reload Latest Saved Version').props.onClick(); await h.flush()
  assert.match(text(footer(h)), /Access revoked/); assert.match(h.cache.get(h.key), /Keep me/)
  assert.equal(button(h, 'Save Draft'), undefined); assert.equal(h.saved.length, 0); h.unmount()
})
test('tab draft recovery remains explicit after reopening; no save is triggered by restoration', async () => {
  const cached = { revision: 1, answers: { one: { value: 'No', explanation: 'Recovered local response' } }, name: 'Recovered local name' }
  const h = form({ cached }); await h.flush()
  assert.equal(h.find(n => n.props?.['aria-label'] === 'Manager full name').props.value, base.manager_name)
  assert.deepEqual(JSON.parse(h.cache.get(h.key)), cached)
  button(h, 'Restore unsaved answers').props.onClick(); await h.flush()
  assert.equal(h.find(n => n.type === 'textarea').props.value, 'Recovered local response')
  assert.equal(h.calls.filter(c => c.action === 'save').length, 0)
  await button(h, 'Save Draft').props.onClick(); await h.flush()
  assert.equal(h.calls.at(-1).record.revision, 3); assert.equal(h.calls.at(-1).values.answers.one.explanation, 'Recovered local response'); h.unmount()
})
test('ordinary save and submission failures are actionable at the bottom without resetting entries or retrying', async () => {
  for (const action of ['Save Draft', 'Submit']) {
    const h = form(); await h.flush(); h.failSave(new Error('Connection interrupted'))
    await button(h, action).props.onClick(); await h.flush()
    assert.match(text(footer(h)), /Connection interrupted.*Nothing was retried automatically.*Refresh/)
    assert.equal(h.calls.filter(c => c.action === 'save').length, 1); assert.equal(h.saved.length, 0)
    assert.equal(h.find(n => n.props?.['aria-label'] === 'Manager full name').props.value, base.manager_name); h.unmount()
  }
})
const occurrence = { templateKey: 'opening', periodDate: base.period_date, locationId: base.location_id }
test('duplicate lookup paginates authorized context and matches exact site, template and immutable period', async () => {
  const calls = []
  const transport = { async request(action, fields) { calls.push({ action, fields }); return fields.offset ? { submissions: [base], has_more: false } : { submissions: [{ ...base, location_id: 'other' }, { ...base, period_date: '2026-11-12' }, { ...base, template_key: 'closing' }], has_more: true, next_offset: 100 } } }
  assert.deepEqual(await findChecklistOccurrence(transport, occurrence), base)
  assert.deepEqual(calls.map(c => c.fields.offset), [0, 100]); assert.ok(calls.every(c => c.action === 'context' && c.fields.location_id === base.location_id))
})
test('duplicate lookup never bypasses denials, offers a discarding row, or loops on broken pagination', async () => {
  await assert.rejects(findChecklistOccurrence({ request: async () => { throw Object.assign(new Error('Denied'), { status: 403 }) } }, occurrence), /Denied/)
  let reads = 0
  assert.equal(await findChecklistOccurrence({ request: async () => { reads++; return { submissions: [{ ...base, status: 'discarding' }], has_more: true, next_offset: 0 } } }, occurrence), null)
  assert.equal(reads, 1)
})
function page({ guest, record = base, deny = false, deferred = false } = {}) {
  const calls = [], opened = [], route = { search: '' }; let contexts = 0, finish
  const context = () => ({ location: { id: base.location_id, site_code: 'Fictional', timezone: 'America/Chicago' }, templates: [template], submissions: [], has_more: false, server_now: '2026-11-13T18:00:00Z' })
  const transport = {
    async start(fields) { calls.push(['start-fields', fields]); calls.push('start'); throw Object.assign(new Error('Already exists'), { status: 409 }) },
    async request(action, fields) { calls.push({ action, fields }); contexts++; if (guest && contexts === 1) return context(); if (deferred) await new Promise(r => { finish = r }); if (deny) throw Object.assign(new Error('Denied'), { status: 403 }); return { ...context(), submissions: record ? [record] : [] } },
    async load(id) { calls.push(['read', id]); return { row: record, evidence: [], capabilities: caps } },
  }
  const client = { from(table) { return { select() { return this }, in() { return this }, gte() { return this }, lte() { return this }, order() { return this }, then(resolve) { return Promise.resolve({ data: table === 'checklist_templates' ? [template] : [] }).then(resolve) } } }, async rpc() { calls.push('start'); return { error: { code: '23505', message: 'Duplicate key' } } } }
  const h = locationHelpHarness(guest ? 'pages/GuestChecklists' : 'pages/ManagerChecklists', {
    useLocation: () => route, useAuth: () => ({ user: { id: 'fictional-user' }, profile: { role: 'store', is_active: true }, locations: [{ id: base.location_id, timezone: 'America/Chicago', site_code: 'Fictional' }] }),
    window: { location: {}, history: {} }, sessionStorage: {}, takeGuestAccess: () => ({ recoveryKey: 'fictional' }), clearGuestAccess() {}, createChecklistTransport: () => transport, findChecklistOccurrence,
    supabase: client, supabasePublicKey: 'fictional', checklistPeriod, localChecklistDate: () => '2026-11-13', checklistTimestamp, completionStatus: () => 'Available',
    ChecklistForm: () => null, ChecklistAccessForm: () => null, ChecklistQrAdmin: () => null, ChecklistOpenWork: () => null, ChecklistAdmin: () => null, NavBar: () => null, Link: () => null,
  })
  return { ...h, calls, opened, route, finish: () => finish?.() }
}
for (const guest of [true, false]) for (const status of ['draft', 'submitted']) test(`${guest ? 'QR' : 'account'} duplicate start offers explicit reopen of authorized ${status}, without retrying start`, async () => {
  const h = page({ guest, record: { ...base, status } }); await h.flush()
  assert.ok(button(h, 'Start checklist'), JSON.stringify(h.all(n => n.type === 'p' || n.type === 'button').map(text)))
  await button(h, 'Start checklist').props.onClick(); await h.flush()
  if (guest) assert.equal(h.calls.find(c => Array.isArray(c) && c[0] === 'start-fields')[1].period_date, base.period_date)
  assert.ok(button(h, 'Reopen Existing Checklist')); assert.equal(h.calls.filter(c => c === 'start').length, 1)
  assert.match(text(h.find(n => n.props?.role === 'alert')), /already exists for this reporting period/)
  await button(h, 'Reopen Existing Checklist').props.onClick(); await h.flush()
  assert.ok(h.find(n => n.props?.initial?.id === base.id || n.props?.initial?.row?.id === base.id))
  assert.equal(h.calls.filter(c => c === 'start').length, 1); h.unmount()
})
for (const guest of [true, false]) test(`${guest ? 'QR' : 'account'} duplicate lookup denial never offers inaccessible work`, async () => {
  const h = page({ guest, deny: true }); await h.flush()
  assert.ok(button(h, 'Start checklist'), JSON.stringify(h.all(n => n.type === 'p' || n.type === 'button').map(text)))
  await button(h, 'Start checklist').props.onClick(); await h.flush()
  assert.equal(button(h, 'Reopen Existing Checklist'), undefined)
  assert.match(text(h.find(n => n.props?.role === 'alert')), /Denied/)
  assert.equal(h.calls.filter(c => c === 'start').length, 1); h.unmount()
})
test('late duplicate lookup from a previous QR route cannot offer or open its record', async () => {
  const h = page({ guest: true, deferred: true }); await h.flush()
  const starting = button(h, 'Start checklist').props.onClick(); await h.flush()
  h.unmount(); h.finish(); await starting
  assert.equal(h.calls.filter(c => Array.isArray(c) && c[0] === 'read').length, 0)
})

for (const guest of [true, false]) test(`${guest ? 'QR' : 'account'} duplicate with no accessible exact occurrence requires refresh rather than opening a substitute`, async () => {
  const h = page({ guest, record: { ...base, period_date: '2026-11-12' } }); await h.flush()
  await button(h, 'Start checklist').props.onClick(); await h.flush()
  assert.equal(button(h, 'Reopen Existing Checklist'), undefined)
  assert.match(text(h.find(n => n.props?.role === 'alert')), /already exists.*[Rr]efresh/)
  assert.equal(h.calls.filter(c => c === 'start').length, 1); h.unmount()
})
test('a conflicted correction cannot be silently replaced by a focus read of the official version', async () => {
  const row = { ...base, status: 'submitted', working_copy_id: 'fictional-correction', base_revision: 3, revision: 2 }
  const h = form({ row }); await h.flush()
  h.find(n => n.props?.['aria-label'] === 'Manager full name').props.onChange({ target: { value: 'Local correction' } }); await h.flush()
  h.failSave(Object.assign(new Error('Checklist changed elsewhere'), { status: 409 }))
  await button(h, 'Save Draft').props.onClick(); await h.flush()
  h.state({ row: { ...base, status: 'submitted', revision: 4 }, evidence: [finalSignature], capabilities: { ...caps, can_edit: false } })
  await h.events.get('focus')(); await h.flush()
  assert.equal(h.find(n => n.props?.['aria-label'] === 'Manager full name').props.value, 'Local correction')
  assert.match(h.cache.get(h.key), /Local correction/)
  assert.ok(button(h, 'Reload Latest Saved Version')); assert.equal(h.saved.length, 0); h.unmount()
})
