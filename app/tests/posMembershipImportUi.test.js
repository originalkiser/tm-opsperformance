import test from 'node:test'
import assert from 'node:assert/strict'
import { locationHelpHarness } from './helpers/locationHelpHarness.js'
import { membershipTotals } from '../src/utils/posMembership.js'

const textOf = node => typeof node === 'string' ? node : Array.isArray(node)
  ? node.map(textOf).join('') : node?.props ? textOf(node.props.children) : ''
const base = {system:'Micrologic',start:'2026-11-27',end:'2026-11-27',events:[],snapshots:[]}
const saved = [{system:'DRB',site_code:'1508',business_date:'2026-11-01',ticket:'saved',attribution:'unmatched'}]

async function preview(parsed, review) {
  const calls=[]
  const h=locationHelpHarness('components/PosMembershipImport',{
    useAuth:()=>({locations:[]}), toDateStr:()=>base.start, supabase:{}, membershipTotals, readStoredPos:async()=>[],
    parseMembershipFile:async()=>parsed,
    membershipRpc:async(_client,name,{p_action})=>{
      calls.push([name,p_action]); return p_action==='queue'?saved:review
    },
  })
  h.find(n=>n.type==='input'&&n.props.type==='file').props.onChange({target:{files:[{}]}})
  h.find(n=>n.type==='form').props.onSubmit({preventDefault(){}})
  await h.flush()
  return {h,calls}
}
const lists = h => h.all(n=>n.type?.name==='UnresolvedMappings').map(n=>n.props.rows)

test('workbook preview shows only its unresolved transactions and loads the global queue separately',async()=>{
  const transaction={site:'1512',date:'2026-11-27',ticket:'current',attribution:'unmatched'}
  const matched={...transaction,ticket:'matched',attribution:'matched'}
  const {h,calls}=await preview({...base,events:[transaction,matched]}, {rows:[transaction,matched],snapshots:[]})
  assert.deepEqual(lists(h).map(rows=>rows.map(r=>r.ticket)),[['current']])
  assert.match(textOf(h.render()),/Micrologic · 1512 · 2026-11-27 through 2026-11-27/)
  assert.deepEqual(calls,[['import','preview']])
  h.find(n=>n.type==='button'&&textOf(n)==='Load all unresolved mappings').props.onClick()
  await h.flush()
  assert.deepEqual(lists(h).map(rows=>rows.map(r=>r.ticket)),[['current'],['saved']])
  h.find(n=>n.type==='input'&&n.props.type==='file').props.onChange({target:{files:[]}})
  assert.deepEqual(lists(h),[saved])
  h.unmount()
})

test('commission scope reports eligible signups lacking identity separately from excluded products',async()=>{
  const {h}=await preview({...base,commissions:{site:'1512',details:[]}}, {users:[
    {username:'pending',eligible:5,credited:2}, {username:'matched',eligible:2,credited:2},
    {username:'kiosk',eligible:0,credited:0},
  ]})
  assert.deepEqual(lists(h)[0].map(r=>[r.greeter,r.quantity,r.site_code]),[['pending',3,'1512']])
  h.unmount()
})

test('comparison-only workbooks explain why they cannot be imported',async()=>{
  const {h,calls}=await preview({...base,comparison:{quantity:20,reason:'The workbook lacks product detail.'}})
  assert.match(textOf(h.render()),/Comparison only.*lacks product detail.*Summary w\. Details/s)
  assert.deepEqual(lists(h),[])
  assert.deepEqual(calls,[])
  h.unmount()
})
