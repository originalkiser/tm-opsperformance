import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import NavBar from '../components/NavBar'
import { useDisplayAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { laborBudget } from '../utils/laborBudget'
import { DEFAULT_TIMEZONE, getEffectiveSchedule } from '../utils/operatingHours'
import {
  addDays, analyzePlan, breakLength, clock, days, defaults, leaders, minutes,
  recommendPlan, siteToday, summarizeTraffic, sunday,
} from '../utils/laborPlanner'
import './weeklyLaborPlanner.css'

const control = 'rounded-md border border-gray-300 bg-white px-2 py-2 text-sm dark:border-tm-dark-border dark:bg-tm-dark-card'
const button = control + ' font-semibold hover:border-tm-teal disabled:opacity-50'
const panel = 'rounded-xl border border-gray-200 bg-white p-4 dark:border-tm-dark-border dark:bg-tm-dark-surface'
const hoursText = value => (value / 60).toFixed(2) + ' h'
const person = (shift, roster) => roster.find(e => e.id === shift.employeeId)?.name || 'Unassigned'
const elapsed = (used, target) => target == null ? 'No hours target' : target + ' h target · ' + (used / 60 - target).toFixed(2) + ' h variance'
const payload = (id, week) => ({ p_location: id, p_week: week })

async function read(result) {
  const { data, error } = await result
  if (error) throw error
  return data
}

async function paged(readPage) {
  const rows = []
  const size = 250
  for (let offset = 0; ; offset += size) {
    const page = await read(readPage().range(offset, offset + size - 1))
    rows.push(...page)
    if (page.length < size) return rows
  }
}

async function loadPlanner(location, week) {
  const data = await read(supabase.rpc('weekly_labor_planner', payload(location.id, week)))
  const timezone = data.location.timezone || DEFAULT_TIMEZONE
  const latestCompleted = sunday(siteToday(timezone))
  const trafficEnd = week < latestCompleted ? week : latestCompleted
  const [roster, trafficRows] = await Promise.all([
    paged(() => supabase.from('employees').select('id,name').eq('location_id', location.id).eq('is_active', true).order('name').order('id')),
    paged(() => supabase.from('daily_logs').select('log_date,time_slot,split_index,total_washes')
      .eq('location_id', location.id).gte('log_date', addDays(trafficEnd, -28)).lt('log_date', trafficEnd)
      .order('log_date').order('time_slot').order('split_index').order('id')),
  ])
  const target = laborBudget(data.target)
  const inputs = {
    timezone,
    season: data.network?.active === 'winter' ? 'winter' : 'standard',
    hours: getEffectiveSchedule(data.network, data.location),
    budget: {
      method: target.method,
      hourly: target.hours == null ? null : Number(target.hours),
      combined: target.method === 'percentage' ? (data.cap == null ? null : Number(data.cap)) : target.hoursWithManager == null ? null : Number(target.hoursWithManager),
      percentage: target.percentage,
    },
    settings: defaults,
    traffic: summarizeTraffic(trafficRows, trafficEnd),
    trafficEnd,
  }
  return { roster, inputs, draft: data.draft }
}

export default function WeeklyLaborPlanner() {
  const { locations = [], profile, managerPreview } = useDisplayAuth()
  const [params, setParams] = useSearchParams()
  const dirty = useRef(false)
  const pending = useRef(false)
  const location = locations.find(l => l.id === params.get('site')) || locations[0]
  const requestedWeek = params.get('week')
  const week = /^\d{4}-\d{2}-\d{2}$/.test(requestedWeek || '') && Number.isFinite(Date.parse(requestedWeek))
    ? sunday(requestedWeek) : sunday(addDays(siteToday(location?.timezone || DEFAULT_TIMEZONE), 7))
  const allowed = profile?.is_active === true && !profile?.deleted_at && ['admin', 'store'].includes(profile.role)

  function select(site, date) {
    if (pending.current) return
    if (dirty.current && !window.confirm('Leave this week and discard unsaved changes?')) return
    dirty.current = false
    setParams({ site, week: date })
  }

  useEffect(() => {
    const warn = event => { if (dirty.current) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])

  return <div className="min-h-screen bg-tm-cream text-gray-900 dark:bg-tm-dark-bg dark:text-tm-dark-text">
    <div className="labor-no-print"><NavBar /></div>
    <main className="mx-auto max-w-screen-2xl space-y-4 p-4 sm:p-6">
      <header className="labor-no-print">
        <h1 className="font-brand text-2xl font-bold">Weekly Labor Planner</h1>
        <p className="mt-1 text-sm">Plan coverage, assign your team, and print a weekly draft.</p>
      </header>
      {allowed && location ? <>
        <div className={panel + ' labor-no-print flex flex-wrap gap-4'}>
          <label className="grid gap-1 text-sm font-medium">Location
            <select className={control} value={location.id} onChange={e => select(e.target.value, week)}>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-medium">Week of Sunday
            <input type="date" className={control} value={week} onChange={e => { if (e.target.value) select(location.id, sunday(e.target.value)) }} />
          </label>
        </div>
        <PlannerWeek key={location.id + ':' + week} location={location} week={week} dirty={dirty} pending={pending}
          preview={managerPreview} admin={profile.role === 'admin'} />
      </> : <p role="alert">An active Store or Admin account with a location is required.</p>}
    </main>
  </div>
}

function PlannerWeek({ location, week, preview, admin, dirty, pending }) {
  const [source, setSource] = useState(null)
  const [plan, setPlan] = useState(null)
  const [revision, setRevision] = useState(0)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [cap, setCap] = useState('')
  const [coverageDay, setCoverageDay] = useState(0)
  const [loadVersion, setLoadVersion] = useState(0)
  useEffect(() => {
    let mounted = true
    loadPlanner(location, week).then(data => {
      if (!mounted) return
      setSource(data)
      setPlan(data.draft?.plan || { shifts: [], inputs: data.inputs })
      setRevision(data.draft?.revision || 0)
      setCap(data.inputs.budget.combined ?? '')
    }).catch(e => { if (mounted) setError(e.message) })
    return () => { mounted = false }
  }, [location, week, loadVersion])
  const analysis = useMemo(() => plan && analyzePlan(plan.shifts, plan.inputs, source.roster), [plan, source])
  function edit(change) {
    dirty.current = true
    setMessage('')
    setPlan(change)
  }
  async function perform(action) {
    if (pending.current || preview) return
    pending.current = true
    setBusy(true); setError(''); setMessage('')
    try { await action() }
    catch (e) { setError(e.message) }
    finally { pending.current = false; setBusy(false) }
  }
  function reload() {
    if (dirty.current && !window.confirm('Reload and discard unsaved changes?')) return
    dirty.current = false
    setSource(null); setPlan(null); setError(''); setMessage('')
    setLoadVersion(version => version + 1)
  }
  if (!plan) return <div className={panel}>{error ? <><p role="alert">{error}</p><button className={button} onClick={reload}>Retry</button></> : <p role="status">Loading planner inputs…</p>}</div>
  const { inputs, shifts } = plan
  const { settings, budget } = inputs
  const latestCap = source.inputs.budget.method === 'percentage' ? source.inputs.budget.combined : null
  const canGenerate = budget.combined != null && (budget.method === 'percentage' || budget.hourly != null)
  const cwaCount = Math.max(1, source.roster.length - leaders.length)
  const roles = [...new Set([...leaders, ...Array.from({ length: cwaCount }, (_, i) => 'CWA ' + (i + 1)), ...shifts.map(s => s.role)])]
  const changeShift = (index, patch) => edit(previous => ({ ...previous, shifts: previous.shifts.map((s, i) => i === index ? { ...s, ...patch } : s) }))
  const changeSetting = (key, value) => edit(previous => ({ ...previous, inputs: { ...previous.inputs, settings: { ...previous.inputs.settings, [key]: value } } }))
  const save = () => perform(async () => {
    const saved = await read(supabase.rpc('save_weekly_labor_plan', { ...payload(location.id, week), p_revision: revision, p_plan: plan }))
    setRevision(saved)
    dirty.current = false
    setMessage('Draft saved.')
  })
  const changeSettingCap = combined => edit(previous => ({
    ...previous, inputs: { ...previous.inputs, budget: { ...previous.inputs.budget, combined } },
  }))
  const approveCap = event => {
    event.preventDefault()
    perform(async () => {
      const approved = await read(supabase.rpc('approve_weekly_labor_cap', { ...payload(location.id, week), p_hours: Number(cap) }))
      setSource(previous => ({ ...previous, inputs: { ...previous.inputs, budget: { ...previous.inputs.budget, combined: Number(approved) } } }))
      if (budget.method === 'percentage' && budget.percentage === source.inputs.budget.percentage) {
        changeSettingCap(Number(approved))
        setMessage('Weekly cap approved. Save the draft to preserve the new cap with this schedule.')
      } else {
        setMessage('Weekly cap approved. This draft retains its original budget inputs.')
      }
    })
  }
  return <>
    <div className="labor-no-print space-y-4">
      <section className={panel + ' space-y-3'}>
        <h2 className="font-brand text-lg font-bold">Labor and operating hours</h2>
        <p className="text-sm">{inputs.season === 'winter' ? 'Winter' : 'Standard'} · {inputs.timezone} · Mon–Sat {inputs.hours.monSat.open}–{inputs.hours.monSat.close} · Sun {inputs.hours.sun.open}–{inputs.hours.sun.close}{revision ? ' · Saved draft inputs' : ''}</p>
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div><dt>GM scheduled</dt><dd className="text-xl font-bold">{hoursText(analysis.gmMinutes)}</dd></div>
          <div><dt>Hourly paid, excluding GM</dt><dd className="text-xl font-bold">{hoursText(analysis.hourly)}</dd><dd>{elapsed(analysis.hourly, budget.hourly)}</dd></div>
          <div><dt>Combined, including GM</dt><dd className="text-xl font-bold">{hoursText(analysis.combined)}</dd><dd>{elapsed(analysis.combined, budget.combined)}</dd></div>
        </dl>
        {budget.method === 'percentage' && <p className="text-sm">Full-service labor target: {budget.percentage * 100}%</p>}
        {!preview && budget.method === 'percentage' && budget.percentage === source.inputs.budget.percentage && latestCap != null && latestCap !== budget.combined &&
          <button className={button} disabled={busy} onClick={() => changeSettingCap(latestCap)}>Use current approved cap ({latestCap} h)</button>}
        {admin && !preview && source.inputs.budget.method === 'percentage' && <form className="flex flex-wrap items-end gap-2" onSubmit={approveCap}>
          <label className="grid gap-1 text-sm">Approved weekly hours cap including GM
            <input type="number" className={control} min="0.25" max="2000" step="0.25" required value={cap} onChange={e => setCap(e.target.value)} disabled={busy} />
          </label>
          <button className={button} disabled={busy}>Approve cap</button>
        </form>}
        <fieldset className="flex flex-wrap gap-3" disabled={preview || busy}>
          <legend className="mb-2 font-semibold">Staffing settings</legend>
          <label className="grid gap-1 text-sm">Opening prep (minutes)<input type="number" min="0" max="120" className={control} value={settings.prep} onChange={e => changeSetting('prep', Math.max(0, Math.min(120, Number(e.target.value))))} /></label>
          <label className="grid gap-1 text-sm">Midday starts<input type="time" className={control} value={clock(settings.middayStart)} onChange={e => { if (e.target.value) changeSetting('middayStart', minutes(e.target.value)) }} /></label>
          <label className="grid gap-1 text-sm">Midday ends<input type="time" className={control} value={clock(settings.middayEnd)} onChange={e => { if (e.target.value) changeSetting('middayEnd', minutes(e.target.value)) }} /></label>
          <label className="grid gap-1 text-sm">Washes/hour for four staff<input type="number" min="1" max="1000" className={control} value={settings.peak} onChange={e => changeSetting('peak', Math.max(1, Math.min(1000, Number(e.target.value))))} /></label>
          <label className="grid gap-1 text-sm">Additional washes/hour per extra employee
            <input type="number" min="1" max="1000" step="1" className={control} value={settings.peakStep ?? ''}
              placeholder="Four-person rule" onChange={e => changeSetting('peakStep', e.target.value === '' ? null : Math.max(1, Math.min(1000, Math.trunc(Number(e.target.value)))))} />
          </label>
        </fieldset>
        <div className="flex flex-wrap gap-2">
          {!preview && <>
            <button className={button} disabled={busy || !canGenerate || settings.middayStart >= settings.middayEnd} onClick={() => {
              if (!shifts.length || window.confirm('Replace current shifts and assignments with a new recommendation?')) {
                const recommendation = recommendPlan(inputs, source.roster.length)
                edit(previous => ({ ...previous, shifts: recommendation }))
              }
            }}>Generate schedule</button>
            <button className={button} disabled={busy} onClick={save}>Save draft</button>
          </>}
          <button className={button} disabled={busy} onClick={reload}>Reload draft</button>
          <button className={button} onClick={() => window.print()}>Print schedule</button>
        </div>
        {preview && <p>Manager View is read-only.</p>}
        {error && <p role="alert" className="text-red-700 dark:text-red-300">{error}</p>}
        {message && <p role="status">{message}</p>}
      </section>
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {days.map((day, dayIndex) => <section key={day} className={panel + ' space-y-3'}>
          <h2 className="font-brand font-bold">{day} · {addDays(week, dayIndex)}</h2>
          {shifts.map((shift, index) => shift.day === dayIndex && <fieldset key={index} disabled={preview || busy} className="grid grid-cols-2 gap-2 rounded-lg border border-gray-200 p-2 dark:border-tm-dark-border">
            <legend className="px-1 text-sm font-semibold">{shift.role}</legend>
            <label className="col-span-2 grid gap-1 text-sm">Position
              <select className={control} value={shift.role} onChange={e => changeShift(index, { role: e.target.value })}>
                {roles.map(role => <option key={role}>{role}</option>)}
              </select>
            </label>
            <label className="col-span-2 grid min-w-0 gap-1 text-sm">Employee
              <select className={control} value={shift.employeeId} onChange={e => changeShift(index, { employeeId: e.target.value })}>
                <option value="">Unassigned</option>
                {shift.employeeId && !source.roster.some(e => e.id === shift.employeeId) && <option value={shift.employeeId}>Inactive or unavailable</option>}
                {source.roster.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </label>
            {['start', 'end', ...(shift.role === 'GM' ? (dayIndex === 1 ? ['adminStart'] : []) : ['breakStart'])].map(key =>
              <label key={key} className="grid min-w-0 gap-1 text-sm">{key === 'adminStart' ? 'Admin starts' : key === 'breakStart' ? 'Break starts' : key === 'start' ? 'Start' : 'End'}
                <input type="time" className={control + ' min-w-0'} value={key === 'end' && shift.end === 1440 ? '00:00' : clock(shift[key])}
                  onChange={e => changeShift(index, { [key]: key === 'end' && e.target.value === '00:00' ? 1440 : minutes(e.target.value) })} />
              </label>)}
            {shift.role !== 'GM' && <p className="self-center text-xs">{breakLength(shift)} min {breakLength(shift) === 30 ? 'unpaid' : 'paid'}</p>}
            {!preview && <button className={button + ' col-span-2'} onClick={() => edit(previous => ({ ...previous, shifts: previous.shifts.filter((_, i) => i !== index) }))}>Remove shift</button>}
          </fieldset>)}
          {!preview && <button className={button} disabled={busy} onClick={() => edit(previous => ({
            ...previous, shifts: [...previous.shifts, { day: dayIndex, role: 'CWA 1', employeeId: '', start: 480, end: 840, breakStart: 720, adminStart: null }],
          }))}>Add shift</button>}
        </section>)}
      </div>
      <section className={panel + ' space-y-3'}>
        <h2 className="font-brand text-lg font-bold">Coverage and traffic</h2>
        <label className="flex flex-wrap items-center gap-2 text-sm">Day
          <select className={control} value={coverageDay} onChange={e => setCoverageDay(Number(e.target.value))}>{days.map((day, index) => <option key={day} value={index}>{day}</option>)}</select>
        </label>
        <p className="text-sm">History {addDays(inputs.trafficEnd, -28)} through {addDays(inputs.trafficEnd, -1)}. Floor counts exclude breaks and GM admin time.</p>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm">
          <thead><tr>{['Hour', 'Min. on floor', 'Required', 'Suggested', 'Avg. washes (samples)'].map(label => <th scope="col" key={label} className="p-2">{label}</th>)}</tr></thead>
          <tbody>{analysis.coverage.filter(row => row.day === coverageDay).map(row => <tr key={row.hour} className="border-t border-gray-200 dark:border-tm-dark-border">
            <th scope="row" className="p-2">{clock(row.hour)}</th><td className="p-2">{row.minimum}{row.gap ? ' · Gap' : ''}</td><td className="p-2">{row.required}</td><td className="p-2">{row.recommended}</td><td className="p-2">{row.traffic ? row.traffic.average.toFixed(1) + ' (' + row.traffic.samples + ')' : '— (0)'}</td>
          </tr>)}</tbody>
        </table></div>
      </section>
      <Warnings analysis={analysis} middayValid={settings.middayStart < settings.middayEnd} />
    </div>
    <section className="labor-print">
      <h1>{location.name} · Weekly employee schedule</h1>
      <p>Draft · {week} through {addDays(week, 6)} · {inputs.timezone}</p>
      <p>GM {hoursText(analysis.gmMinutes)} · Hourly {hoursText(analysis.hourly)} · Combined {hoursText(analysis.combined)}</p>
      <table>
        <thead><tr>{['Day', 'Position', 'Employee', 'Shift', 'Break / admin'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{days.flatMap((day, index) => {
          const rows = shifts.filter(s => s.day === index).sort((a, b) => a.start - b.start)
          return rows.length ? rows.map((s, i) => <tr key={index + ':' + i}>
            <th scope="row">{day}</th><td>{s.role}</td><td>{person(s, source.roster)}</td><td>{clock(s.start)}–{clock(s.end)}</td>
            <td>{s.role === 'GM' ? (s.day === 1 && s.adminStart != null ? clock(s.adminStart) + ' · 3.5 h admin' : '—') : s.breakStart == null ? '—' : clock(s.breakStart) + ' · ' + breakLength(s) + ' min ' + (breakLength(s) === 30 ? 'unpaid' : 'paid')}</td>
          </tr>) : <tr key={day}><th scope="row">{day}</th><td colSpan="4">No shifts</td></tr>
        })}</tbody>
      </table>
      <Warnings analysis={analysis} middayValid={settings.middayStart < settings.middayEnd} />
    </section>
  </>
}

function Warnings({ analysis, middayValid }) {
  const warnings = middayValid ? analysis.warnings : ['Midday must end after it starts.', ...analysis.warnings]
  return <section className={panel}>
    <h2 className="font-brand text-lg font-bold">Draft warnings</h2>
    {warnings.length ? <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{warnings.map(warning => <li key={warning}>{warning}</li>)}</ul> : <p className="text-sm">No warnings for the current draft.</p>}
  </section>
}
