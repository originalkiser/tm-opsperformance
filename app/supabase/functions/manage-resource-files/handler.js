const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

// Privileged Storage client is server-only. Caller supplies no bucket or file path.
export async function cleanupResourceFiles(req, userClient, storageClient) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405)
  const auth = await userClient.auth.getUser()
  if (auth.error || !auth.data?.user) return json({ error: 'Sign in again.' }, 401)
  try {
    const { id, revision } = await req.json()
    if (!uuid.test(id) || !Number.isSafeInteger(revision) || revision < 1) return json({ error: 'Resource ID and revision required' }, 400)
    const args = { p_id: id, p_revision: revision }
    // Caller JWT RPC checks current active Admin and freezes the exact cleanup reference.
    const plan = await userClient.rpc('manage_resource', { ...args, p_action: 'cleanup' })
    if (plan.error) throw new Error(plan.error.message)
    const path = plan.data?.path, parts = path?.split('/')
    if (plan.data?.id !== id || plan.data?.revision !== revision || parts?.length !== 2 || parts[0] !== id || !uuid.test(parts[1].replace(/\.pdf$/, '')) || !parts[1].endsWith('.pdf')) throw new Error('Invalid cleanup reference; no files removed')
    const removed = await storageClient.storage.from('resource-pdfs').remove([path])
    if (removed.error) throw new Error(removed.error.message)
    const finished = await userClient.rpc('manage_resource', { ...args, p_action: 'finish_cleanup' })
    if (finished.error) throw new Error(finished.error.message)
    return json({ cleaned: true, document: finished.data })
  } catch (error) {
    return json({ error: `${error.message}. Cleanup remains pending; refresh before retrying.` }, 409)
  }
}
