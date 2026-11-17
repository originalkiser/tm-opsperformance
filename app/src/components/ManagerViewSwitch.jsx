import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
export default function ManagerViewSwitch() {
  const { managerViewAllowed, managerPreview, previewSiteId, actualLocations, setManagerPreview, setPreviewSite } = useAuth()
  const [error,setError] = useState('')
  if (!managerViewAllowed) return null
  const change = action => { try { action(); setError('') } catch(e) { setError(e.message) } }
  return <div className="flex flex-wrap items-center gap-2" aria-label="Admin display view">
    <button type="button" aria-pressed={!managerPreview} onClick={()=>change(()=>setManagerPreview(false))} className="min-h-11 border rounded px-3">Admin View</button>
    <button type="button" aria-pressed={managerPreview} onClick={()=>change(()=>setManagerPreview(true))} className="min-h-11 border rounded px-3">Manager View</button>
    {managerPreview && <><strong className="text-xs">Store-level preview · Read-only</strong><label className="text-xs">Preview location <select className="text-slate-900 min-h-11 rounded" value={previewSiteId} onChange={e=>change(()=>setPreviewSite(e.target.value))}>{actualLocations.map(l=><option key={l.id} value={l.id}>{l.site_code || l.name}</option>)}</select></label></>}
    {error && <span role="alert">{error}</span>}
  </div>
}
