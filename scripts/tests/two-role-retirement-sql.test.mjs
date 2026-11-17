import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE).href)
const sql=readFileSync(new URL('../../docs/sql/retire-area-manager-REVIEW-ONLY.sql',import.meta.url),'utf8')
async function fixture(){const db=new PGlite();await db.exec("create table user_profiles(id int primary key,role text,is_active boolean,deleted_at timestamptz,constraint user_profiles_role_check check(role in ('store','area_manager','admin')));create table manager_locations(manager_id int references user_profiles(id), location_id int);insert into user_profiles values(1,'admin',true,null),(2,'store',true,null);insert into manager_locations values(1,10),(2,20)");return db}
test('retirement preserves Admin/Store and their assignments; rejects any new unsupported role',async()=>{
 const db=await fixture();try{await db.exec(sql);assert.equal((await db.query('select count(*)::int n from manager_locations')).rows[0].n,2);await db.exec("insert into user_profiles values(3,'store',true,null),(4,'admin',true,null)");await assert.rejects(db.exec("insert into user_profiles values(5,'area_manager',true,null)"),/user_profiles_role_check/)}finally{await db.close()}
})
test('inactive or historical retired accounts block retirement without silent reassignment',async()=>{
 const db=await fixture();try{await db.exec("insert into user_profiles values(3,'area_manager',false,now())");await assert.rejects(db.exec(sql),/accounts still exist/);await db.exec('rollback');assert.equal((await db.query("select role from user_profiles where id=3")).rows[0].role,'area_manager');assert.equal((await db.query('select count(*)::int n from manager_locations')).rows[0].n,2)}finally{await db.close()}
})
