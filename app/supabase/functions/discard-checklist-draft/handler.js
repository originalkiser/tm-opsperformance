// Dependency-injected for local tests. Privileged client is server-only and never accepts a caller path.
const bucket = 'manager-checklist-evidence'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
export async function discardDraft(req, userClient, storageClient) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405)
  const { data, error } = await userClient.auth.getUser()
  if (error || !data?.user) return json({ error: 'Sign in again before discarding.' }, 401)
  let frozen = false
  try {
    const body = await req.json(), id = body?.id
    if (!uuid.test(id) || !Number.isSafeInteger(body.revision) || body.revision < 1) return json({ error: 'Draft ID and revision required' }, 400)
    // RPC runs with the caller JWT: active account + own authorized draft or active Admin.
    const begin = await userClient.rpc('begin_discard_checklist', { p_id: id, p_revision: body.revision })
    if (begin.error) throw new Error(begin.error.message)
    if (begin.data?.id !== id || begin.data?.status !== 'discarding') throw new Error('Draft freeze not confirmed')
    frozen = true
    const files = storageClient.storage.from(bucket)
    // Always delete the first page, including uploads that never registered an attachment.
    // A bounded pass avoids an unbounded request; failures leave a resumable frozen draft.
    let previousPage = ''
    for (let batch = 0; batch < 20; batch++) {
      const listed = await files.list(id, { limit: 500, offset: 0, sortBy: { column: 'name', order: 'asc' } })
      if (listed.error) throw new Error(listed.error.message)
      if (!Array.isArray(listed.data)) throw new Error('Evidence listing unavailable')
      if (!listed.data.length) {
        const finish = await userClient.rpc('finish_discard_checklist', { p_id: id })
        if (finish.error) throw new Error(finish.error.message)
        return json({ discarded: true, id })
      }
      if (listed.data.some(file => !file.id || !/^[0-9a-f-]{36}\.(png|jpg|webp)$/.test(file.name))) throw new Error('Unexpected evidence path; Admin review required')
      const page = listed.data.map(file => file.name).join(',')
      if (page === previousPage) throw new Error('Evidence cleanup made no progress; refresh before resuming')
      previousPage = page
      const removed = await files.remove(listed.data.map(file => `${id}/${file.name}`))
      if (removed.error) throw new Error(removed.error.message)
    }
    throw new Error('Cleanup not yet complete; resume discard to finish')
  } catch (error) {
    return json({ error: error.message, discard_pending: frozen }, 409)
  }
}
