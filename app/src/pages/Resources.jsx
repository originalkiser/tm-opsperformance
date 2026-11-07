import { useEffect, useRef, useState } from 'react'
import NavBar from '../components/NavBar'
import ResourceViewer from '../components/ResourceViewer'
import { useAuth } from '../contexts/AuthContext'
import { supabase, supabasePublicKey } from '../lib/supabase'
import { RESOURCE_CATEGORIES, resourceAccess, validateResourceMetadata, validatePdf, filterResources, resourceAction, cleanupResource, uploadResource } from '../utils/resourceLibrary'

const control = 'min-h-11 min-w-0 max-w-full p-2 border rounded bg-white dark:bg-tm-dark-surface'
function MetadataFields({ value, change, brands, optionalTitle = false }) {
  return <>
    <label className="grid gap-1">Title{optionalTitle ? ' (optional for one PDF; otherwise filenames are used)' : ''}<input maxLength={200} className={control} value={value.title} onChange={e => change({ ...value, title: e.target.value })} /></label>
    <label className="grid gap-1">Category<select className={control} value={value.category} onChange={e => change({ ...value, category: e.target.value, brand: '' })}>{RESOURCE_CATEGORIES.map(category => <option key={category}>{category}</option>)}</select></label>
    {value.category === 'Equipment Manuals' && <label className="grid gap-1">Manufacturer<input list="resource-manufacturers" maxLength={100} className={control} value={value.brand} onChange={e => change({ ...value, brand: e.target.value })} /><datalist id="resource-manufacturers">{brands.map(brand => <option key={brand} value={brand} />)}</datalist></label>}
  </>
}

export default function Resources() {
  const { user, profile } = useAuth(), allowed = resourceAccess(profile), admin = allowed && profile.role === 'admin'
  const [rows, setRows] = useState([]), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [query, setQuery] = useState(''), [category, setCategory] = useState(''), [brand, setBrand] = useState('')
  const [viewer, setViewer] = useState(null), [editing, setEditing] = useState(null), [progress, setProgress] = useState('')
  const [metadata, setMetadata] = useState({ title: '', category: RESOURCE_CATEGORIES[0], brand: '' })
  const working = useRef(false), mounted = useRef(false), uploadController = useRef(null), request = useRef(0)
  const currentUser = useRef(user?.id)
  currentUser.current = user?.id
  const brands = [...new Set(rows.filter(row => row.category === 'Equipment Manuals' && row.brand).map(row => row.brand))].sort((a, b) => a.localeCompare(b))
  async function load() {
    const generation = ++request.current
    const result = await supabase.from('resource_documents').select('*').order('title')
    if (!mounted.current || generation !== request.current) return
    if (result.error) throw new Error(result.error.message)
    setRows(result.data || [])
  }
  useEffect(() => {
    mounted.current = true; setRows([]); setViewer(null)
    if (allowed) load().catch(error => { if (mounted.current) setError(error.message) })
    return () => { mounted.current = false; request.current++; uploadController.current?.abort() }
  }, [user?.id, allowed, admin])
  async function run(action) {
    if (working.current) return
    working.current = true; setBusy(true); setError('')
    try { await action() } catch (error) { if (mounted.current) setError(error.message) }
    finally {
      try { if (mounted.current) await load() } catch (error) { if (mounted.current) setError(error.message) }
      working.current = false
      if (mounted.current) { setBusy(false); setProgress('') }
    }
  }
  async function transfer(file, row, actorId) {
    uploadController.current = new AbortController()
    setProgress(`Uploading ${file.name}…`)
    await uploadResource(supabase, file, row, supabasePublicKey, (sent, total) => {
      if (mounted.current) setProgress(`Uploading ${file.name}: ${Math.round(sent / total * 100)}%`)
    }, uploadController.current.signal)
    if (!mounted.current || currentUser.current !== actorId) throw new Error('Upload completed. Return to Resources to finish publishing it.')
    const published = await resourceAction(supabase, 'publish', row)
    if (published.cleanup_path) await cleanupResource(supabase, published)
  }
  function selectFiles(event, row = null) {
    const files = Array.from(event.target.files || []); event.target.value = ''
    if (!files.length) return
    const actorId = user.id
    return run(async () => {
      // Validate the whole selection before reserving any uploads.
      const validated = []
      for (const file of files) {
        const info = await validatePdf(file)
        const fields = { ...metadata, title: files.length === 1 && metadata.title.trim() ? metadata.title.trim() : file.name.replace(/\.pdf$/i, '') }
        if (!row) validateResourceMetadata(fields)
        validated.push({ file, info, fields })
      }
      for (const { file, info, fields } of validated) {
        if (!mounted.current || currentUser.current !== actorId) throw new Error('Upload canceled because the account or page changed.')
        const pending = row?.pending_upload ? row : await resourceAction(supabase, 'prepare', row, { ...fields, ...info })
        if (!mounted.current || currentUser.current !== actorId) throw new Error('Upload reserved. Return to Resources to resume or cancel it.')
        await transfer(file, pending, actorId)
      }
    })
  }
  if (!allowed) return <><NavBar /><main className="p-4"><p role="alert">Resources are available to active Admin and Store accounts only.</p></main></>
  const visible = filterResources(rows, { query, category, brand })
  return <div className="min-h-screen bg-tm-cream dark:bg-tm-dark-bg text-slate-900 dark:text-tm-dark-text">
    <NavBar />
    <main className="max-w-5xl mx-auto p-4 space-y-4">
      <h1 className="text-2xl font-bold">Resource Center</h1>
      {error && <p role="alert" className="text-red-700 dark:text-red-300">{error} Refresh before retrying if the document changed.</p>}
      <div className="grid sm:grid-cols-3 gap-3">
        <label className="grid gap-1">Search<input type="search" className={control} placeholder="Title, category or manufacturer" value={query} onChange={e => setQuery(e.target.value)} /></label>
        <label className="grid gap-1">Category<select className={control} value={category} onChange={e => { setCategory(e.target.value); setBrand('') }}><option value="">All categories</option>{RESOURCE_CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></label>
        <label className="grid gap-1">Manufacturer<select className={control} value={brand} onChange={e => { setBrand(e.target.value); if (e.target.value) setCategory('Equipment Manuals') }}><option value="">All manufacturers</option>{brands.map(b => <option key={b}>{b}</option>)}</select></label>
      </div>
      <button className={control} disabled={busy} onClick={() => run(async () => {})}>Refresh resources</button>
      {admin && <details className="border rounded p-3">
        <summary className="font-bold py-2">Upload PDFs</summary>
        <fieldset disabled={busy} className="grid sm:grid-cols-2 gap-3 mt-3">
          <MetadataFields value={metadata} change={setMetadata} brands={brands} optionalTitle />
          <label className="grid gap-1 min-w-0">Select one or multiple PDFs<input className={`${control} w-full text-sm`} type="file" accept="application/pdf,.pdf" multiple onChange={selectFiles} /></label>
          <p className="text-sm">Maximum 50 MB per PDF. Category and manufacturer apply to all selected files. Uploads run one at a time; interrupted files can be resumed below.</p>
        </fieldset>
      </details>}
      {progress && <div role="status" className="flex flex-wrap items-center gap-3"><span>{progress}</span><button className={control} onClick={() => uploadController.current?.abort()}>Pause upload</button></div>}
      {!visible.length && <p>No matching documents.</p>}
      {visible.map((row, index) => <div key={row.id} className="space-y-2">
        {(index === 0 || visible[index - 1].category !== row.category) && <h2 className="text-xl font-bold pt-3">{row.category}</h2>}
        {row.category === 'Equipment Manuals' && (index === 0 || visible[index - 1].category !== row.category || visible[index - 1].brand !== row.brand) && <h3 className="font-bold pt-2">{row.brand}</h3>}
        <article className="min-w-0 break-words border rounded p-3 bg-white dark:bg-tm-dark-surface space-y-3">
          <div><h3 className="font-semibold">{row.title}</h3>{row.file_size && <p className="text-sm">{(row.file_size / 1024 / 1024).toFixed(1)} MB · PDF</p>}</div>
          {row.object_path && !row.removed && <button className={control} onClick={() => setViewer(row)}>Open / Download PDF</button>}
          {admin && <div className="flex flex-wrap gap-3 items-center">
            {row.cleanup_path ? <><p>File cleanup pending{row.removed ? ' — removed from the library' : ''}.</p><button className={control} disabled={busy} onClick={() => run(() => cleanupResource(supabase, row))}>Retry file cleanup</button></> : row.pending_upload ? <>
              <label className="grid gap-1 min-w-0 max-w-full">Resume upload: {row.pending_upload.filename}<input className={`${control} w-full text-sm`} disabled={busy} type="file" accept="application/pdf,.pdf" onChange={event => selectFiles(event, row)} /></label>
              <button className={control} disabled={busy} onClick={() => run(async () => { const published = await resourceAction(supabase, 'publish', row); if (published.cleanup_path) await cleanupResource(supabase, published) })}>Finish completed upload</button>
              <button className={control} disabled={busy} onClick={() => { if (window.confirm('Cancel this pending upload and remove its uploaded file? The currently published PDF will be preserved.')) run(async () => cleanupResource(supabase, await resourceAction(supabase, 'cancel', row))) }}>Cancel pending upload</button>
            </> : <>
              <button className={control} disabled={busy} onClick={() => setEditing({ ...row })}>Edit metadata</button>
              <label className="grid gap-1 min-w-0 max-w-full">Replace PDF<input className={`${control} w-full text-sm`} disabled={busy} type="file" accept="application/pdf,.pdf" onChange={event => { if (window.confirm(`Replace “${row.title}” with the selected PDF?`)) selectFiles(event, row); else event.target.value = '' }} /></label>
              <button className={control} disabled={busy} onClick={() => { if (window.confirm(`Remove “${row.title}” and delete its PDF? This cannot be undone.`)) run(async () => cleanupResource(supabase, await resourceAction(supabase, 'remove', row))) }}>Remove document</button>
            </>}
          </div>}
        </article>
      </div>)}
      {editing && <div role="dialog" aria-modal="true" aria-label="Edit resource metadata" className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-3"><form className="max-w-xl w-full max-h-[95dvh] overflow-auto p-4 rounded bg-tm-cream dark:bg-tm-dark-bg grid gap-3" onSubmit={event => { event.preventDefault(); run(async () => { validateResourceMetadata(editing); await resourceAction(supabase, 'edit', editing, editing); setEditing(null) }) }}>
        <h2 className="font-bold">Edit document metadata</h2><fieldset disabled={busy} className="grid gap-3"><MetadataFields value={editing} change={setEditing} brands={brands} /></fieldset>
        <div className="flex gap-3"><button className={control} disabled={busy}>Save metadata</button><button type="button" className={control} disabled={busy} onClick={() => setEditing(null)}>Cancel</button></div>
        {error && <p role="alert">{error}</p>}
      </form></div>}
      {viewer && <ResourceViewer key={viewer.object_path} client={supabase} document={viewer} userId={user.id} onClose={() => setViewer(null)} />}
    </main>
  </div>
}
