import test from 'node:test'
import assert from 'node:assert/strict'
import { takeGuestAccess, clearGuestAccess, checklistGuestUrl, createChecklistTransport } from '../src/utils/checklistAccess.js'
import { locationHelpHarness } from './helpers/locationHelpHarness.js'
import { checklistTemplates } from '../src/utils/checklistTemplates.js'
import { weeklyPmTemplate } from '../src/utils/weeklyPmTemplate.js'
import { checklistPeriod, localChecklistDate } from '../src/utils/checklistRules.js'
const token = 'a'.repeat(64)
function browser(hash = `#/guest-checklists?token=${token}`) {
  const values = new Map(), location = { hash, pathname: '/tm-opsperformance/', search: '', href: `https://example.invalid/tm-opsperformance/${hash}` }, replacements = []
  const storage = { getItem: key => values.get(key) || null, setItem: (key,value) => values.set(key,value), removeItem:key=>values.delete(key) }
  const history = { state: { idx: 2 }, replaceState(state,title,url) { replacements.push(url); location.hash = url.slice(url.indexOf('#')) } }
  return { location, history, storage, values, replacements }
}
test('QR fragment is removed immediately, credential stays tab-local and both host base paths work', () => {
  const b=browser();const access=takeGuestAccess(b.location,b.history,b.storage,()=> 'safe-recovery-id')
  assert.equal(access.token,token);assert.equal(access.recoveryKey,'safe-recovery-id')
  assert.deepEqual(b.replacements,['/tm-opsperformance/#/guest-checklists'])
  assert.deepEqual(takeGuestAccess(b.location,b.history,b.storage),access)
  assert.equal(checklistGuestUrl({href:'https://example.invalid/tm-opsperformance/?old=x#/checklists'},token),`https://example.invalid/tm-opsperformance/#/guest-checklists?token=${token}`)
  assert.equal(checklistGuestUrl({href:'https://example.invalid/#/checklists'},token),`https://example.invalid/#/guest-checklists?token=${token}`)
  clearGuestAccess(b.storage);assert.equal(takeGuestAccess(b.location,b.history,b.storage),null)
})
test('an invalid replacement QR removes the old store credential before failing',()=>{
  const b=browser();takeGuestAccess(b.location,b.history,b.storage,()=> 'first')
  b.location.hash='#/guest-checklists?token=invalid'
  assert.throws(()=>takeGuestAccess(b.location,b.history,b.storage),/not valid/)
  assert.equal(b.values.size,0)
  assert.equal(takeGuestAccess(b.location,b.history,b.storage),null)
})
test('guest transport never loads account identity; scoped secret is only in the POST body',async()=>{
  const calls=[]
  const t=createChecklistTransport({supabaseUrl:'https://service.invalid',auth:{getSession(){throw Error('Guest accessed account session')}}},'publishable',{token,fetcher:async(url,options)=>{calls.push({url,options});return Response.json({location:{id:'site'},templates:[],submissions:[]})}})
  await t.context();assert.equal(calls.length,1)
  assert.equal(calls[0].url,'https://service.invalid/functions/v1/checklist-access')
  assert.equal(calls[0].options.headers.Authorization,undefined)
  assert.equal(JSON.parse(calls[0].options.body).token,token)
  assert.equal(calls[0].options.cache,'no-store');assert.equal(calls[0].options.credentials,'omit')
})
test('signed-in save preserves server revision and correction identity; failures are not retried',async()=>{
  const calls=[]
  const t=createChecklistTransport({supabaseUrl:'https://service.invalid',auth:{getSession:async()=>({data:{session:{access_token:'fictional-session'}}})}},'publishable',{fetcher:async(url,options)=>{calls.push(options);return Response.json({error:'Conflict; refresh'},{status:409})}})
  await assert.rejects(t.save({id:'record',revision:3,base_revision:9,working_copy_id:'correction'},{answers:{},name:'Fictional',submit:false}),/Conflict/)
  assert.equal(calls.length,1);const body=JSON.parse(calls[0].body)
  assert.equal(body.revision,3);assert.equal(body.working_copy_id,'correction');assert.equal(body.token,undefined)
  assert.equal(calls[0].headers.Authorization,'Bearer fictional-session')
})
test('evidence revoked after transfer is never returned for display',async()=>{
  const calls=[]
  const t=createChecklistTransport({supabaseUrl:'https://service.invalid'},'publishable',{token,fetcher:async(url,options)=>{const action=JSON.parse(options.body).action;calls.push(action);return action==='download'?new Response(new Blob(['fictional'],{type:'image/png'}),{headers:{'Content-Type':'image/png'}}):Response.json({error:'Access revoked'},{status:403})}})
  await assert.rejects(t.download({id:'record'},{id:'file'},new AbortController().signal),/revoked/)
  assert.deepEqual(calls,['download','read'])
})
const context = site => ({location:{id:site,site_code:site,timezone:'America/New_York'},templates:[...checklistTemplates,weeklyPmTemplate],submissions:[],server_now:'2026-11-12T12:00:00Z',has_more:false})
const text = node => typeof node==='string'?node:Array.isArray(node)?node.map(text).join(''):node?.props?text(node.props.children):''
test('guest route has fixed store, no account navigation, and never creates drafts on mount',async()=>{
  const b=browser();const calls=[]
  const h=locationHelpHarness('pages/GuestChecklists',{useLocation:()=>({search:`?token=${token}`}),window:b,sessionStorage:b.storage,takeGuestAccess:(...args)=>takeGuestAccess(...args,()=> 'recovery'),clearGuestAccess,
   createChecklistTransport:()=>({request:async action=>{calls.push(action);return context('Store A')}}),supabase:{},supabasePublicKey:'public',checklistPeriod,localChecklistDate,ChecklistForm:()=>null})
  await h.flush();assert.deepEqual(calls,['context'])
  assert.equal(h.all(n=>n.type==='select'||n.type==='nav'||n.type==='a').length,0)
  assert.equal(h.all(n=>n.type==='article').length,5)
  assert.ok(h.find(n=>n.type==='p'&&text(n).includes('Store A')))
  h.unmount()
})
test('changing QR stores in one tab invalidates late reads from the previous store',async()=>{
  const b=browser();let route={search:`?token=${token}`},finishFirst
  const h=locationHelpHarness('pages/GuestChecklists',{useLocation:()=>route,window:b,sessionStorage:b.storage,takeGuestAccess:(...args)=>takeGuestAccess(...args,()=> 'recovery'),clearGuestAccess,
    createChecklistTransport:(client,key,access)=>({request:async()=>access.token===token?new Promise(resolve=>{finishFirst=resolve}):context('Store B')}),supabase:{},supabasePublicKey:'public',checklistPeriod,localChecklistDate,ChecklistForm:()=>null})
  await h.flush();const other='b'.repeat(64);b.location.hash=`#/guest-checklists?token=${other}`;route={search:`?token=${other}`};await h.flush()
  assert.ok(h.find(n=>n.type==='p'&&text(n).includes('Store B')))
  finishFirst(context('Store A'));await h.flush()
  assert.equal(h.all(n=>n.type==='p'&&text(n).includes('Store A')).length,0)
  b.location.hash='#/guest-checklists?token=bad';route={search:'?token=bad'};await h.flush()
  assert.equal(h.all(n=>n.type==='article').length,0);assert.equal(b.values.size,0)
  h.unmount()
})
