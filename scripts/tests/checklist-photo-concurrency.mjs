// Starts/stops a disposable localhost PostgreSQL. Never reads application credentials.
// PHOTO_TEST_TOOLS=/path/to/temp/node_modules node scripts/tests/checklist-photo-concurrency.mjs
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL,fileURLToPath } from 'node:url'
const tools=process.env.PHOTO_TEST_TOOLS
if(!tools)throw Error('PHOTO_TEST_TOOLS must point to disposable test dependencies')
const {default:EmbeddedPostgres}=await import(pathToFileURL(join(tools,'embedded-postgres/dist/index.js')).href)
const {default:postgres}=await import(pathToFileURL(join(tools,'pg/lib/index.js')).href)
const pg=new EmbeddedPostgres({databaseDir:mkdtempSync(join(tmpdir(),'tm-photo-pg-')),port:55439,user:'postgres',password:'fictional-local-only',persistent:false,onLog:()=>{},onError:()=>{}})
let db,a,b,observer
try {
 await pg.initialise();await pg.start()
 process.env.PGLITE_MODULE=fileURLToPath(new URL('./helpers/nativePhotoDatabase.mjs',import.meta.url))
 const {setup,start,api,root,store}=await import('./helpers/checklistPhotoFixture.mjs')
 ;({db}=await setup())
 const one=(await start(db,'opening')).submission,two=(await start(db,'closing')).submission
 const sha='a'.repeat(64),intents=[]
 for(const row of [one,two]){
  const intent=await api(db,'upload_begin',{id:row.id,item_id:row.template_snapshot.definition[0].id,kind:'photo',extension:'png'})
  await root(db,"insert into storage.objects(bucket_id,name) values('manager-checklist-evidence',$1)",[intent.object_path]);intents.push(intent)
 }
 a=new postgres.Client(db.connection);b=new postgres.Client(db.connection);observer=new postgres.Client(db.connection)
 await Promise.all([a.connect(),b.connect(),observer.connect()]);await a.query('begin;set local role service_role');await b.query('begin;set local role service_role')
 const sql='select public.checklist_access_server($1,null,\'upload_finish\',$2::jsonb)'
 const args=index=>[store,JSON.stringify({id:[one,two][index].id,upload_id:intents[index].upload_id,sha256:sha})]
 await a.query(sql,args(0))
 let settled=false
 const contender=b.query(sql,args(1)).then(()=>({ok:true}),error=>({error})).finally(()=>{settled=true})
 // Confirm genuine overlap while the first transaction holds its unique-index entry.
 let waiting=false
 for(let i=0;i<100&&!waiting;i++){
  const result=await observer.query("select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock'")
  waiting=result.rowCount>0
  if(!waiting)await new Promise(resolve=>setTimeout(resolve,10))
 }
 assert.equal(waiting,true);assert.equal(settled,false)
 await a.query('commit')
 const outcome=await contender;assert.equal(outcome.error?.code,'P0002');assert.match(outcome.error.message,/Take a new photo/);await b.query('rollback')
 assert.equal((await observer.query('select count(*)::int n from public.checklist_attachments')).rows[0].n,1)
 assert.equal((await observer.query('select count(*)::int n from checklist_private.photo_claims')).rows[0].n,1)
 console.log('PASS: two native PostgreSQL sessions overlapped; one attachment committed, duplicate rejected atomically.')
}finally{await a?.end();await b?.end();await observer?.end();await db?.close();await pg.stop()}
