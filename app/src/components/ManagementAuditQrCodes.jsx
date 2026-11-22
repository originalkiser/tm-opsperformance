import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { managementAudits, managementAuditUrl } from '../utils/managementAudits.js'

export default function ManagementAuditQrCodes() {
  const [codes, setCodes] = useState([])
  const [error, setError] = useState('')
  useEffect(() => {
    let current = true
    Promise.all(managementAudits.map(async audit => {
      const url = managementAuditUrl(window.location.href, audit)
      return { ...audit, url, image: await QRCode.toDataURL(url, { width: 512, errorCorrectionLevel: 'M' }) }
    })).then(result => { if (current) setCodes(result) })
      .catch(() => { if (current) setError('Unable to generate the audit QR codes. Reload and try again.') })
    return () => { current = false }
  }, [])

  function print(code) {
    const popup = window.open('about:blank', '_blank')
    if (!popup) { setError('Allow the print window or download the QR image instead.'); return }
    popup.opener = null
    const doc = popup.document
    doc.title = code.name
    const title = doc.createElement('h1')
    title.textContent = code.name
    const instructions = doc.createElement('p')
    instructions.textContent = 'Scan, sign in to TM Ops, and select an authorized location to open this audit.'
    const image = doc.createElement('img')
    image.alt = `${code.name} QR code`
    image.width = 320
    image.onload = () => { popup.focus(); popup.print() }
    doc.body.append(title, instructions, image)
    image.src = code.image
  }

  return <section className="space-y-3" aria-label="Management Audit QR codes">
    <p>Each shared code opens one audit. Users must sign in and select a location they are authorized to access.</p>
    {error && <p role="alert">{error}</p>}
    {!codes.length && !error && <p role="status">Generating QR codes…</p>}
    <div className="grid gap-3 sm:grid-cols-2">
      {codes.map(code => <article key={code.key} className="tm-shared-panel rounded-xl border p-4">
        <h2 className="font-brand text-lg font-bold">{code.name}</h2>
        <img className="my-3 h-auto w-48 max-w-full" src={code.image} alt={`${code.name} QR code`} />
        <div className="flex flex-wrap gap-2">
          <a className="inline-flex min-h-11 items-center rounded-lg border px-3" href={code.image} download={`${code.path.split('/').at(-1)}-qr.png`}>Download QR</a>
          <button type="button" className="min-h-11 rounded-lg border px-3" onClick={() => print(code)}>Print QR</button>
          <a className="inline-flex min-h-11 items-center px-2 underline" href={code.url}>Open audit</a>
        </div>
      </article>)}
    </div>
  </section>
}
