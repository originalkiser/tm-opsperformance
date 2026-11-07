import { categoryFolder, resourceLabels } from './resourceCatalog.js'
export const RESOURCE_BUCKET = 'resource-pdfs'
export const PDF_LIMIT = 50 * 1024 * 1024
export const RESOURCE_CATEGORIES = ['General Manager Workbook', 'Equipment Manuals', 'Standard Operating Procedures (SOPs)', 'Employee Handbook', 'Other Reference Materials']
export const resourceAccess = profile => profile?.is_active === true && !profile.deleted_at && ['admin', 'store'].includes(profile.role)

export function validateResourceMetadata({ title, category, brand = '' }, catalog) {
  if (!title?.trim() || title.trim().length > 200) throw new Error('Enter a title of 1–200 characters.')
  const folder = categoryFolder(catalog, category)
  if (!folder) throw new Error('Select a document category.')
  if (folder.uses_manufacturers && !catalog.some(c => c.category_key === category && c.brand_key === brand && brand)) throw new Error('Select a manufacturer.')
  if (!folder.uses_manufacturers && brand) throw new Error('This category does not use manufacturers.')
}

export async function validatePdf(file) {
  if (!file || !/\.pdf$/i.test(file.name) || (file.type && file.type !== 'application/pdf')) throw new Error('Select a PDF file.')
  if (!file.size || file.size > PDF_LIMIT) throw new Error('PDF files must be nonempty and no larger than 50 MB.')
  if (file.name.length > 255) throw new Error('PDF filename must be 255 characters or fewer.')
  const header = new TextDecoder().decode(await file.slice(0, 1024).arrayBuffer())
  if (!header.includes('%PDF-')) throw new Error('This file does not contain a PDF header.')
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return { filename: file.name, size: file.size, sha256: Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('') }
}

export function filterResources(rows, { query = '', category = '', brand = '' } = {}, catalog = []) {
  const search = query.trim().toLocaleLowerCase()
  return rows.filter(row => {
    const labels = resourceLabels(row, catalog)
    return (!category || row.category === category) && (!brand || row.brand === brand) &&
      `${row.title} ${labels.category} ${labels.brand}`.toLocaleLowerCase().includes(search)
  }).sort((a, b) => (categoryFolder(catalog, a.category)?.sort_order ?? RESOURCE_CATEGORIES.indexOf(a.category)) - (categoryFolder(catalog, b.category)?.sort_order ?? RESOURCE_CATEGORIES.indexOf(b.category)) || resourceLabels(a, catalog).brand.localeCompare(resourceLabels(b, catalog).brand) || a.title.localeCompare(b.title))
}

export async function resourceAction(client, action, row, data = {}) {
  const result = await client.rpc('manage_resource', { p_action: action, p_id: row?.id || null, p_revision: row?.revision ?? null, p_data: data })
  if (result.error) throw new Error(result.error.message)
  return result.data
}

export async function cleanupResource(client, row) {
  const result = await client.functions.invoke('manage-resource-files', { body: { id: row.id, revision: row.revision } })
  if (result.error || result.data?.error) throw new Error(result.data?.error || result.error?.message || 'Cleanup failed. Refresh and retry cleanup.')
  return result.data
}

// No signed/public links. Recheck current RLS-protected index and session after transfer.
export async function downloadResource(client, row, userId, signal) {
  const session = await client.auth.getSession()
  if (session.error || session.data?.session?.user?.id !== userId) throw new Error('Sign in again before opening resources.')
  const result = await client.storage.from(RESOURCE_BUCKET).download(row.object_path, { cacheNonce: crypto.randomUUID() }, { cache: 'no-store', signal })
  if (result.error) throw new Error(result.error.message)
  const access = await client.from('resource_documents').select('object_path,removed').eq('id', row.id)
    .setHeader('Cache-Control', 'no-cache, no-store').abortSignal(signal).single()
  const current = await client.auth.getSession()
  if (signal?.aborted || access.error || access.data?.removed || access.data?.object_path !== row.object_path ||
    current.error || current.data?.session?.user?.id !== userId) throw new Error('Document access changed. Refresh Resources.')
  if (!new TextDecoder().decode(await result.data.slice(0, 1024).arrayBuffer()).includes('%PDF-')) throw new Error('The stored document is not a readable PDF.')
  return result.data
}

// The upload remains reserved in the index on failure, allowing explicit resume or cancel.
export async function uploadResource(client, file, row, publicKey, onProgress, signal, UploadClass) {
  const info = await validatePdf(file), pending = row.pending_upload
  if (!pending || pending.sha256 !== info.sha256 || pending.size !== info.size) throw new Error('Reselect the exact PDF used for this pending upload, or cancel it.')
  const session = await client.auth.getSession(), userId = session.data?.session?.user?.id
  if (session.error || !userId) throw new Error('Sign in again before uploading.')
  const Upload = UploadClass || (await import('tus-js-client')).Upload
  const host = new URL(client.supabaseUrl)
  if (host.hostname.endsWith('.supabase.co')) host.hostname = host.hostname.replace('.supabase.co', '.storage.supabase.co')
  host.pathname = '/storage/v1/upload/resumable'
  return new Promise((resolve, reject) => {
    let upload, settled = false
    const finish = error => { if (settled) return; settled = true; signal?.removeEventListener('abort', pause); error ? reject(error) : resolve() }
    const pause = () => { upload?.abort(false)?.catch(() => {}); finish(new Error('Upload paused. Reselect the same PDF to resume, or cancel the pending upload.')) }
    upload = new Upload(file, {
      endpoint: host.href, chunkSize: 6 * 1024 * 1024, retryDelays: [0, 1000, 3000, 5000],
      uploadDataDuringCreation: true, removeFingerprintOnSuccess: true,
      metadata: { bucketName: RESOURCE_BUCKET, objectName: pending.path, contentType: 'application/pdf', cacheControl: '0' },
      fingerprint: async () => `tm-resource:${userId}:${pending.path}:${info.sha256}`,
      onBeforeRequest: async request => {
        const current = await client.auth.getSession()
        if (current.error || current.data?.session?.user?.id !== userId) throw new Error('Upload session changed. Sign in again.')
        request.setHeader('Authorization', `Bearer ${current.data.session.access_token}`)
        request.setHeader('apikey', publicKey)
      },
      onShouldRetry: (error, attempt, options) => ![401, 403, 409].includes(error.originalResponse?.getStatus()) && attempt < options.retryDelays.length,
      onProgress, onError: error => finish(error), onSuccess: () => finish(),
    })
    signal?.addEventListener('abort', pause, { once: true })
    if (signal?.aborted) return pause()
    upload.findPreviousUploads().then(previous => {
      if (settled) return
      if (previous.length) upload.resumeFromPreviousUpload(previous[0])
      upload.start()
    }).catch(finish)
  })
}
