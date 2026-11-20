import { useEffect, useRef, useState } from 'react'

// Dedicated live camera option; the form also offers library selection through the same verified upload path.
export default function ChecklistCamera({ itemId, disabled, onCapture }) {
  const [open, setOpen] = useState(false), [starting, setStarting] = useState(false), [error, setError] = useState('')
  const video = useRef(null), stream = useRef(null), generation = useRef(0), active = useRef(false)
  function stop() {
    generation.current++
    stream.current?.getTracks().forEach(track => track.stop())
    stream.current = null
    if (video.current) video.current.srcObject = null
  }
  useEffect(() => {
    active.current = true
    return () => { active.current = false; stop() }
  }, [])
  useEffect(() => { if (disabled) { stop(); setOpen(false); setStarting(false) } }, [disabled])
  useEffect(() => {
    if (open && video.current && stream.current) video.current.srcObject = stream.current
  }, [open])
  async function start() {
    if (disabled || starting || open) return
    setError('')
    if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError('Camera capture is unavailable here. Open TM Ops in an updated iPhone or Android browser with camera access. Choose from the photo library below, or save an incomplete draft.')
      return
    }
    setStarting(true)
    const attempt = ++generation.current
    try {
      const result = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      if (!active.current || attempt !== generation.current) { result.getTracks().forEach(track => track.stop()); return }
      stream.current = result; setOpen(true)
    } catch {
      if (active.current && attempt === generation.current) setError('Camera could not open. Allow camera access in your browser settings and try again. Choose from the photo library below, or save an incomplete draft.')
    } finally { if (active.current && attempt === generation.current) setStarting(false) }
  }
  function cancel() { stop(); setOpen(false); setStarting(false); setError('') }
  async function capture() {
    if (disabled || !stream.current || !video.current?.videoWidth || !video.current?.videoHeight) { setError('Wait for the camera preview before taking a photo.'); return }
    try {
      const canvas = document.createElement('canvas')
      canvas.width = video.current.videoWidth; canvas.height = video.current.videoHeight
      canvas.getContext('2d').drawImage(video.current, 0, 0)
      const attempt = generation.current
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92))
      if (!active.current || attempt !== generation.current) return
      if (!blob) throw new Error('Camera image unavailable')
      cancel()
      await onCapture(blob)
    } catch { if (active.current) setError('Photo could not be captured. Open the camera and try again.') }
  }
  return <div className="space-y-2" aria-label={`Camera photo ${itemId}`}>
    <p className="text-xs sm:text-sm">Take a new photo of this inspection. Camera access is required.</p>
    {!open && <button type="button" className="min-h-11 px-3 border rounded font-semibold disabled:opacity-50" disabled={disabled || starting} onClick={start}>{starting ? 'Opening camera…' : 'Open camera'}</button>}
    {open && <>
      <video ref={video} autoPlay playsInline muted aria-label="Inspection camera preview" className="w-full max-h-96 rounded bg-black" />
      <div className="flex flex-wrap gap-2"><button type="button" className="min-h-11 px-3 border rounded font-semibold disabled:opacity-50" disabled={disabled} onClick={capture}>Take photo</button>
        <button type="button" className="min-h-11 px-3 border rounded font-semibold disabled:opacity-50" onClick={cancel}>Cancel camera</button></div>
    </>}
    {starting && <button type="button" className="min-h-11 px-3 border rounded font-semibold disabled:opacity-50" onClick={cancel}>Cancel camera</button>}
    {error && <p role="alert">{error}</p>}
  </div>
}
