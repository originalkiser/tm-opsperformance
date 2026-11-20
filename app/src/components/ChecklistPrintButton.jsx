import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import ChecklistPrintDocument from './ChecklistPrintDocument'
import { loadOfficialChecklist, officialChecklistFingerprint, printableChecklistKeys } from '../utils/checklistPrint'

export default function ChecklistPrintButton({ row, transport, locationLabel, locationName, disabled }) {
  const [preparing, setPreparing] = useState(false), [error, setError] = useState('')
  const active = useRef(null), mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; active.current?.cleanup() } }, [])
  if (!transport || row.status !== 'submitted' || row.preview_only || !printableChecklistKeys.includes(row.template_key) || (transport.guest && ['monthly_site_assessment', 'quarterly_safety_audit'].includes(row.template_key))) return null
  async function print() {
    if (active.current?.preparing) return
    active.current?.cleanup()
    const controller = new AbortController(), urls = []
    let frame, root, disposed = false
    const task = { preparing: true, cleanup() { if (disposed) return; disposed = true; controller.abort(); root?.unmount(); frame?.remove(); urls.forEach(url => URL.revokeObjectURL(url)); if (active.current === task) active.current = null } }
    active.current = task
    setPreparing(true); setError('')
    try {
      const record = await loadOfficialChecklist(transport, row.id, controller.signal)
      if (controller.signal.aborted) return
      const images = new Map()
      for (const file of record.evidence) {
        const blob = await transport.download(record.row, file, controller.signal)
        if (controller.signal.aborted) return
        const url = URL.createObjectURL(blob); urls.push(url); images.set(file.id, url)
      }
      if (controller.signal.aborted) return
      frame = document.createElement('iframe')
      frame.title = 'Completed checklist print document'
      frame.setAttribute('aria-hidden', 'true')
      frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:850px;height:1100px;border:0;'
      document.body.appendChild(frame)
      const doc = frame.contentDocument
      doc.title = `${record.row.template_snapshot.name} · ${record.row.period_date}`
      const mount = doc.createElement('div'); doc.body.appendChild(mount)
      root = createRoot(mount)
      flushSync(() => root.render(<ChecklistPrintDocument record={record} images={images} locationLabel={locationLabel} locationName={locationName} />))
      await Promise.all([...doc.images].map(image => image.decode()))
      await doc.fonts.ready
      // Recheck authorization and revision after all private images are ready.
      const latest = await loadOfficialChecklist(transport, row.id, controller.signal)
      if (officialChecklistFingerprint(record) !== officialChecklistFingerprint(latest)) throw new Error('The submitted checklist changed while preparing. Try printing again.')
      if (controller.signal.aborted) return
      frame.contentWindow.addEventListener('afterprint', () => task.cleanup(), { once: true })
      frame.contentWindow.focus()
      frame.contentWindow.print()
    } catch (error) {
      task.cleanup()
      if (mounted.current && error.name !== 'AbortError') setError('Printing could not be prepared. Check your connection and checklist access, then try again. No partial copy was printed.')
    } finally {
      task.preparing = false
      if (mounted.current) setPreparing(false)
    }
  }
  return <div className="space-y-2">
    <button type="button" disabled={disabled || preparing} className="min-h-11 px-4 border rounded font-semibold" onClick={print}>{preparing ? 'Preparing print copy…' : 'Print / Save PDF'}</button>
    {error && <p role="alert" className="text-red-600 dark:text-red-300">{error}</p>}
  </div>
}
