import { useState } from 'react'
import { Link } from 'react-router-dom'
import { adminCategories, adminDestination, findAdminTools } from '../utils/administration.js'

export default function AdministrationDirectory({ tools, category, site }) {
  const [query, setQuery] = useState('')
  const searching = Boolean(query.trim())
  const results = findAdminTools(tools, query)
  const categories = searching || !category ? adminCategories : adminCategories.filter(group => group.id === category.id)

  return <>
    <div className="tm-shared-panel rounded-xl border p-4 sm:p-5">
      <label htmlFor="admin-tool-search" className="tm-field-label">Search administration tools</label>
      <input id="admin-tool-search" type="search" value={query} onChange={event => setQuery(event.target.value)}
        className="tm-field max-w-xl" placeholder="Try cash on hand, budget labels, or QR code" />
      {searching && <p className="mt-2 text-sm text-[var(--tm-muted)]" role="status">{results.length} {results.length === 1 ? 'tool' : 'tools'} found</p>}
    </div>
    <nav aria-label="Administration categories" className="flex flex-wrap gap-2">
      {adminCategories.map(group => {
        const params = new URLSearchParams({ category: group.id })
        if (site) params.set('site', site)
        return <Link key={group.id} to={`/admin?${params}`} aria-current={!searching && category?.id === group.id ? 'page' : undefined}
          onClick={() => setQuery('')} className="inline-flex min-h-11 items-center rounded-lg border border-[var(--tm-border)] bg-[var(--tm-surface)] px-3 text-sm font-semibold aria-[current=page]:border-transparent aria-[current=page]:bg-tm-teal aria-[current=page]:text-tm-navy">
          {group.label}
        </Link>
      })}
    </nav>
    {!results.length && <p>No tools match your search.</p>}
    {categories.map(group => {
      const entries = results.filter(tool => tool.category === group.id)
      if (!entries.length) return null
      return <section key={group.id} aria-labelledby={`admin-category-${group.id}`}>
        <h2 id={`admin-category-${group.id}`} className="mb-2 font-brand text-lg font-bold">{group.label}</h2>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {entries.map(tool => {
            const to = tool.path ? `${tool.path}${tool.section ? `?${new URLSearchParams({ section: tool.section, ...(site ? { site } : {}) })}` : ''}` : adminDestination(tool.tool || tool.id, site)
            return <li key={tool.id}>
              <Link to={to} className="tm-shared-panel block h-full rounded-xl border p-4 hover:border-tm-teal">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <h3 className="font-semibold">{tool.name}</h3>
                  <span className="text-xs font-semibold text-[var(--tm-muted)]">{tool.scope}</span>
                </div>
                <p className="mt-1 text-sm text-[var(--tm-muted)]">{tool.description}</p>
              </Link>
            </li>
          })}
        </ul>
      </section>
    })}
  </>
}
