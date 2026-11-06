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

// Storage maps the guard's P0001 to an opaque 500. Confirm lifecycle state with
// the caller's RLS-protected read; never label an arbitrary server error a discard.
export async function checklistUploadRejection(client, submissionId, error) {
  const known = error?.code === 'P0002' ||
    (Number(error?.status ?? error?.statusCode) === 500 && error?.message === 'database error, code: P0001') ||
    (error?.code === 'P0001' && error?.message === 'Submitted checklists are immutable')
  if (!known) return null
  try {
    const { data, error: readError } = await client.from('checklist_submissions').select('status').eq('id', submissionId)
      .setHeader('Cache-Control', 'no-cache, no-store').maybeSingle()
    if (readError) return null
    // RLS absence can also mean access was revoked, so do not claim confirmed deletion.
    if (!data) return { status: 'unavailable', message: 'This draft is no longer available. Uploads are no longer allowed.' }
    if (data.status === 'discarding') return { status: 'discarding', message: 'This draft is being discarded. Uploads are no longer allowed. Use Discard Draft to finish cleanup.' }
    if (data.status === 'submitted') return { status: 'submitted', message: 'This checklist was submitted. Uploads are no longer allowed.' }
  } catch { /* Keep the original error when the authoritative read is unavailable. */ }
  return null
}
