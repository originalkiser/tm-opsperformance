import test from 'node:test'
import assert from 'node:assert/strict'
import { locationHelpHarness } from './helpers/locationHelpHarness.js'
import { checklistGuestUrl } from '../src/utils/checklistAccess.js'
const text=node=>typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(text).join(''):node?.props?text(node.props.children):''
const button=(h,label)=>h.find(n=>n.type==='button'&&text(n)===label)
function admin({confirm=true,fail=false}={}) {
 const calls=[],qr=[],token='a'.repeat(64)
 let grant={id:'grant',location_id:'site',is_active:true,generation:4},pending,resolve
 const h=locationHelpHarness('components/ChecklistQrAdmin',{
  supabase:{},supabasePublicKey:'public',checklistGuestUrl,
  createChecklistTransport:()=>({request:async(action,fields)=>{calls.push({action,fields});if(pending&&action==='qr_rotate')await new Promise(r=>{resolve=r});if(fail&&action==='qr_rotate')throw Error('Conflict');if(action==='qr_rotate'){grant={...grant,generation:5};return {grant,token}}if(action==='qr_revoke')grant={...grant,generation:6,is_active:false};return {grant}}}),
  QRCode:{async toDataURL(url){qr.push(url);return 'data:image/png;base64,fictional'}},
  window:{confirm:()=>confirm,location:{href:'https://example.invalid/#/checklists'}},navigator:{clipboard:{writeText:async()=>{}}},
 },{location:{id:'site',site_code:'Store A'}})
 return {...h,calls,qr,pause:()=>{pending=true},finish:()=>resolve?.()}
}
test('QR creation uses expected generation, local QR encoding and one-time disclosure',async()=>{
 const h=admin();await h.flush();assert.deepEqual(h.calls.map(c=>c.action),['qr_status'])
 assert.equal(h.find(n=>n.type==='img'),undefined)
 await button(h,'Replace QR code').props.onClick();await h.flush()
 assert.equal(h.calls.at(-1).fields.expected_generation,4);assert.equal(h.qr.length,1)
 assert.ok(h.qr[0].startsWith('https://example.invalid/#/guest-checklists?token='))
 assert.equal(h.find(n=>n.type==='img').props.src,'data:image/png;base64,fictional')
 assert.ok(h.find(n=>n.type==='input'&&n.props.readOnly))
 button(h,'Hide private link').props.onClick();h.render();assert.equal(h.find(n=>n.type==='input'),undefined)
 await button(h,'Refresh QR status').props.onClick();await h.flush();assert.equal(h.find(n=>n.type==='img'),undefined);h.unmount()
})
test('decline performs no QR mutation and duplicate clicks cannot rotate twice',async()=>{
 const declined=admin({confirm:false});await declined.flush();await button(declined,'Replace QR code').props.onClick();assert.equal(declined.calls.length,1);declined.unmount()
 const h=admin();await h.flush();h.pause();const replacing=button(h,'Replace QR code').props.onClick();await button(h,'Replace QR code').props.onClick();assert.equal(h.calls.filter(c=>c.action==='qr_rotate').length,1);h.finish();await replacing;h.unmount()
})
test('QR revoke is generation-guarded and unknown mutation results are not retried',async()=>{
 const h=admin();await h.flush();await button(h,'Disable QR access').props.onClick();await h.flush();assert.equal(h.calls.at(-1).fields.expected_generation,4);assert.equal(button(h,'Disable QR access').props.disabled,true);h.unmount()
 const failed=admin({fail:true});await failed.flush();await button(failed,'Replace QR code').props.onClick();await failed.flush();assert.equal(failed.calls.filter(c=>c.action==='qr_rotate').length,1);assert.ok(failed.find(n=>n.props?.role==='alert'&&text(n).includes('Nothing was retried')));failed.unmount()
})
test('signed-in unfinished work spans prior weeks and exposes bounded pagination',async()=>{
 const calls=[],records=[{id:'old',status:'draft',period_date:'2026-10-12',template_snapshot:{name:'Weekly checklist'}},{id:'correction',status:'submitted',working_copy_id:'work',period_date:'2026-10-19',template_snapshot:{name:'Weekly correction'}}]
 const opened=[]
 const h=locationHelpHarness('components/ChecklistOpenWork',{supabase:{},supabasePublicKey:'public',createChecklistTransport:()=>({request:async(action,fields)=>{calls.push({action,fields});return {submissions:fields.offset?records.slice(1):records.slice(0,1),has_more:!fields.offset,next_offset:100}}})},{locationId:'site',onOpen:r=>opened.push(r)})
 await h.flush();assert.equal(calls[0].fields.location_id,'site');assert.ok(h.find(n=>n.type==='li'&&text(n).includes('2026-10-12')))
 await button(h,'Load more saved checklists').props.onClick();await h.flush();assert.equal(calls[1].fields.offset,100);assert.equal(h.all(n=>n.type==='li').length,2)
 h.all(n=>n.type==='button'&&text(n)==='Continue saved work')[1].props.onClick();assert.equal(opened[0].working_copy_id,'work');h.unmount()
})
