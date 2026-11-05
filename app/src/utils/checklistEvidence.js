import { validateEvidence } from './checklistRules.js'

// Every view gets a new authenticated Storage request, not a shareable bearer URL.
// RLS checks current account/pilot/location access. Recheck after transfer as well.
export async function downloadChecklistEvidence(client, file, userId, signal) {
  const session = await client.auth.getSession()
  if (session.error || !userId || session.data?.session?.user?.id !== userId) throw new Error('Sign in again before viewing evidence.')
  const { data, error } = await client.storage.from('manager-checklist-evidence').download(
    file.object_path, { cacheNonce: crypto.randomUUID() }, { cache: 'no-store', signal }
  )
  if (error) throw error
  const access = await client.from('checklist_attachments').select('object_path').eq('id', file.id)
    .setHeader('Cache-Control', 'no-cache, no-store').abortSignal(signal).single()
  const current = await client.auth.getSession()
  if (access.error || access.data?.object_path !== file.object_path || current.error || current.data?.session?.user?.id !== userId) {
    throw new Error('Evidence access is no longer authorized.')
  }
  if (signal?.aborted) throw new Error('Evidence request canceled.')
  validateEvidence(data)
  return data
}
