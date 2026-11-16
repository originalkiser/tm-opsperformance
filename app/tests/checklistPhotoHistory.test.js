import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash,webcrypto } from 'node:crypto'
import { hashHistoryBatch } from '../../scripts/hash-checklist-photo-history.mjs'
test('historical hashing persists results one-by-one and explicitly reports inaccessible objects',async()=>{
 const calls=[],bytes=new Uint8Array([1,2,3])
 const client={rpc:async(name,args)=>{calls.push(args);return {data:args.p_action==='batch'?{objects:[{attachment_id:'one',object_path:'old/one'},{attachment_id:'two',object_path:'old/two'}]}:args.p_action==='report'?{inaccessible:[{attachment_id:'two',error_code:'download_failed'}]}:{recorded:true}}},storage:{from:()=>({download:async path=>path==='old/one'?{data:new Blob([bytes],{type:'image/jpeg'})}:{error:{message:'private error'}}})}}
 const r=await hashHistoryBatch(client,{cryptoImpl:webcrypto})
 assert.equal(r.processed,2);assert.equal(r.after,'two')
 assert.equal(calls[1].p_body.sha256,createHash('sha256').update(bytes).digest('hex'))
 assert.deepEqual(calls[2].p_body,{attachment_id:'two',error_code:'download_failed'})
 assert.equal(r.report.inaccessible.length,1)
})
test('history checkpoint never advances past an unpersisted result and retries are explicit',async()=>{
 const calls=[]
 const client={rpc:async(name,args)=>{calls.push(args);return args.p_action==='batch'?{data:{objects:[{attachment_id:'one',object_path:'old/one'}]}}:{error:{message:'unavailable'}}},storage:{from:()=>({download:async()=>({error:{}})})}}
 await assert.rejects(hashHistoryBatch(client,{after:'previous',retryInaccessible:true}),/no checkpoint advanced/)
 assert.deepEqual(calls[0].p_body,{after:'previous',retry_inaccessible:true});assert.equal(calls.length,2)
})
