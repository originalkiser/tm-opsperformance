import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function ChecklistAdmin({ templates, reload }) {
  const [template, setTemplate] = useState(null)
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('')
  async function configure(action, value) {
    if (busy) return
    setBusy(true); setMessage('')
    try {
      const { error } = await supabase.rpc('configure_checklist_pilot', { p_action: action, p_value: value })
      if (error) throw error
      setMessage('Saved. Existing checklist snapshots are unchanged.'); setTemplate(null); await reload()
    } catch (error) { setMessage(error.message) } finally { setBusy(false) }
  }
  function editItem(index, field, value) { setTemplate(previous => ({ ...previous, definition: previous.definition.map((item, i) => i === index ? { ...item, [field]: value } : item) })) }
  return <section className="space-y-5 border rounded p-4">
    <h2 className="font-bold text-xl">Admin: checklist templates</h2>
    {message && <p role="status">{message}</p>}
    <h3 className="font-bold text-lg">Templates</h3>
    <p>Question wording and evidence rules are editable. Approved sections, choices, N/A permissions and critical designations are preserved. Changes apply only to new drafts.</p>
    <div className="flex flex-wrap gap-3">{templates.map(item => <button disabled={busy} key={item.key} className="min-h-12 px-4 border rounded" onClick={() => {
      if (!template || window.confirm('Discard unsaved template edits?')) setTemplate(structuredClone(item))
    }}>{item.name}</button>)}</div>
    {template && <div className="space-y-3">
      <h4 className="font-bold">{template.name} · version {template.version}</h4>
      {template.definition.map((item, index) => <fieldset disabled={busy} key={item.id} className="p-3 border rounded space-y-2">
        <legend>{item.section} · {item.id}{item.critical ? ' · Critical' : ''}</legend>
        <label className="block">Question<textarea aria-label={`Question ${item.id}`} className="w-full block border rounded p-3 bg-transparent" maxLength={2000} value={item.text} onChange={e => editItem(index, 'text', e.target.value)} /></label>
        <p>Responses: {item.options.join(' / ')}{item.na_allowed ? ' / N/A (reason required)' : ''}. {['monthly_site_assessment', 'quarterly_safety_audit'].includes(template.key) ? 'Required follow-ups and evidence follow the approved audit rules.' : 'Failed/incomplete answers always require explanations.'}</p>
        <label className="block">Evidence instruction<input className="block border rounded p-3 w-full bg-transparent" maxLength={2000} value={item.instruction || ''} onChange={e => editItem(index, 'instruction', e.target.value)} /></label>
        <label className="block min-h-12"><input type="checkbox" checked={item.photo_required} onChange={e => editItem(index, 'photo_required', e.target.checked)} /> Photo always required (including N/A)</label>
        <label className="block min-h-12"><input type="checkbox" checked={!!item.photo_on_failure} onChange={e => editItem(index, 'photo_on_failure', e.target.checked)} /> Photo required for a failed/incomplete response</label>
        <label className="block min-h-12"><input type="checkbox" checked={!!item.explanation_required} onChange={e => editItem(index, 'explanation_required', e.target.checked)} /> Written explanation always required</label>
      </fieldset>)}
      <button disabled={busy} className="min-h-12 px-5 bg-tm-teal text-tm-navy rounded" onClick={() => {
        if (window.confirm('Save this template version? Existing drafts and submissions retain their original questions and evidence rules.')) configure('template', template)
      }}>Save template</button>
      <button disabled={busy} className="min-h-12 px-5 border rounded ml-3" onClick={() => setTemplate(null)}>Cancel template edits</button>
    </div>}
  </section>
}
