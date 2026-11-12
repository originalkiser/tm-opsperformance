// No supplied actor, site, file path or grant ID is trusted. Only the server can call the RPC.
const bucket = 'manager-checklist-evidence'
const jsonActions = new Set(['context', 'read', 'start', 'begin_edit', 'save', 'download', 'history', 'qr_status', 'qr_rotate', 'qr_revoke'])
const adminActions = new Set(['qr_status', 'qr_rotate', 'qr_revoke'])
const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store', 'Pragma': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' }
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } })
class RequestError extends Error { constructor(message, status = 400) { super(message); this.status = status } }
async function boundedBytes(req, limit) {
  const declared = Number(req.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > limit) throw new RequestError('Request is too large', 413)
  const reader = req.body?.getReader()
  if (!reader) throw new RequestError('Request body required')
  const parts = []; let size = 0
  try {
    for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > limit) { await reader.cancel(); throw new RequestError('Request is too large', 413) } parts.push(value) }
  } finally { reader.releaseLock() }
  const result = new Uint8Array(size); let offset = 0
  for (const part of parts) { result.set(part, offset); offset += part.length }
  return result
}
async function digest(value, cryptoImpl) {
  const bytes = await cryptoImpl.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('')
}
function newToken(cryptoImpl) {
  return Array.from(cryptoImpl.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('')
}
function validMagic(bytes, type) {
  if (type === 'image/jpeg') return bytes.length > 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
  if (type === 'image/png') return [137,80,78,71,13,10,26,10].every((b,i) => bytes[i] === b)
  return bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0,4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8,12)) === 'WEBP'
}
export async function checklistAccess(req, userClient, serverClient, cryptoImpl = globalThis.crypto) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers })
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405)
  try {
    const multipart = (req.headers.get('content-type') || '').startsWith('multipart/form-data')
    const bytes = await boundedBytes(req, multipart ? 11 * 1024 * 1024 : 240000)
    let body, file
    if (multipart) {
      const form = await new Response(bytes, { headers: { 'Content-Type': req.headers.get('content-type') } }).formData()
      body = Object.fromEntries([...form.entries()].filter(([key]) => key !== 'file'))
      file = form.get('file')
      if (body.action !== 'upload') throw new RequestError('Invalid upload action')
    } else {
      try { body = JSON.parse(new TextDecoder().decode(bytes)) } catch { throw new RequestError('Invalid JSON request') }
      if (!body || Array.isArray(body) || !jsonActions.has(body.action)) throw new RequestError('Unsupported checklist action')
    }
    let actor = null, tokenHash = null
    if (Object.hasOwn(body, 'token')) {
      if (adminActions.has(body.action)) throw new RequestError('Account sign-in required', 401)
      if (typeof body.token !== 'string' || !/^[a-f0-9]{64}$/.test(body.token)) throw new RequestError('QR access expired or revoked', 401)
      tokenHash = await digest(body.token, cryptoImpl)
    } else {
      const auth = await userClient.auth.getUser()
      if (auth.error || !auth.data?.user?.id) throw new RequestError('Sign in again to continue', 401)
      actor = auth.data.user.id
    }
    // Whitelist actual action fields; never pass a token or caller-controlled actor/hash/path through.
    const payload = {}
    for (const key of ['id','template_key','location_id','period_date','revision','answers','manager_name','submit','working_copy_id','item_id','kind','attachment_id','offset','expected_generation']) {
      if (body[key] !== undefined && (body[key] !== '' || key === 'manager_name')) payload[key] = body[key]
    }
    const call = async (action, value = payload) => {
      const { data, error } = await serverClient.rpc('checklist_access_server', { p_actor: actor, p_token_hash: tokenHash, p_action: action, p_body: value })
      if (error) {
        // Do not reflect raw DB errors or request contents containing capability material.
        const status = error.code === '42501' ? 403 : error.code === '54000' ? 429 : error.code === '23505' || error.code === '40001' ? 409 : 400
        const message = error.code === '23505' ? 'This checklist already exists. Refresh to resume it.' :
          error.code === '40001' ? 'Checklist changed elsewhere. Reload before saving.' :
          error.code === '42501' ? 'This checklist is not available for this action. Its access or correction window may have ended.' :
          error.code === '54000' ? 'Request limit reached. Wait before trying again.' :
          /^P000[12]$/.test(error.code || '') ? String(error.message || 'Checklist request rejected').slice(0,400) : 'Checklist request rejected. Refresh before trying again.'
        throw new RequestError(message, status)
      }
      if (!data || typeof data !== 'object') throw new RequestError('Checklist response unavailable', 502)
      return data
    }
    if (body.action === 'qr_rotate') {
      const token = newToken(cryptoImpl)
      const result = await call('qr_rotate', { ...payload, token_hash: await digest(token, cryptoImpl) })
      return json({ ...result, token })
    }
    if (body.action === 'download') {
      const access = await call('download')
      const { data, error } = await serverClient.storage.from(bucket).download(access.object_path, { cacheNonce: cryptoImpl.randomUUID() }, { cache: 'no-store', signal: req.signal })
      if (error || !data) throw new RequestError('Evidence download was not completed', 502)
      // Authorization can change during the network transfer. Do not return the bytes until rechecked.
      const after = await call('download')
      if (after.object_path !== access.object_path || req.signal.aborted) throw new RequestError('Evidence access changed', 403)
      if (!extensions[data.type] || !data.size || data.size > 10 * 1024 * 1024) throw new RequestError('Unsupported evidence file', 415)
      return new Response(data, { headers: { ...headers, 'Content-Type': data.type, 'Content-Disposition': 'inline' } })
    }
    if (body.action === 'upload') {
      if (!file || typeof file.arrayBuffer !== 'function' || !extensions[file.type] || !file.size || file.size > 10 * 1024 * 1024) throw new RequestError('Use a JPEG, PNG or WebP image between 1 byte and 10 MB', 415)
      const image = new Uint8Array(await file.arrayBuffer())
      if (!validMagic(image, file.type)) throw new RequestError('Image contents do not match its file type', 415)
      const intent = await call('upload_begin', { ...payload, extension: extensions[file.type] })
      const { error } = await serverClient.storage.from(bucket).upload(intent.object_path, image, { contentType: file.type, cacheControl: '0', upsert: false })
      if (error) throw new RequestError('Upload was not confirmed. Refresh before trying again.', 409)
      return json(await call('upload_finish', { id: payload.id, working_copy_id: payload.working_copy_id ?? null, upload_id: intent.upload_id }))
    }
    return json(await call(body.action))
  } catch (error) {
    // No logging of request bodies, tokens, paths or image contents.
    return json({ error: error instanceof RequestError ? error.message : 'Checklist request failed. Refresh to check its state before retrying.' }, error instanceof RequestError ? error.status : 500)
  }
}
