// Exercise the real browser transport and real Edge handler together without network access.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createChecklistTransport, takeGuestAccess } from '../src/utils/checklistAccess.js'
import { checklistAccess } from '../supabase/functions/checklist-access/handler.js'

const id = '00000000-0000-0000-0000-000000000010'
const attachmentId = '00000000-0000-0000-0000-000000000020'
const userId = '00000000-0000-0000-0000-000000000030'
const token = 'a'.repeat(64)
const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0])

function fixture({ guest = true } = {}) {
  const calls = [], uploads = [], headers = []
  let revoked = false, revokeDuringDownload = false, authReads = 0
  const row = { id, revision: 1, status: 'draft', answers: {}, manager_name: '' }
  const result = () => ({ submission: { ...row }, evidence: [], capabilities: { can_edit: true } })
  const browserClient = {
    supabaseUrl: 'https://fixture.invalid',
    auth: { async getSession() { return { data: { session: { access_token: 'fictional-account-jwt' } } } } },
  }
  const userClient = { auth: { async getUser() { authReads++; return { data: { user: { id: userId } } } } } }
  const serverClient = {
    async rpc(name, args) {
      calls.push({ name, ...args })
      if (revoked) return { error: { code: '42501', message: 'Access revoked' } }
      if (args.p_action === 'upload_begin') return { data: { upload_id: attachmentId, object_path: `${id}/${attachmentId}.png` } }
      if (args.p_action === 'upload_finish') return { data: { attachment: { id: attachmentId, kind: 'signature', item_id: null } } }
      if (args.p_action === 'download') return { data: { object_path: `${id}/${attachmentId}.png`, attachment_id: attachmentId } }
      if (args.p_action === 'save') {
        assert.equal(typeof args.p_body.manager_name, 'string')
        row.answers = args.p_body.answers; row.manager_name = args.p_body.manager_name; row.revision++
      }
      return { data: result() }
    },
    storage: { from(bucket) {
      assert.equal(bucket, 'manager-checklist-evidence')
      return {
        async upload(path, data, options) { uploads.push({ path, data, options }); return { data: { path } } },
        async download() { if (revokeDuringDownload) revoked = true; return { data: new Blob([png], { type: 'image/png' }) } },
      }
    } },
  }
  const fetcher = async (url, options) => {
    assert.equal(url, 'https://fixture.invalid/functions/v1/checklist-access')
    assert.equal(options.cache, 'no-store'); assert.equal(options.credentials, 'omit')
    headers.push(options.headers)
    return checklistAccess(new Request(url, options), userClient, serverClient)
  }
  const transport = createChecklistTransport(browserClient, 'fictional-publishable-key', { ...(guest ? { token, recoveryKey: 'fictional-tab' } : {}), fetcher })
  return { transport, calls, uploads, headers, row, authReads: () => authReads, revokeDownload: () => { revokeDuringDownload = true } }
}

test('guest transport to Edge preserves unnamed draft saves and hashes capability without trusting account identity', async () => {
  const f = fixture()
  const saved = await f.transport.save(f.row, { answers: {}, name: '', submit: false })
  assert.equal(saved.row.manager_name, ''); assert.equal(saved.row.revision, 2)
  assert.equal(f.authReads(), 0)
  assert.equal(f.calls[0].p_actor, null)
  assert.match(f.calls[0].p_token_hash, /^[a-f0-9]{64}$/)
  assert.notEqual(f.calls[0].p_token_hash, token)
  assert.equal('token' in f.calls[0].p_body, false)
  assert.equal('Authorization' in f.headers[0], false)
})

test('authenticated transport to Edge derives identity from getUser instead of request fields', async () => {
  const f = fixture({ guest: false })
  await f.transport.load(id)
  assert.equal(f.authReads(), 1)
  assert.equal(f.calls[0].p_actor, userId)
  assert.equal(f.calls[0].p_token_hash, null)
  assert.equal(f.headers[0].Authorization, 'Bearer fictional-account-jwt')
})

test('multipart signature traverses transport and Edge with generated private path and explicit read-back', async () => {
  const f = fixture()
  await f.transport.upload(f.row, new Blob([png], { type: 'image/png' }), null, 'signature')
  assert.deepEqual(f.calls.map(call => call.p_action), ['upload_begin', 'upload_finish', 'read'])
  assert.equal(f.uploads.length, 1)
  assert.equal(f.uploads[0].path, `${id}/${attachmentId}.png`)
  assert.equal(f.uploads[0].options.upsert, false)
  assert.equal(f.uploads[0].options.cacheControl, '0')
  assert.equal(f.calls[0].p_body.item_id ?? null, null)
})

test('revocation during evidence transfer is rejected before the browser receives a viewable blob', async () => {
  const f = fixture(); f.revokeDownload()
  await assert.rejects(f.transport.download(f.row, { id: attachmentId }), error => error.status === 403)
  assert.deepEqual(f.calls.map(call => call.p_action), ['download', 'download'])
})

test('an invalid replacement QR cannot restore previously stored store access on reload', () => {
  const values = new Map([['tm_checklist_guest_access', JSON.stringify({ token, recoveryKey: 'old-store' })]])
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
  const history = { state: {}, replaceState() {} }
  assert.throws(() => takeGuestAccess({ hash: '#/guest-checklists?token=invalid', pathname: '/', search: '' }, history, storage))
  assert.equal(takeGuestAccess({ hash: '#/guest-checklists', pathname: '/', search: '' }, history, storage), null)
})
