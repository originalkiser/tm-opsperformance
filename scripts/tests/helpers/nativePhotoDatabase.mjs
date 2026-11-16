// Adapter for the same fictional fixture on a disposable, script-owned localhost PostgreSQL.
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
const {default:pg}=await import(pathToFileURL(join(process.env.PHOTO_TEST_TOOLS,'pg/lib/index.js')).href)
export class PGlite {
 constructor(){
  this.connection={host:'127.0.0.1',port:55439,user:'postgres',password:'fictional-local-only',database:`photo_${randomUUID().replaceAll('-','')}`}
  this.ready=(async()=>{
   this.admin=new pg.Client({...this.connection,database:'postgres'});await this.admin.connect()
   await this.admin.query(`create database ${this.connection.database}`)
   this.client=new pg.Client(this.connection);await this.client.connect()
  })()
 }
 async exec(sql){await this.ready;return this.client.query(sql)}
 async query(sql,args){await this.ready;return this.client.query(sql,args)}
 async close(){await this.client.end();await this.admin.query(`drop database ${this.connection.database}`);await this.admin.end()}
}
