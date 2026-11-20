// Fictional, isolated print test. No production client or session.
import React from 'react'
import { createRoot } from 'react-dom/client'
import ChecklistPrintButton from '../../src/components/ChecklistPrintButton'
import '../../src/index.css'
const transport = {
 guest: window.fixture.guest,
 async load() {
  window.calls.push('read')
  if (window.calls.filter(c => c === 'read').length > 1) {
   while (!window.allowPrint) await new Promise(resolve => setTimeout(resolve, 20))
   if (window.fixture.mode === 'revoked') throw Error('Denied')
   if (window.fixture.mode === 'changed') return { ...window.fixture.record, row: { ...window.fixture.record.row, revision: 99 } }
  }
  return structuredClone(window.fixture.record)
 },
 async history() { window.calls.push('history'); return { versions: [structuredClone(window.fixture.version)] } },
 async download(row, file) {
  window.calls.push('download')
  if (window.fixture.mode === 'denied') throw Error('Denied')
  if (window.fixture.mode === 'broken') return new Blob(['not an image'], { type: 'image/png' })
  const canvas = document.createElement('canvas'), signature = file.kind === 'signature'
  canvas.width = 1000; canvas.height = signature ? 200 : 700
  const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#1B3A5C'; ctx.font = signature ? 'italic 64px cursive' : '40px sans-serif'
  ctx.fillText(signature ? 'Fictional signature' : 'Fictional inspection photograph', 25, 100)
  if (!signature) { ctx.fillStyle = '#8ECFCB'; ctx.fillRect(50, 150, 900, 500) }
  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
 },
}
createRoot(document.getElementById('root')).render(<main><nav>Application navigation must not print</nav><textarea defaultValue="UNSAVED FORM TEXT" aria-label="Fictional unsaved correction" /><ChecklistPrintButton row={window.fixture.record.row} transport={transport} locationLabel="1001" locationName="Fictional Site" /></main>)
