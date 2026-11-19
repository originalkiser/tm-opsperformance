// Actual React entry/correction/editor components; fictional data, isolated headless browser.
import assert from 'node:assert/strict'
import { budgetLabelFields } from '../../app/src/utils/budgetLabels.js'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE)
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const errors = []
async function open(mode = 'super') {
  const p = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  p.on('pageerror', e => { errors.push(e.message); console.error(e.message) })
  await p.addInitScript(({ mode, catalog }) => {
    window.mode = mode; window.calls = []; window.fixedNow = '2026-11-19T15:00Z'; window.conflict = false
    const OldDate = Date
    window.Date = class extends OldDate { constructor(...args) { super(...(args.length ? args : [window.fixedNow])) } static now() { return new OldDate(window.fixedNow).getTime() } }
    window.site = { id: 'fictional-site', site_code: '1000-Fictional', name: 'Fictional site', timezone: 'America/Chicago', opportunities_formula: 'detailed' }
    window.profile = { id: 'fictional', role: mode === 'store' ? 'store' : 'admin', is_active: true, location_id: window.site.id }
    window.items = catalog.map(({ id, label, helper }) => ({ id, label, helper, default_label: label, default_helper: helper, revision: 0 }))
    window.labelHistory = []
    window.fakeRpc = async (name, args) => {
      window.calls.push({ name, args })
      if (name === 'configuration_capabilities') return { data: { can_edit_templates: mode === 'super' } }
      if (name === 'checklist_weekly_periods') return { data: [{ period_date: '2026-11-16', period_end: '2026-11-22', previous: false, checklists: {}, weekly_timing: null }] }
      if (name === 'budget_tracker_labels') return { data: window.items.map(({ id, label, helper }) => ({ id, label, helper })) }
      if (name !== 'budget_tracker_label_editor') throw Error('Unexpected RPC ' + name)
      if (mode !== 'super') return { error: { code: '42501', message: 'Super Admin required' } }
      const item = window.items.find(i => i.id === args.p_key)
      if (args.p_action !== 'read') {
        if (window.conflict || args.p_revision !== item.revision) return { error: { code: 'PT409' } }
        const label = args.p_action === 'restore' ? item.default_label : args.p_label.trim(), helper = args.p_action === 'restore' ? item.default_helper : args.p_helper.trim()
        window.labelHistory.unshift({ field_id: item.id, revision: item.revision + 1, actor_name: 'Fictional Super Admin', changed_at: window.fixedNow, action: args.p_action, previous_label: item.label, previous_helper: item.helper, new_label: label, new_helper: helper })
        item.label = label; item.helper = helper; item.revision++
      }
      return { data: { items: structuredClone(window.items), history: structuredClone(window.labelHistory.filter(h => h.field_id === args.p_key).map(({field_id,...h}) => h)) } }
    }
  }, { mode, catalog: budgetLabelFields })
  await p.route('**/*', async route => {
    const u = new URL(route.request().url()); if (u.hostname !== '127.0.0.1') return route.abort()
    if (u.pathname.endsWith('/src/contexts/AuthContext.jsx')) return route.fulfill({ contentType: 'application/javascript', body: `export const useAuth=()=>({user:{id:'fictional'},profile:window.profile,locations:[window.site],managerPreview:false});export const useDisplayAuth=useAuth;` })
    if (u.pathname.endsWith('/src/lib/supabase.js')) return route.fulfill({ contentType: 'application/javascript', body: `export const supabasePublicKey='fictional';export const supabase={rpc:window.fakeRpc,from:()=>{const q={select:()=>q,in:()=>q,gte:()=>q,lte:()=>q,eq:()=>q,order:()=>q,then:f=>Promise.resolve({data:[]}).then(f)};return q}};` })
    if (u.pathname.endsWith('/src/hooks/useBudgetDailyEntry.js')) return route.fulfill({ contentType: 'application/javascript', body: `import React from '/tm-opsperformance/node_modules/.vite/deps/react.js';const {useState}=React;import {emptyDailyForm} from '/tm-opsperformance/src/utils/budgetDailyFields.js';export default function useBudgetDailyEntry(){const [form,setForm]=useState({...emptyDailyForm(),yesterday_washes:'100',yesterday_redemptions:'60',yesterday_basic:'6',yesterday_cc_revenue:'12'});return {form,set:(k,v)=>setForm(f=>({...f,[k]:v})),entry:null,target:{revenue_goal:1000,membership_goal:100,starting_members:50,membership_daily_growth:2},dailyGoals:[],loading:false,saving:false,attemptedSave:false,error:null,revenueError:null,mtdRevenue:{},historicalRevenue:null,handleSave:()=>{throw Error('No numeric saves permitted')}}}` })
    if (u.pathname.endsWith('/src/utils/budgetRevenueReporting.js')) return route.fulfill({ contentType: 'application/javascript', body: 'export const reportedRevenuePace=()=>({pct:0,onTrack:true,reported:{provisional:false}})' })
    if (['NavBar.jsx', 'CashReconciliationSection.jsx', 'BudgetRevenueSummary.jsx', 'ChecklistQrAdmin.jsx', 'ChecklistOpenWork.jsx'].some(file => u.pathname.endsWith('/src/components/' + file))) return route.fulfill({ contentType: 'application/javascript', body: 'export default function Placeholder(){return null}' })
    if (u.pathname.endsWith('/src/components/BudgetTrackingReport.jsx')) { const response = await route.fetch(); return route.fulfill({ response, body: (await response.text()) + '\nexport { DailyEntryPane };' }) }
    return route.continue()
  })
  await p.goto('http://127.0.0.1:5191/tm-opsperformance/tests/browser/budget-labels.html')
  try { await p.getByRole('region', { name: 'Site Entry fixture' }).getByLabel('Yesterday Washes', { exact: true }).waitFor({timeout:5000}) } catch(e) { console.log(await p.locator('body').innerText()); throw e }
  return p
}
try {
  const p = await open()
  await p.getByRole('button', { name: 'Manage checklist configuration', exact: true }).click()
  const editor = p.getByRole('region', { name: 'Super Admin Budget Tracker Labels' })
  await editor.getByText('Budget Tracker Labels', { exact: true }).click()
  try { await editor.getByLabel('Replacement label', { exact: true }).waitFor({timeout:5000}) } catch(e) { console.log(await editor.innerText()); console.log(await p.evaluate(()=>window.calls)); throw e }
  assert.equal(await editor.getByLabel('Budget Tracker label field').locator('option').count(), 21)
  await editor.getByLabel('Replacement label', { exact: true }).fill('Prior-day wash count')
  await editor.getByLabel('Helper / instructional text', { exact: true }).fill('Use the official daily total.')
  assert.equal(await editor.getByRole('heading', { name: 'Preview', exact: true }).count(), 1)
  await editor.getByRole('button', { name: 'Save wording', exact: true }).click()
  await editor.getByText('Wording saved.', { exact: true }).waitFor()
  for (const region of ['Site Entry fixture', 'Admin correction fixture']) {
    const entry = p.getByRole('region', { name: region })
    await entry.getByLabel('Prior-day wash count', { exact: true }).waitFor()
    assert.equal(await entry.getByLabel('Prior-day wash count', { exact: true }).inputValue(), '100')
    assert.equal(await entry.getByText('Use the official daily total.', { exact: true }).count(), 1)
    assert.equal(await entry.getByLabel('Yesterday Wash Overrides', { exact: true }).getAttribute('type'), 'number')
  }
  await editor.getByText('Change history · latest 50', { exact: true }).click()
  assert.match(await editor.innerText(), /Fictional Super Admin/)
  assert.match(await editor.innerText(), /Previous: Yesterday Washes/)
  await editor.getByRole('button', { name: 'Restore original wording', exact: true }).click()
  await editor.getByText('Original wording restored.', { exact: true }).waitFor()
  try { await p.getByRole('region', { name: 'Site Entry fixture' }).getByLabel('Yesterday Washes', { exact: true }).waitFor({timeout:5000}) } catch(e) { console.log(await p.locator('body').innerText()); throw e }
  await editor.getByLabel('Budget Tracker label field').selectOption('yesterday-cc-revenue')
  await editor.getByLabel('Replacement label', { exact: true }).fill('Card takings')
  await editor.getByRole('button', { name: 'Save wording', exact: true }).click()
  for (const region of ['Site Entry fixture', 'Admin correction fixture']) {
    const input = p.getByRole('region', { name: region }).getByLabel('Card takings', { exact: true })
    await input.waitFor(); assert.equal(await input.getAttribute('type'), 'text')
    await input.fill('12+8'); await input.press('Enter'); assert.equal(await input.inputValue(), '20.00')
  }
  await p.evaluate(() => { window.conflict = true })
  await editor.getByLabel('Replacement label', { exact: true }).fill('My unsaved label')
  await editor.getByRole('button', { name: 'Save wording', exact: true }).click()
  await editor.getByRole('alert').waitFor()
  assert.equal(await editor.getByLabel('Replacement label', { exact: true }).inputValue(), 'My unsaved label')
  for (const width of [1280, 390]) {
    await p.setViewportSize({ width, height: width === 390 ? 844 : 900 })
    for (const dark of [false, true]) {
      await p.evaluate(dark => document.documentElement.classList.toggle('dark', dark), dark)
      assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      await editor.screenshot({ path: `/tmp/tm-budget-label-${width}-${dark ? 'dark' : 'light'}.png` })
    }
  }
  await p.close()
  for (const mode of ['admin', 'store']) {
    const page = await open(mode)
    if (mode === 'admin') await page.getByRole('button', { name: 'Manage checklist configuration', exact: true }).click()
    assert.equal(await page.getByRole('region', { name: 'Super Admin Budget Tracker Labels' }).count(), 0)
    assert.equal(await page.evaluate(() => window.calls.filter(c => c.name === 'budget_tracker_label_editor').length), 0)
    await page.close()
  }
  assert.deepEqual(errors, [])
  console.log('PASS: Super-only editor, 21 fixed fields, save/restore/history/conflict, consistent Site Entry and Admin corrections, unchanged numeric values and calculator, desktop/mobile light/dark; no hosted traffic.')
} finally { await browser.close() }
