import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { budgetLabelEditorAction, budgetLabelSection } from '../utils/budgetLabels'

const control = 'min-h-11 w-full rounded-md border border-slate-300 bg-white p-2 text-sm dark:border-tm-dark-border dark:bg-tm-dark-surface'
export default function BudgetLabelsEditor() {
  const [state, setState] = useState(null), [selected, setSelected] = useState('')
  const [label, setLabel] = useState(''), [helper, setHelper] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const active = useRef(true), flight = useRef(false), generation = useRef(0)
  const item = state?.items.find(item => item.id === selected)
  const groupedItems = new Map()
  for (const entry of state?.items || []) {
    const section = budgetLabelSection(entry.id)
    if (!groupedItems.has(section)) groupedItems.set(section, [])
    groupedItems.get(section).push(entry)
  }
  const dirty = !!item && (label !== item.label || helper !== item.helper)
  useEffect(() => { active.current = true; return () => { active.current = false; generation.current++ } }, [])
  useEffect(() => {
    const warn = event => { if (dirty) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  async function run(action, next = selected) {
    if (flight.current) return
    flight.current = true; setBusy(true); setError(''); setNotice('')
    const request = ++generation.current
    try {
      const target = action === 'read' ? next ? { id: next } : null : item
      const result = await budgetLabelEditorAction(supabase, action, target, action === 'save' ? label : null, action === 'save' ? helper : null)
      if (!active.current || request !== generation.current) return
      const id = next || result.items[0].id
      const fresh = result.items.find(item => item.id === id)
      setState(result); setSelected(id); setLabel(fresh.label); setHelper(fresh.helper)
      if (action !== 'read') {
        setNotice(action === 'restore' ? 'Original wording restored.' : 'Wording saved.')
        window.dispatchEvent(new Event('tm-budget-labels-updated'))
      } else if (!next) {
        // Fetch history for the initially selected field without guessing actor data.
        const history = await budgetLabelEditorAction(supabase, 'read', fresh)
        if (active.current && request === generation.current) setState(history)
      }
    } catch (error) { if (active.current && request === generation.current) setError(error.message) }
    finally { flight.current = false; if (active.current) setBusy(false) }
  }
  const reload = next => {
    if (dirty && !window.confirm('Discard unsaved wording? Saved changes and history are retained.')) return
    run('read', next)
  }
  return <section aria-label="Super Admin Budget Tracker Labels" className="rounded-xl border p-4 dark:border-tm-dark-border">
    <details onToggle={event => { if (event.currentTarget.open && !state && !flight.current) run('read') }}>
      <summary className="cursor-pointer text-xl font-bold">Budget Tracker Labels</summary>
      <p className="my-3 text-sm">Edit approved wording by Budget Tracker section. Calculations, field identities, validation and permissions stay fixed. Saved wording also appears in Admin entry corrections.</p>
      {error && <p role="alert" className="my-2 text-red-700 dark:text-red-300">{error}</p>}
      {notice && <p role="status" className="my-2 text-green-800 dark:text-green-300">{notice}</p>}
      {!state && <button disabled={busy} onClick={() => run('read')} className="min-h-11 rounded border px-4">{busy ? 'Loading…' : 'Load labels'}</button>}
      {state && !groupedItems.has('Daily Cash Reconciliation') && <p className="my-2 text-sm">Daily Cash Reconciliation wording is available after the label catalog update.</p>}
      {state && <fieldset disabled={busy} className="space-y-4 disabled:opacity-60">
        <label className="block text-sm font-semibold">Entry field<select aria-label="Budget Tracker label field" className={control} value={selected} onChange={event => reload(event.target.value)}>{[...groupedItems].map(([section, items]) => <optgroup key={section} label={section}>
          {items.map(item => <option key={item.id} value={item.id}>{item.default_label}</option>)}
        </optgroup>)}</select></label>
        {item && <>
          <div className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-tm-dark-card"><h3 className="font-semibold">Current wording</h3><p className="break-words">{item.label}</p><p className="whitespace-pre-line break-words text-xs">{item.helper || 'No helper text'}</p></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-3">
              <label className="block text-sm font-semibold">Replacement label<input aria-label="Replacement label" className={control} maxLength={100} value={label} onChange={event => setLabel(event.target.value)} /></label>
              <label className="block text-sm font-semibold">{selected === 'cash-reconciliation-heading' ? 'Section instructions' : 'Helper / instructional text'}<textarea aria-label="Helper / instructional text" className={`${control} min-h-24`} maxLength={400} value={helper} onChange={event => setHelper(event.target.value)} /></label>
            </div>
            <div className="min-w-0 rounded-lg border p-3 dark:border-tm-dark-border"><h3 className="mb-3 text-sm font-semibold">Preview</h3><p className="mb-1 break-words text-xs font-semibold">{label || 'Enter a label'}</p><input aria-label="Wording preview only" readOnly tabIndex={-1} value="" placeholder="Entry value" className={control} /><p className="mt-1 whitespace-pre-line break-words text-xs">{helper}</p></div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button disabled={!dirty || !label.trim()} onClick={() => run('save')} className="min-h-11 rounded-md bg-tm-blue px-4 font-semibold text-white">{busy ? 'Saving…' : 'Save wording'}</button>
            <button onClick={() => run('restore')} disabled={item.label === item.default_label && item.helper === item.default_helper} className="min-h-11 rounded-md border px-4">Restore original wording</button>
            <button onClick={() => reload(selected)} className="min-h-11 rounded-md border px-4">Reload saved wording</button>
          </div>
          <details className="text-sm"><summary className="cursor-pointer font-semibold">Original default wording</summary><p className="break-words">{item.default_label}</p><p className="whitespace-pre-line break-words text-xs">{item.default_helper || 'No helper text'}</p></details>
          <details className="text-sm"><summary className="cursor-pointer font-semibold">Change history · latest 50</summary>{!state.history.length ? <p>No wording changes recorded for this field.</p> : <ol className="mt-2 space-y-3">{state.history.map(entry => <li key={entry.revision} className="rounded border p-3 dark:border-tm-dark-border"><p className="font-semibold">{entry.actor_name} · {new Date(entry.changed_at).toLocaleString()} · {entry.action === 'restore' ? 'Restored defaults' : 'Saved'} · revision {entry.revision}</p><p className="whitespace-pre-line break-words">Previous: {entry.previous_label}{entry.previous_helper ? ` · ${entry.previous_helper}` : ''}</p><p className="whitespace-pre-line break-words">New: {entry.new_label}{entry.new_helper ? ` · ${entry.new_helper}` : ''}</p></li>)}</ol>}</details>
        </>}
      </fieldset>}
    </details>
  </section>
}
