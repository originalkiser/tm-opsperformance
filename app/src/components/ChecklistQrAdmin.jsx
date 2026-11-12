import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { supabase, supabasePublicKey } from '../lib/supabase'
import { createChecklistTransport, checklistGuestUrl } from '../utils/checklistAccess'

export default function ChecklistQrAdmin({ location }) {
  const [grant, setGrant] = useState(null), [secret, setSecret] = useState(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const transport = useRef(null), generation = useRef(0), working = useRef(false)
  if (!transport.current) transport.current = createChecklistTransport(supabase, supabasePublicKey)
  useEffect(() => {
    const current = ++generation.current
    setSecret(null); setGrant(null); setError(''); setNotice('')
    if (!location?.id) return
    setBusy(true)
    transport.current.request('qr_status', { location_id: location.id }).then(result => { if (current === generation.current) setGrant(result.grant) }).catch(error => { if (current === generation.current) setError(error.message) }).finally(() => { if (current === generation.current) setBusy(false) })
    return () => { generation.current++ }
  }, [location?.id])
  async function change(action) {
    if (working.current || busy || !location?.id) return
    const confirm = action === 'qr_revoke' ? 'Disable this store’s QR access now? Existing scans will stop working. Saved checklists and evidence stay intact.' : 'Create a new QR for this store? Anyone with it can read, continue and make corrections within the assigned day or week to this store’s checklists, including work started by signed-in managers. Any previous QR will stop working.'
    if (!window.confirm(confirm)) return
    working.current = true; setBusy(true); setError(''); setNotice(''); setSecret(null)
    const current = generation.current
    try {
      const result = await transport.current.request(action, { location_id: location.id, expected_generation: grant?.generation || 0 })
      if (current !== generation.current) return
      setGrant(result.grant)
      if (action === 'qr_rotate') {
        if (!result.token) throw new Error('The new QR was not returned. Check status before creating another.')
        const url = checklistGuestUrl(window.location, result.token)
        const image = await QRCode.toDataURL(url, { errorCorrectionLevel: 'M', width: 640, margin: 4, color: { dark: '#10233fff', light: '#ffffffff' } })
        if (current !== generation.current) return
        setSecret({ url, image, site: location.site_code })
        setNotice('New QR created. Download or print it now. The secret link cannot be retrieved later; replacing it disables this code.')
      } else setNotice('QR access disabled. Saved checklists and evidence were preserved.')
    } catch (error) { if (current === generation.current) setError(`${error.message} Nothing was retried automatically. Refresh status before trying again.`) }
    finally { working.current = false; if (current === generation.current) setBusy(false) }
  }
  async function refresh() {
    if (busy || working.current) return
    working.current = true; setBusy(true); setError('')
    const current = generation.current
    try { const result = await transport.current.request('qr_status', { location_id: location.id }); if (current === generation.current) { setGrant(result.grant); setSecret(null) } }
    catch (error) { if (current === generation.current) setError(error.message) }
    finally { working.current = false; if (current === generation.current) setBusy(false) }
  }
  function print() {
    if (!secret) return
    const popup = window.open('about:blank', '_blank')
    if (!popup) { setError('Allow the print window, or download the QR image instead.'); return }
    popup.opener = null
    popup.document.title = `${secret.site} checklist QR`
    const heading = popup.document.createElement('h1'); heading.textContent = `${secret.site} — Store Checklists`
    const description = popup.document.createElement('p'); description.textContent = 'Scan to open all five checklists. No login needed. Keep this code inside the store; anyone with a copy has access.'
    const img = popup.document.createElement('img'); img.alt = `${secret.site} private store checklist QR`; img.width = 480
    img.onload = () => { popup.focus(); popup.print() }
    popup.document.body.append(heading, description, img)
    img.src = secret.image
  }
  return <section className="space-y-3 border rounded p-4" aria-label="Store checklist QR management">
    <h2 className="font-bold text-xl">Store QR · {location?.site_code || 'Select a store'}</h2>
    <p>Anyone who scans this code can access this store’s checklists and private checklist evidence, including work begun by a signed-in manager. It does not grant access to other stores or TM Ops reports.</p>
    <p>Status: {grant?.is_active ? 'Active' : 'Not active'}</p>
    {error && <p role="alert" className="text-red-600 dark:text-red-300">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <div className="flex flex-wrap gap-3">
      <button disabled={busy || !location?.id} className="min-h-12 px-4 border rounded" onClick={() => change('qr_rotate')}>{grant?.is_active ? 'Replace QR code' : 'Create QR code'}</button>
      <button disabled={busy || !grant?.is_active} className="min-h-12 px-4 border border-red-500 rounded" onClick={() => change('qr_revoke')}>Disable QR access</button>
      <button disabled={busy || !location?.id} className="min-h-12 px-4 border rounded" onClick={refresh}>Refresh QR status</button>
    </div>
    {secret && <div className="border rounded p-3 space-y-3">
      <img src={secret.image} alt={`${secret.site} private store checklist QR`} className="max-w-full w-80 bg-white" />
      <label className="block">Private store link<input aria-label="Private store checklist link" readOnly value={secret.url} className="block w-full border rounded p-3 bg-transparent" /></label>
      <div className="flex flex-wrap gap-3">
        <button className="min-h-12 px-4 border rounded" onClick={async () => { try { await navigator.clipboard.writeText(secret.url); setNotice('Private link copied. Share only with staff for this store.') } catch { setError('Copy failed. Select and copy the private link above.') } }}>Copy private link</button>
        <a className="min-h-12 px-4 py-3 border rounded" download={`${secret.site.replace(/[^a-zA-Z0-9_-]/g, '_')}-checklists-qr.png`} href={secret.image}>Download QR</a>
        <button className="min-h-12 px-4 border rounded" onClick={print}>Print QR</button>
        <button className="min-h-12 px-4 border rounded" onClick={() => setSecret(null)}>Hide private link</button>
      </div>
    </div>}
  </section>
}
