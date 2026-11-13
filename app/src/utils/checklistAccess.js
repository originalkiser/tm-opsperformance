import { validateEvidence } from './checklistRules.js'

const credentialKey = 'tm_checklist_guest_access'
// Hash-router fragments are not sent to the host. Remove the bearer immediately;
// keep it only in this tab so reload/resume never requires a shared login.
export function takeGuestAccess(location, history, storage, randomId = () => crypto.randomUUID()) {
  const fragment = location.hash || ''
  const queryAt = fragment.indexOf('?')
  const params = new URLSearchParams(queryAt < 0 ? '' : fragment.slice(queryAt + 1))
  const token = params.get('token')
  if (token !== null) {
    clearGuestAccess(storage)
    history.replaceState(history.state, '', `${location.pathname}${location.search}#/guest-checklists`)
    if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('This checklist QR link is not valid. Ask your Admin for a new code.')
    const access = { token, recoveryKey: randomId() }
    try { storage.setItem(credentialKey, JSON.stringify(access)) } catch { /* The open page can still work in memory. */ }
    return access
  }
  try {
    const access = JSON.parse(storage.getItem(credentialKey) || 'null')
    if (access && /^[a-f0-9]{64}$/.test(access.token) && typeof access.recoveryKey === 'string') return access
  } catch { /* Rescan instead of exposing an invalid stored credential. */ }
  return null
}
export function clearGuestAccess(storage) { try { storage.removeItem(credentialKey) } catch { /* No persistent state required. */ } }
export function checklistGuestUrl(location, token) {
  const url = new URL(location.href)
  url.search = ''; url.hash = `/guest-checklists?token=${encodeURIComponent(token)}`
  return url.href
}
export function normalizeChecklistResult(result) {
  if (!result?.submission?.id || !result.capabilities) throw new Error('Checklist state was not confirmed. Refresh before continuing.')
  return { row: result.submission, evidence: result.evidence || [], capabilities: result.capabilities }
}
export function createChecklistTransport(client, publicKey, { token = null, recoveryKey = null, fetcher = fetch } = {}) {
  async function request(action, fields = {}, signal) {
    const headers = { apikey: publicKey }
    if (!token) {
      const { data, error } = await client.auth.getSession()
      if (error || !data?.session?.access_token) throw new Error('Sign in again before using checklists.')
      headers.Authorization = `Bearer ${data.session.access_token}`
    }
    let body
    if (fields.file) {
      body = new FormData(); body.set('action', action)
      if (token) body.set('token', token)
      for (const [key, value] of Object.entries(fields)) if (value !== null && value !== undefined) body.set(key, value)
    } else {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify({ ...fields, action, ...(token ? { token } : {}) })
    }
    const response = await fetcher(`${client.supabaseUrl}/functions/v1/checklist-access`, { method: 'POST', headers, body, signal, cache: 'no-store', credentials: 'omit' })
    if (!response.ok) {
      let detail
      try { detail = await response.json() } catch { /* Keep a bounded neutral error. */ }
      const error = new Error(typeof detail?.error === 'string' ? detail.error : 'Checklist request was not confirmed. Refresh before continuing.')
      error.status = response.status
      throw error
    }
    return action === 'download' ? response.blob() : response.json()
  }
  const transport = {
    guest: !!token, recoveryKey: recoveryKey || 'authenticated', request,
    context: () => request('context'),
    start: async fields => normalizeChecklistResult(await request('start', fields)),
    load: async (id, signal) => normalizeChecklistResult(await request('read', { id }, signal)),
    beginCorrection: async row => normalizeChecklistResult(await request('begin_edit', { id: row.id, revision: row.base_revision || row.revision })),
    save: async (row, { answers, name, submit }) => normalizeChecklistResult(await request('save', { id: row.id, revision: row.revision, working_copy_id: row.working_copy_id || null, answers, manager_name: name, submit })),
    upload: async (row, file, item, kind) => {
      validateEvidence(file)
      await request('upload', { id: row.id, working_copy_id: row.working_copy_id || null, item_id: item, kind, file })
      return transport.load(row.id)
    },
    download: async (row, file, signal) => {
      const blob = await request('download', { id: row.id, attachment_id: file.id }, signal)
      validateEvidence(blob)
      // Check after the bytes arrive as well; never display a revoked transfer.
      await transport.load(row.id, signal)
      if (signal?.aborted) throw new Error('Evidence request canceled.')
      return blob
    },
    history: row => request('history', { id: row.id }),
  }
  return transport
}

// Context is already scoped by the server to this actor/QR. Never broaden a
// duplicate-start lookup to a public table or retry the creation request.
export async function findChecklistOccurrence(transport, { templateKey, periodDate, locationId }) {
  let offset = 0
  while (offset <= 10000) {
    const page = await transport.request('context', { ...(locationId ? { location_id: locationId } : {}), offset })
    const record = page.submissions.find(row => ['draft', 'submitted'].includes(row.status) && row.template_key === templateKey && row.period_date === periodDate && (!locationId || row.location_id === locationId))
    if (record) return record
    if (!page.has_more || !Number.isInteger(page.next_offset) || page.next_offset <= offset) return null
    offset = page.next_offset
  }
  return null
}
