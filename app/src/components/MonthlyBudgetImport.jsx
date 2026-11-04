import { useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { computeMembershipGoal } from '../utils/budgetMath'
import { displayMoney } from '../utils/budgetDisplay'

// One modal, one server endpoint. The workbook remains local to this browser.
export default function MonthlyBudgetImport({ onSaved, onClose }) {
  const [workbook, setWorkbook] = useState(null), [preview, setPreview] = useState(null)
  const [openings, setOpenings] = useState({}), [replace, setReplace] = useState({})
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const inFlight = useRef(false), generation = useRef(0)
  const load = async event => {
    const file = event.target.files?.[0], request = ++generation.current
    event.target.value = ''
    setWorkbook(null); setPreview(null); setConfirmed(false); setError(''); setReplace({})
    if (!file) return
    if (!/\.xlsx$/i.test(file.name) || file.size > 10_000_000) { setError('Select an .xlsx workbook up to 10 MB.'); return }
    setBusy(true)
    try {
      const { parseMonthlyBudget } = await import('../utils/monthlyBudgetWorkbook')
      const parsed = await parseMonthlyBudget(await file.arrayBuffer())
      const result = await supabase.rpc('import_monthly_budget', { p_month: parsed.month, p_sites: parsed.sites })
      if (result.error) throw result.error
      if (request !== generation.current) return
      setWorkbook(parsed); setPreview(result.data)
      setOpenings(Object.fromEntries(result.data.sites.map(s => [s.site, s.starting_members == null ? '' : String(s.starting_members)])))
    } catch (e) { if (request === generation.current) setError(e.message || 'Unable to preview workbook.') }
    finally { if (request === generation.current) setBusy(false) }
  }
  const valid = preview?.sites.every(s => openings[s.site] === '' || (/^\d+$/.test(openings[s.site]) && Number(openings[s.site]) <= 2147483647 && Number.isSafeInteger(computeMembershipGoal(Number(openings[s.site]), s.membership_daily_growth, workbook.month)) && computeMembershipGoal(Number(openings[s.site]), s.membership_daily_growth, workbook.month) <= 2147483647))
    && preview.sites.every(s => !replace[s.site] || openings[s.site] !== '')
  const proposal = () => workbook.sites.map(s => ({ ...s, opening_members: openings[s.site] === '' ? null : openings[s.site], replace_membership: !!replace[s.site] }))
  // Refresh the token for the final editable choices before enabling Confirm.
  // Never silently accept a database change while refreshing the proposal.
  const approve = async checked => {
    setConfirmed(false)
    if (!checked || !valid || busy) return
    const request = ++generation.current
    setBusy(true); setError('')
    try {
      const result = await supabase.rpc('import_monthly_budget', { p_month: workbook.month, p_sites: proposal() })
      if (result.error) throw result.error
      if (request !== generation.current) return
      if (!preview.state_fingerprint || result.data.state_fingerprint !== preview.state_fingerprint) throw new Error('Database state changed since preview; reopen the workbook.')
      setPreview(p => ({ ...p, fingerprint: result.data.fingerprint }))
      setConfirmed(true)
    } catch (e) { if (request === generation.current) { setError(e.message || 'Unable to review import choices.'); setPreview(null) } }
    finally { if (request === generation.current) setBusy(false) }
  }
  const save = async () => {
    if (inFlight.current || !preview || !valid || !confirmed) return
    inFlight.current = true; setBusy(true); setError('')
    try {
      const result = await supabase.rpc('import_monthly_budget', {
        p_month: workbook.month, p_confirm: true, p_expected: preview.fingerprint,
        p_sites: proposal(),
      })
      if (result.error) throw result.error
      onSaved(workbook.month, result.data)
    } catch (e) {
      setError((e.message || 'Import failed.') + ' No automatic retry. Reopen the workbook to refresh the preview before trying again.')
      setConfirmed(false); setPreview(null)
    } finally { inFlight.current = false; setBusy(false) }
  }
  const input = 'border rounded p-1 bg-white dark:bg-tm-dark-surface dark:border-tm-dark-border w-28'
  return <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50 p-4">
    <section role="dialog" aria-modal="true" aria-labelledby="monthly-budget-title" className="bg-white dark:bg-tm-dark-card text-gray-800 dark:text-gray-100 rounded-xl p-5 w-full max-w-6xl max-h-[90vh] overflow-auto space-y-4">
      <h2 id="monthly-budget-title" className="font-bold">Import Monthly Budget</h2>
      <p className="text-sm">Select the Finance workbook. Review the detected month, sites and changes before importing. Actual entries and other months are preserved.</p>
      <input aria-label="Monthly budget Excel workbook" type="file" accept=".xlsx" disabled={busy} onChange={load} />
      {busy && <p role="status">{inFlight.current ? 'Importing…' : 'Validating workbook…'}</p>}
      {error && <p role="alert" className="text-red-700 dark:text-red-300">{error}</p>}
      {preview && <>
        <p className="font-semibold">{workbook.month.slice(0,7)} · {preview.sites.length} sites · {workbook.sites.reduce((n,s)=>n+s.daily.length,0)} daily goals · Revenue {displayMoney(workbook.totals.total)}</p>
        <p className="text-sm">Retail {displayMoney(workbook.totals.retail)} · Recurring {displayMoney(workbook.totals.recurring)}. Preview amounts display rounded; exact workbook decimals are imported.</p>
        <p className="text-sm">Opening membership comes only from the entry dated {workbook.month} (previous month's closing count). Blank openings remain pending; revenue and labor can still import. Saved baselines are retained unless replacement is explicitly selected.</p>
        <div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead><tr>
          {['Site / action','Revenue: existing → proposed','Weekly labor: existing → proposed','First-day count','Opening / EOM membership'].map(t=><th key={t} className="p-2">{t}</th>)}
        </tr></thead><tbody>{preview.sites.map(s => {
          const approved = s.keep_membership, replacing = !!replace[s.site], baseline = openings[s.site]
          const eom = approved && !replacing ? s.existing.membership_goal : baseline === '' ? null : computeMembershipGoal(Number(baseline), s.membership_daily_growth, workbook.month)
          const hours = s.percentage != null ? `${Number(s.percentage)*100}% full service` : `${s.hours} / ${s.hours_with_manager} hours including manager`
          const oldLabor = !s.existing ? '—' : s.existing.full_service_labor_percentage != null ? `${Number(s.existing.full_service_labor_percentage)*100}%` : `${s.existing.labor_hours_non_salary} / ${s.existing.labor_hours_with_salary} hours`
          return <tr key={s.site} className="border-t dark:border-tm-dark-border">
            <td className="p-2">{s.site}<br/>{s.existing ? 'Review replacement' : 'New target'}</td>
            <td className="p-2" title={`Exact proposed revenue: ${s.revenue_goal}`}>{displayMoney(s.existing?.revenue_goal)} → {displayMoney(s.revenue_goal)}</td>
            <td className="p-2">{oldLabor} → {hours}</td>
            <td className="p-2">{s.source_members ?? 'Missing — Admin input needed'}{approved && s.source_members !== s.existing.starting_members && <p className="text-amber-800 dark:text-amber-300">Historical count differs; saved baseline retained.</p>}</td>
            <td className="p-2">
              <label>Opening {s.site} <input aria-label={`Opening members ${s.site}`} className={input} type="number" min="0" step="1" value={baseline} disabled={busy || (approved && !replacing)} onChange={e=>{setOpenings(o=>({...o,[s.site]:e.target.value}));setConfirmed(false)}} /></label>
              <p>Daily growth {s.membership_daily_growth} · EOM {eom ?? 'Membership baseline pending'}</p>
              {s.existing && <p>Saved opening {s.existing.starting_members ?? 'pending'} · EOM {s.existing.membership_goal ?? 'pending'}</p>}
              {approved && <label><input type="checkbox" disabled={busy} checked={replacing} onChange={e=>{setReplace(r=>({...r,[s.site]:e.target.checked}));setOpenings(o=>({...o,[s.site]:s.existing.starting_members == null ? '' : String(s.existing.starting_members)}));setConfirmed(false)}} /> Explicitly replace approved membership</label>}
            </td>
          </tr>
        })}</tbody></table></div>
        {!valid && <p role="alert">Enter valid whole membership counts, or leave unverified openings blank. Approved baselines cannot be cleared.</p>}
        <label className="block"><input type="checkbox" disabled={busy || !valid} checked={confirmed} onChange={e=>approve(e.target.checked)} /> I approve the displayed month, sites, revenue/labor replacements and membership choices.</label>
        <button disabled={busy || !valid || !confirmed} onClick={save} className="px-4 py-2 rounded bg-tm-teal text-tm-navy font-bold disabled:opacity-50">Confirm Import</button>
      </>}
      <button disabled={busy} className="ml-3 px-4 py-2 border rounded disabled:opacity-50" onClick={()=>{generation.current++;onClose()}}>Cancel</button>
    </section>
  </div>
}
