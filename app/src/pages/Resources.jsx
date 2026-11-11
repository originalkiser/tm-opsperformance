import { useEffect, useRef, useState } from 'react'
import NavBar from '../components/NavBar'
import ResourceViewer from '../components/ResourceViewer'
import ResourceCatalogEditor from '../components/ResourceCatalogEditor'
import { catalogCategories, catalogManufacturers, categoryFolder, resourceLabels } from '../utils/resourceCatalog'
import { useAuth } from '../contexts/AuthContext'
import { supabase, supabasePublicKey } from '../lib/supabase'
import { resourceAccess, validateResourceMetadata, validatePdf, filterResources, resourceAction, cleanupResource, uploadResource } from '../utils/resourceLibrary'

const control = 'resource-control'
function MetadataFields({ value, change, catalog, optionalTitle = false }) {
  const folder = categoryFolder(catalog, value.category)
  return <>
    <label className="grid gap-1">Title{optionalTitle ? ' (optional for one PDF; otherwise filenames are used)' : ''}<input maxLength={200} className={control} value={value.title} onChange={e => change({ ...value, title: e.target.value })} /></label>
    <label className="grid gap-1">Category<select className={control} value={value.category} onChange={e => change({ ...value, category: e.target.value, brand: '' })}>{catalogCategories(catalog).map(c => <option key={c.id} value={c.category_key}>{c.name}</option>)}</select></label>
    {folder?.uses_manufacturers && <label className="grid gap-1">Manufacturer<select className={control} value={value.brand} onChange={e => change({ ...value, brand: e.target.value })}><option value="">Select manufacturer</option>{catalogManufacturers(catalog, value.category).map(c => <option key={c.id} value={c.brand_key}>{c.name}</option>)}</select></label>}
  </>
}

export default function Resources() {
  const { user, profile } = useAuth(), allowed = resourceAccess(profile), admin = allowed && profile.role === 'admin'
  const [catalog, setCatalog] = useState([])
  const [rows, setRows] = useState([]), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [query, setQuery] = useState(''), [category, setCategory] = useState(''), [brand, setBrand] = useState('')
  const [viewer, setViewer] = useState(null), [editing, setEditing] = useState(null), [progress, setProgress] = useState('')
  const [metadata, setMetadata] = useState({ title: '', category: '', brand: '' })
  const working = useRef(false), mounted = useRef(false), uploadController = useRef(null), request = useRef(0)
  const currentUser = useRef(user?.id)
  currentUser.current = user?.id
  async function load() {
    const generation = ++request.current
    const [result, folders] = await Promise.all([supabase.from('resource_documents').select('*').order('title'), supabase.from('resource_catalog').select('*').order('sort_order')])
    if (!mounted.current || generation !== request.current) return
    if (result.error || folders.error) throw new Error(result.error?.message || folders.error.message)
    setRows(result.data || []); setCatalog(folders.data || [])
  }
  useEffect(() => {
    mounted.current = true; setRows([]); setCatalog([]); setViewer(null)
    if (allowed) load().catch(error => { if (mounted.current) setError(error.message) })
    return () => { mounted.current = false; request.current++; uploadController.current?.abort() }
  }, [user?.id, allowed, admin])
  useEffect(() => {
    if (category && !categoryFolder(catalog, category)) { setCategory(''); setBrand('') }
    else if (brand && !catalogManufacturers(catalog, category).some(c => c.brand_key === brand)) setBrand('')
    setMetadata(previous => categoryFolder(catalog, previous.category) ? previous : { ...previous, category: catalogCategories(catalog)[0]?.category_key || '', brand: '' })
  }, [catalog])
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
        if (!row) validateResourceMetadata(fields, catalog)
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
  const searching = !!query.trim(), folder = categoryFolder(catalog, category)
  const browsingFolders = !searching && (!category || (folder?.uses_manufacturers && !brand))
  const folders = !category ? catalogCategories(catalog) : catalogManufacturers(catalog, category)
  const visible = browsingFolders ? [] : filterResources(rows, searching ? { query } : { category, brand }, catalog)
  const home = () => { setQuery(''); setCategory(''); setBrand('') }
  const back = () => { if (searching) setQuery(''); else if (brand) setBrand(''); else setCategory('') }
  const manufacturer = catalogManufacturers(catalog, category).find(c => c.brand_key === brand)
  return <div className="min-h-screen bg-tm-cream dark:bg-tm-dark-bg text-slate-900 dark:text-tm-dark-text">
    <NavBar />
    <main className="resource-center max-w-6xl mx-auto p-4 sm:p-6 space-y-5">
      <header className="rounded-2xl bg-tm-navy text-white p-6 sm:p-8 border border-tm-blue shadow-md">
        <p className="font-brand text-xs font-semibold uppercase tracking-widest text-tm-teal">TM Operations · Resources</p>
        <h1 className="font-brand text-3xl sm:text-4xl font-bold mt-2">Resource Center</h1>
        <p className="mt-2 text-sm text-slate-300 max-w-xl">Your library of manuals, guides, and reference documents. Browse a folder or search to find what you need.</p>
      </header>
      {error && <p role="alert" className="text-red-700 dark:text-red-300">{error} Refresh before retrying if the document changed.</p>}
      <label className="resource-panel grid gap-2 font-brand text-sm font-semibold">Search all documents<input type="search" className={control} placeholder="Title, category or manufacturer" value={query} onChange={e => setQuery(e.target.value)} /></label>
      <nav aria-label="Resource folders" className="flex flex-wrap items-center gap-2 text-sm">
        <button className={control} onClick={home}>Resources</button>
        {searching ? <span aria-current="page">/ Search results</span> : <>
          {folder && <><span>/</span><button className={control} onClick={() => setBrand('')}>{folder.name}</button></>}
          {manufacturer && <span aria-current="page">/ {manufacturer.name}</span>}
        </>}
        {(category || searching) && <button className={control} onClick={back}>Back</button>}
      </nav>
      <button className={control} disabled={busy} onClick={() => run(async () => {})}>Refresh resources</button>
      {admin && <details className="resource-panel">
        <summary className="font-brand font-semibold py-2 cursor-pointer text-tm-blue dark:text-tm-teal">Upload PDFs</summary>
        <fieldset disabled={busy} className="grid sm:grid-cols-2 gap-3 mt-3">
          <MetadataFields value={metadata} change={setMetadata} catalog={catalog} optionalTitle />
          <label className="grid gap-1 min-w-0">Select one or multiple PDFs<input className={`${control} w-full text-sm`} type="file" accept="application/pdf,.pdf" multiple onChange={selectFiles} /></label>
          <p className="text-sm">Maximum 50 MB per PDF. Category and manufacturer apply to all selected files. Uploads run one at a time; interrupted files can be resumed below.</p>
        </fieldset>
      </details>}
      {admin && <ResourceCatalogEditor client={supabase} catalog={catalog} busy={busy} run={run} />}
      {progress && <div role="status" className="flex flex-wrap items-center gap-3"><span>{progress}</span><button className={control} onClick={() => uploadController.current?.abort()}>Pause upload</button></div>}
      {browsingFolders && <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">{folders.map(c => <button key={c.id} className="resource-folder group" onClick={() => { if (category) setBrand(c.brand_key); else { setCategory(c.category_key); setBrand('') } }}><span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-tm-teal/20 text-tm-blue dark:text-tm-teal"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3Z" /></svg></span><span className="min-w-0 flex-1 break-words">{c.name}</span><span aria-hidden="true" className="text-tm-blue dark:text-tm-teal group-hover:translate-x-1 transition-transform"> →</span></button>)}{!folders.length && <p>No folders yet.</p>}</div>}
      {!browsingFolders && !visible.length && <p>No matching documents.</p>}
      {visible.map(row => <div key={row.id} className="space-y-2">
        <article className="resource-panel min-w-0 break-words space-y-4">
          <div><h3 className="font-brand text-lg font-semibold text-tm-blue dark:text-tm-teal">{row.title}</h3>{searching && <p className="text-sm">{resourceLabels(row, catalog).category}{row.brand ? ` / ${resourceLabels(row, catalog).brand}` : ''}</p>}{row.file_size && <p className="text-sm">{(row.file_size / 1024 / 1024).toFixed(1)} MB · PDF</p>}</div>
          {row.object_path && !row.removed && <button className="resource-primary" onClick={() => setViewer(row)}>Open / Download PDF</button>}
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
      {editing && <div role="dialog" aria-modal="true" aria-label="Edit resource metadata" className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-3"><form className="resource-panel max-w-xl w-full max-h-[95dvh] overflow-auto grid gap-4" onSubmit={event => { event.preventDefault(); run(async () => { validateResourceMetadata(editing, catalog); await resourceAction(supabase, 'edit', editing, editing); setEditing(null) }) }}>
        <h2 className="font-bold">Edit document metadata</h2><fieldset disabled={busy} className="grid gap-3"><MetadataFields value={editing} change={setEditing} catalog={catalog} /></fieldset>
        <div className="flex gap-3"><button className={control} disabled={busy}>Save metadata</button><button type="button" className={control} disabled={busy} onClick={() => setEditing(null)}>Cancel</button></div>
        {error && <p role="alert">{error}</p>}
      </form></div>}
      {viewer && <ResourceViewer key={viewer.object_path} client={supabase} document={viewer} userId={user.id} onClose={() => setViewer(null)} />}
    </main>
  </div>
}
