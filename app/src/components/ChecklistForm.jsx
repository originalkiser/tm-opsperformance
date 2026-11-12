import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import ChecklistSignature from './ChecklistSignature'
import { validateChecklist, validateEvidence, checklistTimestamp, isChecklistItemActive } from '../utils/checklistRules'
import { downloadChecklistEvidence, checklistUploadRejection } from '../utils/checklistEvidence'

export default function ChecklistForm({ initial, user, locationLabel, onClose, onSaved, admin = false, transport = null, initialCapabilities = null, initialEvidence = [] }) {
  const recoveryKey = record => transport ? `tm_checklist_draft_${transport.guest ? transport.recoveryKey : user?.id}_${record.id}_${rowRecoveryId(record)}` : `tm_checklist_draft_${user.id}_${record.id}`
  const cached = record => { try { return JSON.parse(sessionStorage.getItem(recoveryKey(record)) || 'null') } catch { return null } }
  const recovery = useRef(cached(initial))
  const [row, setRow] = useState(initial), [answers, setAnswers] = useState(initial.answers), [name, setName] = useState(initial.manager_name)
  const key = recoveryKey(row)
  const [signatureReset, setSignatureReset] = useState(0)
  const [evidence, setEvidence] = useState(initialEvidence), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [errors, setErrors] = useState({}), [evidenceUrl, setEvidenceUrl] = useState(''), [dirtySignatures, setDirtySignatures] = useState({})
  const [capabilities, setCapabilities] = useState(initialCapabilities), [versions, setVersions] = useState(null)
  const [actorName, setActorName] = useState(''), [evidenceReady, setEvidenceReady] = useState(false)
  const activity = useRef(0), latestDirty = useRef(false)
  const working = useRef(false), discardRequested = useRef(false), unavailable = useRef(false)
  const preview = useRef(null), evidenceRequest = useRef(null), alive = useRef(true)
  const position = useRef(null), restoringHistory = useRef(false)
  const discarding = row.status === 'discarding' || discardRequested.current
  const correcting = !!row.working_copy_id
  const readonly = unavailable.current || discarding || (transport ? !evidenceReady || !capabilities?.can_edit : row.status === 'submitted' || row.created_by !== user.id)
  const canDiscard = !transport?.guest && !correcting && !unavailable.current && row.status !== 'submitted' && (transport ? capabilities?.can_discard === true : row.created_by === user.id || admin)
  const signatureDirty = Object.values(dirtySignatures).some(Boolean)
  const dirty = !readonly && (JSON.stringify(answers) !== JSON.stringify(row.answers) || name !== row.manager_name || signatureDirty)
  latestDirty.current = dirty
  const items = row.template_snapshot.definition
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false; evidenceRequest.current?.abort()
      if (preview.current) URL.revokeObjectURL(preview.current)
    }
  }, [])
  function clearEvidence() {
    if (preview.current) URL.revokeObjectURL(preview.current)
    preview.current = null; setEvidenceUrl('')
  }
  function openEvidence(file) {
    return action(async () => {
      const controller = new AbortController()
      evidenceRequest.current = controller
      const blob = transport ? await transport.download(row, file, controller.signal) : await downloadChecklistEvidence(supabase, file, user.id, controller.signal)
      if (!alive.current || controller.signal.aborted) return
      preview.current = URL.createObjectURL(blob); setEvidenceUrl(preview.current)
    })
  }
  useEffect(() => {
    let alive = true
    if (transport) {
      transport.load(row.id).then(result => { if (alive) acceptResult(result, true) }).catch(error => { if (alive) setError(error.message) })
      return () => { alive = false }
    }
    supabase.from('checklist_attachments').select('*').eq('submission_id', row.id).order('created_at').then(({ data, error }) => {
      if (!alive) return
      if (error) setError(error.message); else { setEvidence(previous => [...new Map([...(data || []), ...previous].map(file => [file.id, file])).values()]); setEvidenceReady(true) }
    })
    supabase.from('user_profiles').select('name').eq('id', row.created_by).maybeSingle().then(({ data }) => { if (alive) setActorName(data?.name || '') })
    return () => { alive = false }
  }, [row.id])
  useEffect(() => {
    if (readonly || recovery.current) return
    try { if (JSON.stringify(answers) === JSON.stringify(row.answers) && name === row.manager_name) { sessionStorage.removeItem(key); return }
      sessionStorage.setItem(key, JSON.stringify({ revision: row.revision, answers, name })) } catch { /* Server Save Draft is still available. */ }
  }, [key, readonly, answers, name, row.revision])
  useEffect(() => {
    position.current = { state: window.history?.state, url: window.location?.href }
    const leave = () => window.confirm('Leave this checklist? Save Draft first to save responses to TM Ops. Unsaved answers can be recovered in this browser tab; unsaved photos and drawings cannot.')
    const warn = event => { if (dirty || working.current) { event.preventDefault(); event.returnValue = '' } }
    const guard = event => {
      const link = event.target.closest('a[href]:not([target="_blank"])')
      const navigation = event.target.closest('nav') && ['Site Entry', 'My Dashboard', 'Sign Out'].includes(event.target.closest('button')?.textContent.trim())
      if ((dirty || working.current) && (link || navigation) && !leave()) { event.preventDefault(); event.stopPropagation() }
    }
    const back = event => {
      if (restoringHistory.current) { restoringHistory.current = false; return }
      if ((dirty || working.current) && !leave()) {
        event.stopImmediatePropagation()
        const delta = position.current.state?.idx - window.history.state?.idx
        if (Number.isFinite(delta) && delta) { restoringHistory.current = true; window.history.go(delta) }
        else window.history.replaceState(position.current.state, '', position.current.url)
      } else position.current = { state: window.history.state, url: window.location.href }
    }
    window.addEventListener('beforeunload', warn); window.addEventListener('popstate', back, true); document.addEventListener('click', guard, true)
    return () => { window.removeEventListener('beforeunload', warn); window.removeEventListener('popstate', back, true); document.removeEventListener('click', guard, true) }
  }, [dirty])
  function acceptResult(result, resetAnswers = false, resetSignatures = resetAnswers) {
    if (!alive.current) return result.row
    activity.current++
    if (resetAnswers && rowRecoveryId(result.row) !== rowRecoveryId(row)) recovery.current = cached(result.row)
    setRow(result.row); setCapabilities(result.capabilities); setEvidence(result.evidence); setEvidenceReady(true)
    if (resetAnswers) { setAnswers(result.row.answers); setName(result.row.manager_name) }
    if (resetSignatures) { setDirtySignatures({}); setSignatureReset(previous => previous + 1) }
    return result.row
  }
  useEffect(() => {
    if (!transport) return
    const refresh = async () => {
      if (working.current) return
      const expectedActivity = activity.current
      try {
        const result = await transport.load(row.id)
        if (!alive.current || working.current || expectedActivity !== activity.current) return
        setCapabilities(result.capabilities)
        if (row.working_copy_id && !result.row.working_copy_id) {
          acceptResult(result, true)
          setNotice(result.capabilities.can_begin_edit ? 'The submitted version changed elsewhere. Showing the latest submitted version; your unsubmitted changes were not applied.' : 'The correction window has closed. Showing the last submitted version; unfinished corrections were not submitted.')
        } else if (!latestDirty.current) acceptResult(result, true)
      } catch (error) {
        if (alive.current && expectedActivity === activity.current) { setCapabilities(null); clearEvidence(); setError(error.message) }
      }
    }
    window.addEventListener('focus', refresh)
    const remaining = new Date(capabilities?.edit_deadline_at).getTime() - new Date(capabilities?.server_now).getTime()
    const timer = Number.isFinite(remaining) && remaining > 0 ? setTimeout(() => {
      setCapabilities(previous => ({ ...previous, can_edit: false, can_begin_edit: false, can_upload: false }))
      refresh()
    }, Math.min(remaining + 50, 2147483647)) : null
    timer?.unref?.()
    return () => { window.removeEventListener('focus', refresh); if (timer !== null) clearTimeout(timer) }
  }, [transport, row.id, row.working_copy_id, capabilities?.edit_deadline_at, capabilities?.server_now])
  async function save(submit = false) {
    if (unavailable.current || discardRequested.current || row.status === 'discarding') throw new Error('Discard is in progress. Reload before continuing.')
    if (transport) {
      const result = await transport.save(row, { answers, name, submit })
      const data = acceptResult(result)
      if (!alive.current) return data
      setNotice(submit ? 'Checklist submitted. The original submission and earlier versions are preserved.' : correcting ? 'Correction draft saved. The last submitted version remains official.' : 'Draft saved to TM Ops.')
      try { sessionStorage.removeItem(key) } catch { /* Server copy remains authoritative. */ }
      onSaved(data)
      return data
    }
    const { data, error } = await supabase.rpc('save_checklist', { p_id: row.id, p_revision: row.revision, p_template: row.template_key,
      p_location: row.location_id, p_date: row.period_date, p_answers: answers, p_name: name, p_submit: submit })
    if (error) throw error
    setRow(data); setNotice(submit ? 'Pilot checklist submitted. MonitorQA remains the official system.' : 'Draft saved to TM Ops.')
    try { sessionStorage.removeItem(key) } catch { /* No cached data is required to reopen the server draft. */ }
    onSaved(data)
    return data
  }
  async function action(callback, discard = false) {
    if (working.current || unavailable.current || ((discardRequested.current || row.status === 'discarding') && !discard)) return false
    activity.current++; working.current = true; setBusy(true); setError(''); clearEvidence()
    try { await callback(); return true } catch (e) {
      if (alive.current) {
        if (transport && [401, 403].includes(e.status)) {
          unavailable.current = true; setCapabilities(null); setEvidence([]); setVersions(null)
          setError(`${e.message} Access is no longer available. Close this checklist and scan a current store code or sign in again.`)
        } else if (e.checklistUploadState) {
          if (e.checklistUploadState === 'discarding') {
            discardRequested.current = true
            setRow(previous => ({ ...previous, status: 'discarding' }))
          }
          else unavailable.current = true
          setError(e.message)
        } else setError(`${e.message} Nothing was retried automatically. Refresh to confirm server state before retrying, especially after a connection interruption.`)
      }
      return false
    }
    finally { working.current = false; if (alive.current) setBusy(false) }
  }
  async function upload(file, item, kind) {
    return action(async () => {
      try {
        validateEvidence(file)
        const saved = await save()
        if (!alive.current) return
        if (transport) {
          acceptResult(await transport.upload(saved, file, item, kind), true, false)
          setNotice(`${kind === 'photo' ? 'Photo' : 'Signature'} saved privately.`)
          return
        }
        const id = crypto.randomUUID(), extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[file.type]
        const path = `${row.id}/${id}.${extension}`
        const uploaded = await supabase.storage.from('manager-checklist-evidence').upload(path, file, { contentType: file.type, cacheControl: '0', upsert: false })
        if (uploaded.error) throw uploaded.error
        const attached = await supabase.rpc('attach_checklist_evidence', { p_submission: row.id, p_file: id, p_item: item, p_kind: kind, p_path: path })
        if (attached.error) throw attached.error
        setEvidence(previous => [...previous, attached.data]); setNotice(`${kind === 'photo' ? 'Photo' : 'Signature'} saved privately.`)
      } catch (error) {
        if (transport) throw error
        const rejection = await checklistUploadRejection(supabase, row.id, error)
        if (!rejection) throw error
        const message = new Error(rejection.message)
        message.checklistUploadState = rejection.status
        throw message
      }
    })
  }
  function discard() {
    if (working.current || !canDiscard) return
    if (!window.confirm('Discard this unfinished checklist? Its saved answers, photos and signature will be permanently removed. This cannot be undone.')) return
    return action(async () => {
      discardRequested.current = true
      const { data, error } = await supabase.functions.invoke('discard-checklist-draft', { body: { id: row.id, revision: row.revision } })
      if (error) throw new Error('Discard was not confirmed. Refresh to check its state, then resume Discard Draft if needed.')
      if (data?.discarded !== true || data.id !== row.id) throw new Error('Discard was not confirmed. Refresh before continuing.')
      try { sessionStorage.removeItem(key) } catch { /* A deleted ID cannot be saved again. */ }
      recovery.current = null; evidenceRequest.current?.abort(); clearEvidence()
      onClose()
    }, true)
  }
  // Keep the existing attachment key so saved evidence and validation stay compatible.
  const sectionPhoto = row.template_key === 'weekly' ? items.find(item => item.id === 'weekly-9' && item.section === 'Communications Board') : null
  function photoControl(item, section = false) {
    return <div className="space-y-1 text-sm" aria-label={section ? 'Communications Board section photo' : `Photo evidence ${item.id}`}>
      <p className="font-semibold">{section ? 'One photo required for the Communications Board section.' : 'One photo required for this item.'}</p>
      {section && item.instruction && <p>{item.instruction}</p>}
      {!readonly && (!transport || capabilities?.can_upload) && <label className="block">Add photo
        <input aria-label={`Upload photo ${item.id}`} disabled={busy} type="file" accept="image/jpeg,image/png,image/webp"
          className="block w-full min-h-11 min-w-0 text-sm file:min-h-11 file:mr-2 file:px-3 file:border file:rounded file:bg-transparent file:text-inherit"
          onChange={e => { const file = e.target.files?.[0]; if (file) upload(file, item.id, 'photo'); e.target.value = '' }} />
      </label>}
    </div>
  }
  function signatureControl(item = null) {
    const signatureKey = item?.id || '_final'
    return <div className="space-y-2" aria-label={item ? `Required signature ${item.id}` : 'Final auditor signature'}>
      <p className="font-semibold">{item ? 'Signature is required' : row.template_key === 'weekly_pm' ? 'Auditor Signature' : 'Manager signature'}</p>
      <EvidenceLinks files={evidence.filter(file => file.kind === 'signature' && (file.item_id || null) === (item?.id || null)).slice(-1)} onOpen={openEvidence} />
      {!readonly && (!transport || capabilities?.can_upload) && <ChecklistSignature key={`${signatureKey}:${signatureReset}`} label={item ? `${item.section} Question ${item.number} handwritten signature` : row.template_key === 'weekly_pm' ? 'Auditor handwritten signature' : 'Manager handwritten signature'} disabled={busy} onDirty={value => { activity.current++; setDirtySignatures(previous => ({ ...previous, [signatureKey]: value })) }} onSave={blob => upload(blob, item?.id || null, 'signature')} />}
    </div>
  }
  function change(id, field, value) { activity.current++; setAnswers(previous => ({ ...previous, [id]: { ...previous[id], [field]: value } })); setErrors({}) }
  function close() {
    if (busy) return
    if (!dirty || window.confirm('Close this draft? Unsaved answers can be recovered in this browser tab. Unsaved photos and drawings cannot.')) onClose()
  }
  return <section className="space-y-3 border rounded-xl p-3 sm:p-4 text-sm sm:text-base bg-white dark:bg-tm-dark-surface" aria-label="Checklist responses">
    <h2 className="text-lg sm:text-xl font-bold">{row.template_snapshot.name} · {row.period_date}</h2>
    <p className="text-xs sm:text-sm break-words">Location: {locationLabel || row.location_id}{transport ? transport.guest ? ' · Store QR access. Names are self-reported.' : ' · Signed-in account access.' : <> · Authenticated account: {actorName} ({row.created_by})</>}</p>
    {transport && capabilities?.edit_deadline_at && <p className="text-sm">Corrections close: {checklistTimestamp(capabilities.edit_deadline_at, row.template_snapshot.timezone)}. The first submission sets this deadline.</p>}
    {correcting && !capabilities?.can_edit && <p role="alert" className="rounded border border-amber-500 p-3">This is an unfinished correction, not the submitted record. Editing is locked. Refresh the saved checklist to view the official version.</p>}
    {correcting && <p role="status" className="rounded border p-3">Editing a correction. The last submitted version remains official until you submit these changes. Draw fresh required signatures to confirm these corrected answers.</p>}
    {transport && capabilities?.can_begin_edit && !correcting && <button disabled={busy} className="min-h-12 px-4 border rounded" onClick={() => action(async () => { acceptResult(await transport.beginCorrection(row), true); recovery.current = null; setNotice('Correction started. Earlier answers, photos and signatures are preserved.') })}>Make same-day correction</button>}
    {transport && <button disabled={busy} className="min-h-11 px-3 border rounded" onClick={() => { if (!dirty || window.confirm('Replace unsaved changes with the saved checklist?')) action(async () => { acceptResult(await transport.load(row.id), true); recovery.current = null; setNotice('Loaded the saved checklist.'); }) }}>Refresh saved checklist</button>}
    <p>{readonly ? `${row.status} · ${row.manager_name || 'Unnamed draft'} · ${checklistTimestamp(row.submitted_at || row.updated_at, row.template_snapshot.timezone)}` : 'Answers are not autosaved to TM Ops. Use Save Draft; adding a photo or signature also saves your answers. Internet connection required.'}</p>
    {discarding && <p role="status">Discard pending. Editing and uploads are blocked. Use Discard Draft to finish cleanup.</p>}
    {recovery.current && !readonly && <div className="border p-3"><p>Unsaved answers were found in this browser tab. Review before restoring; saved data may have changed.</p>
      <button className="min-h-12 px-4 border rounded" disabled={busy} onClick={() => { activity.current++; setAnswers(recovery.current.answers); setName(recovery.current.name); recovery.current = null; setNotice('Recovered answers are not saved yet.') }}>Restore unsaved answers</button>
      <button className="min-h-12 px-4 border rounded" onClick={() => { recovery.current = null; try { sessionStorage.removeItem(key) } catch { /* Server draft is authoritative. */ } setNotice('Using the server draft.') }}>Use saved draft</button></div>}
    {error && <p role="alert" className="text-red-600 dark:text-red-300">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {Object.keys(errors).length > 0 && <p role="alert">Complete the highlighted responses and evidence before submitting.</p>}
    {items.map((item, index) => isChecklistItemActive(item, answers) && <div key={item.id}>
      {(index === 0 || items[index - 1].section !== item.section) && <div className="mt-4 border-b pb-2 space-y-2">
        <h3 className="text-lg font-bold">{item.section}</h3>
        {sectionPhoto?.section === item.section && <>
          {(sectionPhoto.photo_required || (sectionPhoto.photo_on_failure && sectionPhoto.failure_values.includes(answers[sectionPhoto.id]?.value))) && photoControl(sectionPhoto, true)}
          <EvidenceLinks files={evidence.filter(file => file.item_id === sectionPhoto.id)} onOpen={openEvidence} />
        </>}
      </div>}
      <fieldset disabled={readonly || busy} className={`py-2 space-y-2 ${errors[item.id] ? 'border-2 border-red-500 p-3 rounded' : 'border-b'}`}>
        <legend className="pt-2 font-semibold text-sm sm:text-base leading-snug">{item.number ?? index - items.findIndex(previous => previous.section === item.section) + 1}. {item.text} {item.critical && <span className="text-red-600 dark:text-red-300"> · Critical question</span>}</legend>
        {item.instruction && item !== sectionPhoto && <p className="text-xs sm:text-sm">{item.instruction}</p>}
        {item.condition && <p className="text-xs sm:text-sm">Follow-up to Question {items.find(parent => parent.id === item.condition.item_id)?.number} when answered {item.condition.value}.</p>}
        {item.type === 'text' ? <label className="block">Written response
          <textarea aria-label={`Written response ${item.id}`} className="block w-full border rounded p-3 bg-transparent" maxLength={4000} value={answers[item.id]?.value || ''} onChange={event => change(item.id, 'value', event.target.value)} />
        </label> : <div className="flex flex-wrap gap-2">{[...item.options, ...(item.na_allowed ? ['N/A'] : [])].map(option => <label key={option} className="min-h-11 flex items-center gap-2 border rounded px-3 text-sm cursor-pointer">
          <input type="radio" name={item.id} value={option} checked={answers[item.id]?.value === option} onChange={() => change(item.id, 'value', option)} className="w-5 h-5 shrink-0" />{option}</label>)}</div>}
        {(item.explanation_required || item.failure_values.includes(answers[item.id]?.value) || answers[item.id]?.value === 'N/A' || answers[item.id]?.explanation) && <label className="block">Explanation / N/A reason
          <textarea className="block w-full border rounded p-3 bg-transparent" maxLength={4000} value={answers[item.id]?.explanation || ''} onChange={event => change(item.id, 'explanation', event.target.value)} /></label>}
        {(item !== sectionPhoto && (item.photo_required || (item.photo_on_failure && item.failure_values.includes(answers[item.id]?.value)))) && photoControl(item)}
        {errors[item.id] && <p role="alert" className="text-red-600 dark:text-red-300">{errors[item.id]}</p>}
      </fieldset>
      {item.signature_required && signatureControl(item)}
      {item !== sectionPhoto && <EvidenceLinks files={evidence.filter(file => file.item_id === item.id && file.kind === 'photo')} onOpen={openEvidence} />}
    </div>)}
    <label className="block font-semibold">Manager full name<input aria-label="Manager full name" disabled={readonly || busy} value={name} maxLength={200} onChange={event => { activity.current++; setName(event.target.value) }} className="block w-full border rounded p-3 bg-transparent" /></label>
    {errors._name && <p role="alert">{errors._name}</p>}
    {signatureControl()}
    {errors._signature && <p role="alert">{errors._signature}</p>}
    {evidenceUrl && <figure aria-label="Private checklist evidence" className="border rounded p-3 space-y-2">
      <img src={evidenceUrl} alt="Saved checklist photo or manager signature" className="max-h-[70vh] max-w-full object-contain bg-white" />
      <button className="min-h-12 px-4 border rounded" onClick={clearEvidence}>Close evidence</button>
    </figure>}
    {transport && row.status === 'submitted' && <div className="space-y-2">
      <button disabled={busy} className="min-h-11 px-3 underline" onClick={() => action(async () => { const result = await transport.history(row); setVersions(result.versions || []) })}>View submission history</button>
      {versions && <div className="border rounded p-3 space-y-3" aria-label="Submission history">{versions.length ? versions.map((version, index) => <details key={version.id || index}>
        <summary className="min-h-11 cursor-pointer">Version {version.revision ?? index + 1} · {version.manager_name || version.actor_name || 'Recorded submission'} · {(version.recorded_at || version.created_at) ? checklistTimestamp(version.recorded_at || version.created_at, row.template_snapshot.timezone) : ''}</summary>
        <p>{version.actor_kind === 'guest' ? 'Store QR access; name self-reported.' : 'Authenticated account submission.'}</p>
        {(version.template_snapshot?.definition || items).filter(item => isChecklistItemActive(item, version.answers || {})).map(item => <p key={item.id} className="py-1"><strong>{item.text}</strong>: {version.answers?.[item.id]?.value || '—'} {version.answers?.[item.id]?.explanation || ''}</p>)}
        <EvidenceLinks files={version.evidence || version.evidence_manifest || []} onOpen={openEvidence} />
      </details>) : <p>No version history is available yet.</p>}</div>}
    </div>}
    {canDiscard && <button disabled={busy} className="min-h-11 px-3 border border-red-500 rounded text-red-600 dark:text-red-300 text-sm" onClick={discard}>Discard Draft</button>}
    <div className="grid grid-cols-[1fr_1fr_auto] gap-2 sticky bottom-0 bg-white dark:bg-tm-dark-surface py-2 border-t pb-[max(0.5rem,env(safe-area-inset-bottom))] text-sm">
      {!readonly && <><button disabled={busy} className="min-h-11 px-2 sm:px-4 border rounded" onClick={() => action(() => save())}>Save Draft</button>
        <button disabled={busy || signatureDirty || !evidenceReady} className="min-h-11 px-2 sm:px-4 rounded bg-tm-teal text-tm-navy font-bold" onClick={() => {
          const problems = validateChecklist(items, answers, evidence, name); setErrors(problems)
          if (!Object.keys(problems).length && window.confirm(transport ? 'Submit this checklist? Corrections are allowed only until midnight on its first submission day at this location. Earlier submissions and evidence are preserved. MonitorQA remains official.' : 'Submit this pilot checklist? Answers, photos and signature will be locked. MonitorQA remains official.')) action(() => save(true))
        }}>Submit</button></>}
      <button disabled={busy} className="min-h-11 px-2 sm:px-4 border rounded" onClick={close}>Close</button>
    </div>
  </section>
}
function EvidenceLinks({ files, onOpen }) {
  return <div className="flex flex-wrap gap-2 text-sm">{files.map((file, index) => <button key={file.id} type="button" className="min-h-11 px-2 underline" onClick={() => onOpen(file)}>View saved {file.kind} {index + 1}</button>)}</div>
}

function rowRecoveryId(row) { return row.working_copy_id || 'original' }
