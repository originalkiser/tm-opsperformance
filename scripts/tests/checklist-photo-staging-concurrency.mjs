// Two native PostgreSQL sessions prove the phase barrier sees concurrent arrivals and releases new uploads.
// PHOTO_TEST_TOOLS=/path/to/temp/node_modules node scripts/tests/checklist-photo-staging-concurrency.mjs
import assert from 'node:assert/strict'
import {mkdtempSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {pathToFileURL,fileURLToPath} from 'node:url'
const tools=process.env.PHOTO_TEST_TOOLS
if(!tools)throw Error('PHOTO_TEST_TOOLS is required for disposable test dependencies')
const {default:EmbeddedPostgres}=await import(pathToFileURL(join(tools,'embedded-postgres/dist/index.js')).href)
const {default:postgres}=await import(pathToFileURL(join(tools,'pg/lib/index.js')).href)
const pg=new EmbeddedPostgres({databaseDir:mkdtempSync(join(tmpdir(),'tm-photo-staging-pg-')),port:55439,user:'postgres',password:'fictional-local-only',persistent:false,onLog:()=>{},onError:()=>{}})
let db,a,b,observer
try{
 await pg.initialise();await pg.start()
 process.env.PGLITE_MODULE=fileURLToPath(new URL('./helpers/nativePhotoDatabase.mjs',import.meta.url))
 const {setup,start,api,root,maintenance,store}=await import('./helpers/checklistPhotoFixture.mjs')
 ;({db}=await setup({enforcement:false}))
 await maintenance(db,'attest_endpoint',{version:'sha256-v1',deployment_id:'fictional-native-test'})
 await root(db,"update checklist_private.photo_rollout set endpoint_verified_at=clock_timestamp()-interval '11 minutes' where singleton") // Fixture clock only.
 const row=(await start(db,'opening')).submission
 const u=await api(db,'upload_begin',{id:row.id,kind:'photo',item_id:row.template_snapshot.definition.find(i=>i.photo_required).id,extension:'jpg'})
 // Use an actual valid item from the immutable snapshot.
 await root(db,"insert into storage.objects(bucket_id,name) values('manager-checklist-evidence',$1)",[u.object_path])
 const expected=(await maintenance(db,'report')).eligible_location_ids
 a=new postgres.Client(db.connection);b=new postgres.Client(db.connection);observer=new postgres.Client(db.connection)
 await Promise.all([a.connect(),b.connect(),observer.connect()])
 const waitForLock=async()=>{
  for(let n=0;n<100;n++){
   if((await observer.query("select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock'")).rowCount)return
   await new Promise(resolve=>setTimeout(resolve,10))
  }
  throw Error('Expected a real overlapping database lock wait')
 }
 const begin=client=>client.query('begin;set local role service_role')
 const activate=client=>client.query("select public.checklist_photo_history('activate',$1)",[JSON.stringify({expected_location_ids:expected})])
 const access=(client,action,body)=>client.query('select public.checklist_access_server($1,null,$2,$3)',[store,action,JSON.stringify(body)])
 await begin(a);await begin(b)
 await access(a,'upload_finish',{id:row.id,upload_id:u.upload_id}) // Original endpoint finishes while staging.
 let settled=false
 const first=activate(b).then(()=>({ok:true}),error=>({error})).finally(()=>{settled=true})
 await waitForLock();assert.equal(settled,false)
 await a.query('commit')
 const outcome=await first;assert.match(outcome.error?.message,/not ready/);await b.query('rollback')
 assert.equal((await maintenance(db,'report')).enforced,false)
 await maintenance(db,'record',{attachment_id:u.upload_id,sha256:'a'.repeat(64)})
 const secondRow=(await start(db,'closing')).submission
 await begin(a);await begin(b)
 await activate(a) // Hold the activation transaction open while the next upload starts.
 settled=false
 const next=access(b,'upload_begin',{id:secondRow.id,kind:'photo',item_id:'closing-19',extension:'png',verifier_version:'sha256-v1'}).then(result=>result.rows[0].checklist_access_server).finally(()=>{settled=true})
 await waitForLock();assert.equal(settled,false)
 await a.query('commit')
 const intent=await next;await b.query('commit');assert.equal(intent.photo_integrity,true)
 await root(db,"insert into storage.objects(bucket_id,name) values('manager-checklist-evidence',$1)",[intent.object_path])
 await api(db,'upload_finish',{id:secondRow.id,upload_id:intent.upload_id,sha256:'b'.repeat(64)})
 const r=await maintenance(db,'report');assert.equal(r.enforced,true);assert.equal(r.unverified_photos,0)
 console.log('PASS: activation waited for an old-endpoint arrival and refused unverified history; a concurrent new upload resumed after activation and verified successfully.')
}finally{await a?.end();await b?.end();await observer?.end();await db?.close();await pg.stop()}
