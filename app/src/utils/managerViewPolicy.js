// Presentation safety only. Authentication, authorization and RLS remain unchanged.
export const MANAGER_VIEW_MESSAGE = 'Manager View is read-only. Switch to Admin View to make changes.'
let readOnly = false, pending = 0
export function setManagerViewReadOnly(value) { readOnly = value === true }
export function managerViewReadOnly() { return readOnly }
export function pendingViewWrites() { return pending }
export function assertViewWritable() { if (readOnly) throw new Error(MANAGER_VIEW_MESSAGE) }
export async function withViewWrite(action) {
  assertViewWritable(); pending++
  try { return await action() } finally { pending-- }
}
export function viewStorageKey(id) { return `tm_manager_view:${id}` }
export function loadManagerView(storage, userId) {
  try { const value = JSON.parse(storage?.getItem(viewStorageKey(userId)) || '{}'); return { manager: value.manager === true, site: typeof value.site === 'string' ? value.site : '' } }
  catch { return { manager: false, site: '' } }
}
export function managerViewState(user, profile, locations, preference) {
  const allowed = !!user && profile?.role === 'admin' && profile.is_active === true && !profile.deleted_at
  const active = allowed && preference.manager === true
  const site = locations.some(l => l.id === preference.site) ? preference.site : locations[0]?.id || ''
  return { allowed, active, site }
}
const readRpcs = new Set(['dashboard_mtd_performance','dashboard_membership_snapshots','get_checklist_compliance','approved_employee_name_mappings','can_maintain_employee_roster','can_propose_employee_mapping','weekly_labor_planner'])
export async function isViewReadRequest(input, init = {}) {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, 'https://local.invalid')
  const method = (init.method || input?.method || 'GET').toUpperCase()
  if (['GET','HEAD','OPTIONS'].includes(method)) return true
  if (method === 'POST' && /\/auth\/v1\/(token|logout)$/.test(url.pathname)) return true
  if (method === 'POST' && /\/storage\/v1\/object\/(sign|list)(\/|$)/.test(url.pathname)) return true
  if (method === 'POST' && url.pathname.includes('/rest/v1/rpc/')) return readRpcs.has(url.pathname.split('/').pop())
  if (method === 'POST' && url.pathname.endsWith('/functions/v1/checklist-access')) {
    try {
      const body = init.body ?? await input.clone().text()
      const action = typeof body === 'string' ? JSON.parse(body).action : body?.get?.('action')
      return ['context','read','history','download'].includes(action)
    } catch { return false }
  }
  return false
}
export function createViewFetch(fetcher) {
  return async (input, init = {}) => {
    const safe = await isViewReadRequest(input, init)
    if (readOnly && !safe) return new Response(JSON.stringify({ error: MANAGER_VIEW_MESSAGE, message: MANAGER_VIEW_MESSAGE, code: 'MANAGER_VIEW_READ_ONLY' }), { status: 403, headers: { 'Content-Type': 'application/json' } })
    if (!safe) pending++
    try { return await fetcher(input, init) } finally { if (!safe) pending-- }
  }
}
export const viewFetch = (...args) => createViewFetch(globalThis.fetch.bind(globalThis))(...args)
