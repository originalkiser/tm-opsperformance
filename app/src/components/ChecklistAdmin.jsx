import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { moveChecklistSection, newChecklistQuestion, photoBudget, questionRemovalReason, questionPresets, templateEditorAction } from '../utils/checklistTemplateEditor'
import ChecklistTemplatePreview from './ChecklistTemplatePreview'

const control = 'border rounded p-2 bg-white dark:bg-tm-dark-surface dark:border-tm-dark-border disabled:opacity-50 min-h-11'
export default function ChecklistAdmin({ templates, reload }) {
  const [key, setKey] = useState(''), [state, setState] = useState(null), [items, setItems] = useState([])
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [note, setNote] = useState('')
  const [preview, setPreview] = useState(null), [oldVersion, setOldVersion] = useState(null), [revisions, setRevisions] = useState(null), [type, setType] = useState('completion')
  const [newSection, setNewSection] = useState('')
  const active = useRef(true), flight = useRef(false), generation = useRef(0)
  useEffect(() => { active.current = true; return () => { active.current = false; generation.current++ } }, [])
  const managementAudit = ['monthly_site_assessment', 'quarterly_safety_audit'].includes(key)
  const saved = state?.draft?.editing ? state.draft.definition : state?.published.definition
  const dirty = !!state && JSON.stringify(items) !== JSON.stringify(saved)
  const sections = [...new Set(items.map(i => i.section))]
  useEffect(() => {
    const warn = event => { if (dirty) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  const accept = value => { setState(value); setItems(structuredClone(value.draft?.editing ? value.draft.definition : value.published.definition)); setPreview(null); setOldVersion(null); setRevisions(null) }
  async function run(action) {
    if (flight.current) return
    flight.current = true; setBusy(true); setError(''); setNotice('')
    const request = ++generation.current
    try { await action(() => active.current && request === generation.current) }
    catch (e) { if (active.current && request === generation.current) { setError(e.message || 'Unable to update template.'); setPreview(null) } }
    finally { flight.current = false; if (active.current) setBusy(false) }
  }
  const change = (index, patch) => { setPreview(null); setItems(old => old.map((i, n) => n === index ? { ...i, ...patch } : i)) }
  const select = next => {
    if (dirty && !window.confirm('Discard unsaved template edits? Saved drafts remain available.')) return
    run(async current => { const value = await templateEditorAction(supabase, 'read', next); if (current()) { setKey(next); accept(value); setNote('') } })
  }
  const move = (index, direction) => {
    setPreview(null); setItems(old => { const next = [...old]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; return next })
  }
  const remove = item => {
    const reason = questionRemovalReason(key, item, items, state?.published.definition)
    if (reason) { setError(reason); return }
    if (!window.confirm(`Remove this question from the unpublished template draft?\n\n${item.text}\n\nSave, preview and publish to apply it only to newly started checklists. Previous versions, submissions, active checklists and evidence will remain unchanged.`)) return
    setPreview(null); setError(''); setNotice('Question removed from unsaved template edits. Save the unpublished draft, then preview before publishing.')
    setItems(old => old.filter(i => i.id !== item.id))
  }
  return <section className="space-y-4 border rounded-xl p-4" aria-label="Super Admin checklist editor">
    <h2 className="font-brand font-bold text-xl">Super Admin: checklist templates</h2>
    <p>Saved drafts are unpublished. Publishing affects only newly started checklists. Existing submissions and in-progress snapshots are preserved.</p>
    <div className="flex flex-wrap gap-2">{templates.map(t => <button disabled={busy} key={t.key} className={control} onClick={() => select(t.key)}>{t.name}</button>)}</div>
    {error && <p role="alert" className="text-red-700 dark:text-red-300">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {state && <>
      <h3 className="font-bold">{state.published.name} · published v{state.published.version} · draft revision {state.draft?.revision ?? 0}</h3>
      <p className="text-sm">Keep sections grouped and conditional follow-ups after their parent. Response types, choices, conditional rules and signatures are protected. Allow N/A applies to choice questions; every N/A response requires a brief reason, including non-Critical questions. Required photo counts and signatures still apply. N/A does not trigger failure-only photos or follow-ups. Keep a required photo count when evidence is needed for every response. New questions use approved types. Removing a question changes only the unpublished draft until you preview and publish. Required-signature questions, conditional follow-ups and their parents, and system-dependent questions cannot be removed.</p>
      <p className="text-sm">Maximum required evidence: {Number.isFinite(photoBudget(items)) ? `${photoBudget(items)}/180` : 'Invalid photo count; enter 0–10'}. The 200-upload limit reserves space for retries and corrections.</p>
      <fieldset disabled={busy} className="space-y-4">
        {items.map((item, index) => { const removalReason = questionRemovalReason(key, item, items, state.published.definition); return <div key={item.id} className="border rounded p-3 space-y-2 dark:border-tm-dark-border">
          {(index === 0 || items[index - 1].section !== item.section) && <div className="space-y-2"><label className="block font-semibold">Section heading<input aria-label={`Section heading ${index + 1}`} className={`${control} block w-full`} maxLength={200} value={item.section} onChange={e => {
            const section = e.target.value; setPreview(null); setItems(old => old.map(i => i.section === item.section ? { ...i, section } : i))
          }} /></label><div className="flex flex-wrap gap-2">{[-1,1].map(direction => <button key={direction} className={control} disabled={sections.indexOf(item.section) + direction < 0 || sections.indexOf(item.section) + direction >= sections.length} onClick={() => { setPreview(null); setItems(old => moveChecklistSection(old,item.section,direction)) }}>Move section {direction < 0 ? 'up' : 'down'}</button>)}</div></div>}
          <label className="block">Question {index + 1}<textarea aria-label={`Question ${index + 1}`} maxLength={2000} className={`${control} block w-full`} value={item.text} onChange={e => change(index, { text: e.target.value })} /></label>
          <label className="block">Instructions<textarea aria-label={`Instructions ${index + 1}`} maxLength={2000} className={`${control} block w-full`} value={item.instruction || ''} onChange={e => change(index, { instruction: e.target.value })} /></label>
          <div className="flex flex-wrap items-center gap-3">
            <label><input aria-label={`Critical ${index + 1}`} type="checkbox" checked={item.critical} onChange={e => change(index, { critical: e.target.checked })} /> Critical</label>
            {item.type !== 'text' && <label><input aria-label={`Allow N/A ${index + 1}`} type="checkbox" checked={item.na_allowed === true} onChange={e => change(index, { na_allowed: e.target.checked })} /> Allow N/A</label>}
            <label>Required photos (0–10)<input aria-label={`Required photos ${index + 1}`} className={`${control} w-20 ml-2`} type="number" min="0" max="10" step="1" value={item.photo_min_count ?? (item.photo_required ? 1 : 0)} onChange={e => { const count = Number(e.target.value); change(index, { photo_min_count: count, photo_required: count > 0 }) }} /></label>
            <button className={control} aria-label={`Move question ${index + 1} up`} disabled={index === 0 || items[index - 1].section !== item.section} onClick={() => move(index, -1)}>Move up</button>
            <button className={control} aria-label={`Move question ${index + 1} down`} disabled={index === items.length - 1 || items[index + 1].section !== item.section} onClick={() => move(index, 1)}>Move down</button>
            <button className={`${control} text-red-700 dark:text-red-300`} aria-label={`Remove question ${index + 1}`} aria-describedby={removalReason ? `removal-${item.id}` : undefined} disabled={!!removalReason} onClick={() => remove(item)}>Remove Question</button>
          </div>
          {removalReason && <p id={`removal-${item.id}`} className="text-sm text-slate-600 dark:text-tm-dark-muted">{removalReason}</p>}
          <p className="text-sm">{item.type === 'text' ? 'Written response' : item.options.join(' / ')}{item.na_allowed && ' / N/A'}{item.signature_required && ' · Required signature'}{item.photo_on_failure && ' · At least one photo on failure (preserved)'}</p>
        </div>})}
        <div className="flex flex-wrap gap-2"><label>New question type <select aria-label="New question type" className={control} value={type} onChange={e => setType(e.target.value)}>{Object.keys(questionPresets).map(t => <option key={t}>{t}</option>)}</select></label><label>Add to section <select aria-label="Add to section" className={control} value={sections.includes(newSection) ? newSection : sections.at(-1) || ''} onChange={e => setNewSection(e.target.value)}>{sections.map(s => <option key={s}>{s}</option>)}</select></label><button className={control} onClick={() => { setPreview(null); setItems(old => {
          const section = sections.includes(newSection) ? newSection : old.at(-1)?.section || 'New section'
          const index = old.reduce((last,item,i) => item.section === section ? i : last,-1)
          return [...old.slice(0,index+1),newChecklistQuestion(type,section),...old.slice(index+1)]
        }) }}>Add question</button></div>
        <label className="block">Revision / publication note<textarea aria-label="Revision / publication note" maxLength={2000} className={`${control} w-full block`} value={note} onChange={e => setNote(e.target.value)} /></label>
        <div className="flex flex-wrap gap-2">
          <button className={control} disabled={!dirty || photoBudget(items) > 180} onClick={() => run(async current => {
            const value = await templateEditorAction(supabase, 'save', key, state, { p_definition: items, p_note: note }); if (current()) { accept(value); setNotice('Unpublished draft saved.') }
          })}>Save unpublished draft</button>
          <button className={control} disabled={dirty || !state.draft?.editing} onClick={() => run(async current => { const value = await templateEditorAction(supabase, 'preview', key, state); if (current()) setPreview(value) })}>Preview complete checklist</button>
          <button className={`${control} font-bold`} disabled={!preview || dirty || !note.trim()} onClick={() => {
            if (!window.confirm('Publish this new template version? Only newly started checklists will use it. Existing drafts and submissions retain their original snapshots.')) return
            run(async current => { const value = await templateEditorAction(supabase, 'publish', key, state, { p_note: note }); if (current()) { accept(value); setNotice(`Published version ${value.published.version}.`); await reload() } })
          }}>Publish new version</button>
          <button className={control} onClick={() => select(key)}>Reload saved template</button>
        </div>
        {dirty && <p role="status">Unsaved template changes. Save before previewing or publishing.</p>}
      </fieldset>
      {preview && <ChecklistTemplatePreview managementAudit={managementAudit} name={preview.name} definition={preview.definition} />}
      <details><summary className="cursor-pointer font-semibold">Published versions</summary><ul>{state.versions.map(version => <li key={version.version} className="border-b py-2 space-x-2">v{version.version} · {version.published_at} · {version.note}
        <button disabled={busy} className={control} onClick={() => run(async current => { const value = await templateEditorAction(supabase, 'version', key, null, { p_restore_version: version.version }); if (current()) setOldVersion(value) })}>Review version {version.version}</button>
        <button disabled={busy} className={control} onClick={() => {
          if (!window.confirm(`Copy version ${version.version} into an unpublished draft? This replaces the shared draft, not submissions or the published version.`)) return
          run(async current => { const value = await templateEditorAction(supabase, 'restore', key, state, { p_restore_version: version.version, p_note: `Restore from version ${version.version}` }); if (current()) { accept(value); setNote(`Restore from version ${version.version}`); setNotice('Prior version copied into a draft. Preview and publish to activate it as a new version.') } })
        }}>Restore version {version.version} to draft</button>
      </li>)}</ul></details>
      {oldVersion && <ChecklistTemplatePreview managementAudit={managementAudit} name={`${oldVersion.name} · version ${oldVersion.version}`} definition={oldVersion.definition} label="Previous template version preview" />}
      <details><summary className="cursor-pointer font-semibold">Draft revision history</summary><button className={control} disabled={busy} onClick={() => run(async current => { const value = await templateEditorAction(supabase, 'revisions', key); if (current()) setRevisions(value.revisions) })}>Load revision history</button>
        {revisions?.map(revision => <details key={revision.revision} className="p-2 border-b"><summary>Revision {revision.revision} · {revision.action} · {revision.recorded_at} · {revision.note}</summary><ChecklistTemplatePreview managementAudit={managementAudit} name={`${state.published.name} · revision ${revision.revision}`} definition={revision.definition} /></details>)}
      </details>
    </>}
    {busy && <p role="status">Working…</p>}
  </section>
}
