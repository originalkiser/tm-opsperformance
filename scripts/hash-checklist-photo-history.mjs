// Operator-run only after separate authorization. No scheduled job or browser endpoint.
import { digest } from '../app/supabase/functions/checklist-access/handler.js'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
export async function hashHistoryBatch(client, { after = null, retryInaccessible = false, cryptoImpl = globalThis.crypto } = {}) {
  const call = async (action, body = {}) => {
    const { data, error } = await client.rpc('checklist_photo_history', { p_action: action, p_body: body })
    if (error) throw new Error('Photo history maintenance request failed; no checkpoint advanced.')
    return data
  }
  const { objects } = await call('batch', { after, retry_inaccessible: retryInaccessible })
  let cursor = after
  for (const object of objects) {
    let sha256, errorCode
    try {
      const { data, error } = await client.storage.from('manager-checklist-evidence').download(object.object_path)
      if (error || !data) errorCode = 'download_failed'
      else if (!data.size || data.size > 10 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(data.type)) errorCode = 'invalid_image'
      else sha256 = await digest(new Uint8Array(await data.arrayBuffer()), cryptoImpl)
    } catch { errorCode = 'download_failed' }
    await call('record', { attachment_id: object.attachment_id, ...(sha256 ? { sha256 } : { error_code: errorCode }) })
    cursor = object.attachment_id
  }
  return { processed: objects.length, after: cursor, report: await call('report') }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2), url = process.env.CHECKLIST_HASH_URL
  const expected = args.find(value => value.startsWith('--expected-origin='))?.slice('--expected-origin='.length)
  if (!args.includes('--execute') || !url || new URL(url).origin !== expected || !process.env.CHECKLIST_HASH_SERVICE_KEY) {
    throw new Error('Requires separate authorization, --execute, --expected-origin=<exact origin>, CHECKLIST_HASH_URL and CHECKLIST_HASH_SERVICE_KEY. Credentials are never printed.')
  }
  const require = createRequire(new URL('../app/package.json', import.meta.url))
  const { createClient } = require('@supabase/supabase-js')
  const client = createClient(url, process.env.CHECKLIST_HASH_SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const after = args.find(value => value.startsWith('--after='))?.slice('--after='.length) || null
  console.log(JSON.stringify(await hashHistoryBatch(client, { after, retryInaccessible: args.includes('--retry-inaccessible') }), null, 2))
}
