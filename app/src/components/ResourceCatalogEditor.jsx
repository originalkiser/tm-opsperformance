import { useState } from 'react'
import { catalogCategories, catalogManufacturers, catalogAction } from '../utils/resourceCatalog'
const control = 'min-h-11 px-3 py-2 border rounded bg-white dark:bg-tm-dark-surface text-sm'
export default function ResourceCatalogEditor({ client, catalog, busy, run }) {
  const [name, setName] = useState(''), [parentId, setParentId] = useState(''), [editing, setEditing] = useState(null)
  const categories = catalogCategories(catalog), parent = categories.find(c => c.id === parentId)
  const siblings = parent ? catalogManufacturers(catalog, parent.category_key) : categories
  const act = (action, folder, data) => run(() => catalogAction(client, action, catalog, folder, data))
  return <details className="border rounded p-3">
    <summary className="font-bold py-2">Manage folders</summary>
    <fieldset disabled={busy} className="space-y-3 mt-2">
      <label className="grid gap-1">Manage<select className={control} value={parentId} onChange={e => { setParentId(e.target.value); setEditing(null) }}><option value="">Categories</option>{categories.filter(c => c.uses_manufacturers).map(c => <option key={c.id} value={c.id}>{c.name} manufacturers</option>)}</select></label>
      <form className="flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); run(async () => { await catalogAction(client, parent ? 'add_manufacturer' : 'add_category', catalog, parent, { name }); setName('') }) }}>
        <label className="grid gap-1 flex-1">New {parent ? 'manufacturer' : 'category'}<input required maxLength={parent ? 100 : 200} className={control} value={name} onChange={e => setName(e.target.value)} /></label><button className={control}>Add</button>
      </form>
      {siblings.map((folder, i) => <div key={folder.id} className="flex flex-wrap items-center gap-2 border-t pt-2">
        {editing?.id === folder.id ? <form className="flex flex-wrap gap-2 flex-1" onSubmit={e => { e.preventDefault(); run(async () => { await catalogAction(client, 'rename', catalog, folder, { name: editing.name }); setEditing(null) }) }}>
          <input aria-label="Folder name" required maxLength={parent ? 100 : 200} className={`${control} min-w-0 flex-1`} value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} />
          <button className={control}>Save name</button><button type="button" className={control} onClick={() => setEditing(null)}>Cancel</button>
        </form> : <><span className="flex-1 break-words">{folder.name}</span><button className={control} onClick={() => setEditing({ ...folder })}>Rename</button></>}
        <button className={control} aria-label={`Move ${folder.name} up`} disabled={i === 0} onClick={() => act('move', folder, { direction: -1 })}>↑</button>
        <button className={control} aria-label={`Move ${folder.name} down`} disabled={i === siblings.length - 1} onClick={() => act('move', folder, { direction: 1 })}>↓</button>
        <button className={control} onClick={() => { if (window.confirm(`Delete empty folder “${folder.name}”? Documents must be reassigned first.`)) act('delete', folder) }}>Delete empty</button>
      </div>)}
    </fieldset>
  </details>
}
