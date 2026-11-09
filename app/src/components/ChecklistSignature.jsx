import { useRef, useState } from 'react'

export default function ChecklistSignature({ disabled, onSave, onDirty, label = 'Manager handwritten signature' }) {
  const canvas = useRef(null), stroke = useRef(null), distance = useRef(0)
  const [drawn, setDrawn] = useState(false)
  function point(event) {
    const rect = canvas.current.getBoundingClientRect()
    return [(event.clientX - rect.left) * 900 / rect.width, (event.clientY - rect.top) * 260 / rect.height]
  }
  function start(event) {
    if (disabled) return
    canvas.current.setPointerCapture(event.pointerId)
    stroke.current = point(event); onDirty(true)
  }
  function move(event) {
    if (disabled || !stroke.current) return
    const next = point(event), context = canvas.current.getContext('2d')
    context.beginPath(); context.moveTo(...stroke.current); context.lineTo(...next)
    context.strokeStyle = '#111827'; context.lineWidth = 3; context.lineCap = 'round'; context.stroke()
    distance.current += Math.hypot(next[0] - stroke.current[0], next[1] - stroke.current[1])
    stroke.current = next; setDrawn(distance.current > 10)
  }
  function clear() {
    canvas.current.getContext('2d').clearRect(0, 0, 900, 260)
    distance.current = 0; stroke.current = null; setDrawn(false); onDirty(false)
  }
  return <div className="space-y-2">
    <p>Draw your signature with your finger or stylus, then save it.</p>
    <canvas ref={canvas} width="900" height="260" aria-label={label} className="w-full max-w-2xl bg-white border-2 border-slate-500 rounded touch-none"
      onPointerDown={start} onPointerMove={move} onPointerUp={() => { stroke.current = null }} onPointerCancel={() => { stroke.current = null }} />
    <button type="button" className="min-h-12 px-4 border rounded mr-3" disabled={disabled} onClick={clear}>Clear drawing</button>
    <button type="button" className="min-h-12 px-4 border rounded" disabled={disabled || !drawn} onClick={() => canvas.current.toBlob(async blob => {
      if (blob && await onSave(blob)) clear()
    }, 'image/png')}>Save signature</button>
  </div>
}
