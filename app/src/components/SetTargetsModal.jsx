import { useState } from 'react'
import { supabase } from '../lib/supabase'

const monthLabel = (monthStr) =>
  new Date(monthStr + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

const emptyForm = () => ({ revenue_goal: '', membership_goal: '', desired_rating: '4.85', labor_hours_non_salary: '', labor_hours_with_salary: '' })

const inputCls = 'w-full border border-gray-300 dark:border-tm-dark-border rounded-lg px-3 py-2 text-sm bg-white dark:bg-tm-dark-surface text-gray-800 dark:text-tm-dark-text focus:outline-none focus:ring-2 focus:ring-tm-teal font-brand'
const cellInputCls = 'w-24 border border-gray-300 dark:border-tm-dark-border rounded px-2 py-1 text-xs bg-white dark:bg-tm-dark-surface text-gray-800 dark:text-tm-dark-text focus:outline-none focus:ring-1 focus:ring-tm-teal font-brand'

async function saveTarget(item, form) {
  const numOrZero = (v) => v === '' ? 0 : Number(v)
  return supabase.from('budget_targets').upsert({
    location_id: item.location.id,
    target_month: item.month,
    revenue_goal: numOrZero(form.revenue_goal),
    membership_goal: numOrZero(form.membership_goal),
    desired_rating: numOrZero(form.desired_rating),
    labor_hours_non_salary: numOrZero(form.labor_hours_non_salary),
    labor_hours_with_salary: numOrZero(form.labor_hours_with_salary),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'location_id,target_month' })
}

// ── Sequential mode: one site at a time, "N remaining" progress ──────────────

function SequentialFlow({ items, onDone }) {
  const [remaining, setRemaining] = useState(items)
  const [form, setForm] = useState(emptyForm())
  const [saving, setSaving] = useState(false)

  const current = remaining[0]
  if (!current) {
    return (
      <div className="py-10 text-center">
        <p className="font-brand font-bold text-tm-blue dark:text-tm-teal text-lg mb-1">All set!</p>
        <p className="text-sm text-gray-500 dark:text-tm-dark-muted">Targets are saved for every site that needed them.</p>
        <button onClick={onDone} className="mt-4 px-5 py-2 rounded-lg bg-tm-teal text-tm-navy font-bold text-sm hover:brightness-110 transition-colors">
          Done
        </button>
      </div>
    )
  }

  const afterCount = remaining.length - 1
  const label = saving
    ? 'Saving…'
    : afterCount > 0
      ? `Save Target — ${afterCount} site${afterCount !== 1 ? 's' : ''} remaining`
      : 'Save Target'

  const handleSave = async () => {
    setSaving(true)
    await saveTarget(current, form)
    setSaving(false)
    setForm(emptyForm())
    setRemaining(r => r.slice(1))
  }

  return (
    <div className="space-y-4">
      <div className="bg-tm-sky/20 dark:bg-tm-teal/10 rounded-lg px-4 py-2.5 flex items-center justify-between">
        <span className="font-brand font-bold text-tm-blue dark:text-tm-teal">{current.location.name}</span>
        <span className="text-xs text-gray-500 dark:text-tm-dark-muted font-semibold">{monthLabel(current.month)}</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-semibold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide mb-1">Revenue Goal ($)</label>
          <input type="number" min="0" step="0.01" value={form.revenue_goal} onChange={e => setForm(f => ({ ...f, revenue_goal: e.target.value }))} className={inputCls} />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide mb-1">Membership Goal</label>
          <input type="number" min="0" value={form.membership_goal} onChange={e => setForm(f => ({ ...f, membership_goal: e.target.value }))} className={inputCls} />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide mb-1">Desired Rating</label>
          <input type="number" min="0" max="5" step="0.01" value={form.desired_rating} onChange={e => setForm(f => ({ ...f, desired_rating: e.target.value }))} className={inputCls} />
        </div>
        <div />
        <div>
          <label className="block text-xs font-semibold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide mb-1">Labor — Regular Hours</label>
          <input type="number" min="0" value={form.labor_hours_non_salary} onChange={e => setForm(f => ({ ...f, labor_hours_non_salary: e.target.value }))} className={inputCls} />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 dark:text-tm-dark-muted uppercase tracking-wide mb-1">Labor — With Salary</label>
          <input type="number" min="0" value={form.labor_hours_with_salary} onChange={e => setForm(f => ({ ...f, labor_hours_with_salary: e.target.value }))} className={inputCls} />
        </div>
      </div>

      <button onClick={handleSave} disabled={saving} className="w-full py-2.5 rounded-xl bg-tm-teal text-tm-navy font-bold text-sm hover:brightness-110 transition-colors disabled:opacity-50">
        {label}
      </button>
    </div>
  )
}

// ── Bulk mode: one table, every missing site at once ──────────────────────────

function BulkFlow({ items, onDone }) {
  const [forms, setForms] = useState(() => Object.fromEntries(items.map(it => [`${it.location.id}:${it.month}`, emptyForm()])))
  const [saving, setSaving] = useState(false)

  const set = (key, field, value) => setForms(f => ({ ...f, [key]: { ...f[key], [field]: value } }))

  const handleSaveAll = async () => {
    setSaving(true)
    await Promise.all(items.map(it => saveTarget(it, forms[`${it.location.id}:${it.month}`])))
    setSaving(false)
    onDone()
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-tm-dark-border">
        <table className="w-full text-xs font-brand border-collapse">
          <thead>
            <tr className="bg-tm-blue dark:bg-tm-navy text-white">
              <th className="px-3 py-2 text-left">Site</th>
              <th className="px-3 py-2 text-left">Month</th>
              <th className="px-2 py-2 text-center">Revenue Goal</th>
              <th className="px-2 py-2 text-center">Membership Goal</th>
              <th className="px-2 py-2 text-center">Rating</th>
              <th className="px-2 py-2 text-center">Labor (Reg)</th>
              <th className="px-2 py-2 text-center">Labor (Salary)</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => {
              const key = `${it.location.id}:${it.month}`
              const f = forms[key]
              return (
                <tr key={key} className={i % 2 === 0 ? 'bg-white dark:bg-tm-dark-surface' : 'bg-gray-50 dark:bg-tm-dark-card'}>
                  <td className="px-3 py-2 font-semibold text-tm-blue dark:text-tm-teal whitespace-nowrap">{it.location.name}</td>
                  <td className="px-3 py-2 text-gray-500 dark:text-tm-dark-muted whitespace-nowrap">{monthLabel(it.month)}</td>
                  <td className="px-2 py-2"><input type="number" min="0" step="0.01" value={f.revenue_goal} onChange={e => set(key, 'revenue_goal', e.target.value)} className={cellInputCls} /></td>
                  <td className="px-2 py-2"><input type="number" min="0" value={f.membership_goal} onChange={e => set(key, 'membership_goal', e.target.value)} className={cellInputCls} /></td>
                  <td className="px-2 py-2"><input type="number" min="0" max="5" step="0.01" value={f.desired_rating} onChange={e => set(key, 'desired_rating', e.target.value)} className={cellInputCls + ' w-16'} /></td>
                  <td className="px-2 py-2"><input type="number" min="0" value={f.labor_hours_non_salary} onChange={e => set(key, 'labor_hours_non_salary', e.target.value)} className={cellInputCls} /></td>
                  <td className="px-2 py-2"><input type="number" min="0" value={f.labor_hours_with_salary} onChange={e => set(key, 'labor_hours_with_salary', e.target.value)} className={cellInputCls} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <button onClick={handleSaveAll} disabled={saving} className="w-full py-2.5 rounded-xl bg-tm-teal text-tm-navy font-bold text-sm hover:brightness-110 transition-colors disabled:opacity-50">
        {saving ? 'Saving…' : `Save All (${items.length} site${items.length !== 1 ? 's' : ''})`}
      </button>
    </div>
  )
}

// ── Modal shell ───────────────────────────────────────────────────────────────

export default function SetTargetsModal({ missing, onClose }) {
  const [mode, setMode] = useState('sequential')

  return (
    <div className="fixed inset-0 z-[400] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-tm-dark-card rounded-2xl shadow-2xl z-10 w-full max-w-xl mx-4 max-h-[90vh] flex flex-col">
        <div className="bg-tm-navy dark:bg-tm-dark-nav text-white px-5 py-3.5 rounded-t-2xl flex items-center justify-between shrink-0">
          <div>
            <div className="font-brand font-bold text-sm">Set Budget Targets</div>
            <div className="text-tm-teal text-xs mt-0.5">{missing.length} site{missing.length !== 1 ? 's' : ''} need a target</div>
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white text-xl">×</button>
        </div>

        <div className="px-5 pt-3 shrink-0">
          <button
            onClick={() => setMode(m => m === 'sequential' ? 'bulk' : 'sequential')}
            className="text-xs text-tm-teal hover:text-tm-blue dark:hover:text-white font-semibold underline transition-colors"
          >
            {mode === 'sequential' ? `Enter all ${missing.length} sites in a table instead` : 'Switch to one-site-at-a-time'}
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-5">
          {mode === 'sequential'
            ? <SequentialFlow items={missing} onDone={onClose} />
            : <BulkFlow items={missing} onDone={onClose} />}
        </div>
      </div>
    </div>
  )
}
