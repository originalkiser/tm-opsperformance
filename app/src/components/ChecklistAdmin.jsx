import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function ChecklistAdmin({ templates, grants, locations, reload }) {
  const [template, setTemplate] = useState(null), [location, setLocation] = useState(locations[0]?.id || ''), [person, setPerson] = useState('')
  const [people, setPeople] = useState([]), [busy, setBusy] = useState(false), [message, setMessage] = useState('')
  useEffect(() => {
    let alive = true
    supabase.from('user_profiles').select('id,name,role,location_id').eq('is_active', true).is('deleted_at', null).order('name').then(({ data, error }) => {
      if (alive) { if (error) setMessage(error.message); else setPeople(data || []) }
    })
    return () => { alive = false }
  }, [])
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
    <h2 className="font-bold text-xl">Admin: pilot access and templates</h2>
    {message && <p role="status">{message}</p>}
    <p>Enable selected assigned managers or all assigned users at a selected pilot site. Existing site assignments remain authoritative. No reminders or automatic assignments are created.</p>
    <div className="flex flex-wrap gap-3">
      <label>Location<select aria-label="Pilot location" disabled={busy} className="block border rounded p-3 bg-white dark:bg-tm-dark-surface" value={location} onChange={e => setLocation(e.target.value)}>
        {locations.map(site => <option key={site.id} value={site.id}>{site.site_code}</option>)}</select></label>
      <label>Pilot user<select aria-label="Pilot user" disabled={busy} className="block border rounded p-3 bg-white dark:bg-tm-dark-surface" value={person} onChange={e => setPerson(e.target.value)}>
        <option value="">All assigned users at this location</option>{people.map(user => <option key={user.id} value={user.id}>{user.name || user.id} ({user.role})</option>)}</select></label>
      <button disabled={busy || !location} className="min-h-12 border rounded px-4" onClick={() => {
        const existing = grants.find(g => g.location_id === location && (g.user_id || '') === person)
        if (window.confirm('Enable this checklist pilot access? MonitorQA remains official.')) configure('access', { location_id: location, user_id: person || null, is_active: true, updated_at: existing?.updated_at || null })
      }}>Enable pilot access</button>
    </div>
    <ul>{grants.map(grant => <li key={grant.id} className="py-2 border-b flex flex-wrap items-center gap-3">
      <span>{locations.find(site => site.id === grant.location_id)?.site_code} · {grant.user_id ? people.find(user => user.id === grant.user_id)?.name || grant.user_id : 'All assigned users'} · from {grant.enabled_from} · {grant.is_active ? 'Enabled' : 'Disabled'}</span>
      <button disabled={busy} className="min-h-12 px-4 border rounded" onClick={() => {
        if (window.confirm(`${grant.is_active ? 'Disable' : 'Enable'} this pilot grant?`)) configure('access', { ...grant, is_active: !grant.is_active })
      }}>{grant.is_active ? 'Disable' : 'Enable'}</button>
    </li>)}</ul>
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
        <p>Responses: {item.options.join(' / ')}{item.na_allowed ? ' / N/A (reason required)' : ''}. Failed/incomplete answers always require explanations.</p>
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
