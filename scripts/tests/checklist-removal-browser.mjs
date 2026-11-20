// Fictional local UI only: no production client, account or record access.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync,readFileSync,readdirSync,writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join,resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer } from 'node:http'
const root=resolve(import.meta.dirname,'../..'),app=join(root,'app'),require=createRequire(join(app,'package.json'))
const {build}=require('esbuild'),{chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href)
const output=mkdtempSync(join(tmpdir(),'tm-question-removal-'))
const fixture=`import React from 'react';import{createRoot}from'react-dom/client';import Editor from './src/components/ChecklistAdmin.jsx';
const q=(id,extra={})=>({id,section:'Fictional section',text:'Fictional '+id,instruction:'Test instructions',type:'completion',options:['Completed','Not Completed'],failure_values:['Not Completed'],critical:false,photo_required:false,na_allowed:false,...extra});
const published={key:'weekly',name:'Fictional checklist',version:1,definition:[q('ordinary'),q('signature',{signature_required:true}),q('parent'),q('follow',{type:'text',options:[],failure_values:[],condition:{item_id:'parent',value:'Not Completed'}}),q('weekly-9')]};
window.state={published,draft:null,versions:[{...structuredClone(published),note:'Baseline',published_at:'2026-11-20'}]};window.calls=[];window.revisions=[];
const clone=x=>structuredClone(x);
window.editorRpc=async(name,p)=>{if(name!=='checklist_template_editor')throw Error('Unexpected endpoint');window.calls.push(clone(p));const s=window.state,a=p.p_action;
 if(a==='read')return {data:clone(s)};if(a==='version')return {data:clone(s.versions.find(v=>v.version===p.p_restore_version))};if(a==='revisions')return {data:{revisions:clone(window.revisions)}};
 if(window.conflict){window.conflict=false;return {error:{message:'Template changed elsewhere. Reload and review before saving'}}}
 if(p.p_revision!==(s.draft?.revision||0)||p.p_version!==s.published.version)return {error:{message:'Template changed elsewhere'}};
 if(a==='preview'){s.draft.preview_revision=s.draft.revision;return {data:{name:s.published.name,definition:clone(s.draft.definition)}}}
 if(a==='publish'&&s.draft.preview_revision!==s.draft.revision)return {error:{message:'Preview first'}};
 const definition=a==='save'?clone(p.p_definition):a==='restore'?clone(s.versions.find(v=>v.version===p.p_restore_version).definition):clone(s.draft.definition);
 s.draft={revision:(s.draft?.revision||0)+1,definition,editing:a!=='publish'};window.revisions.push({revision:s.draft.revision,action:a,definition:clone(definition),note:p.p_note,recorded_at:'2026-11-20'});
 if(a==='publish'){s.published={...s.published,definition,version:s.published.version+1};s.versions.unshift({...clone(s.published),note:p.p_note,published_at:'2026-11-20'})}return {data:clone(s)}};
createRoot(document.getElementById('root')).render(<main className="p-4 max-w-5xl mx-auto bg-tm-cream dark:bg-tm-dark-bg text-slate-900 dark:text-tm-dark-text"><Editor templates={[published]} reload={async()=>{}}/></main>);`
await build({stdin:{contents:fixture,resolveDir:app,loader:'jsx'},bundle:true,jsx:'automatic',format:'esm',outfile:join(output,'fixture.js'),plugins:[{name:'fictional-client',setup(build){build.onResolve({filter:/lib\/supabase$/},()=>({path:'supabase',namespace:'fictional'}));build.onLoad({filter:/.*/,namespace:'fictional'},()=>({contents:'export const supabase={rpc:(...args)=>window.editorRpc(...args)}',loader:'js'}))}}]})
const css=readdirSync(join(app,'dist/assets')).find(name=>name.endsWith('.css'))
writeFileSync(join(output,'fixture.css'),readFileSync(join(app,'dist/assets',css),'utf8').replace(/@import\s*(?:url\([^)]*\)|"[^"]*"|'[^']*')[^;]*;/g,''))
writeFileSync(join(output,'index.html'),'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script type="module" src="/fixture.js"></script>')
const server=createServer((req,res)=>{const file=['/fixture.js','/fixture.css'].includes(req.url)?req.url.slice(1):'index.html';res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(readFileSync(join(output,file)))})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`
let browser
try{
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE,headless:true})
 for(const [name,width,dark]of [['desktop-light',1280,false],['mobile-dark',360,true]]){
  const context=await browser.newContext({viewport:{width,height:900}})
  await context.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort())
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message))
  await page.goto(origin);if(dark)await page.evaluate(()=>document.documentElement.classList.add('dark'))
  let accept=false;page.on('dialog',dialog=>accept?dialog.accept():dialog.dismiss())
  await page.getByRole('button',{name:'Fictional checklist',exact:true}).click()
  for(let n=2;n<=5;n++)assert.equal(await page.getByRole('button',{name:`Remove question ${n}`,exact:true}).isDisabled(),true)
  await page.getByLabel('Question 2',{exact:true}).fill('Retained unsaved signature wording')
  await page.getByRole('button',{name:'Remove question 1',exact:true}).click()
  assert.equal(await page.getByLabel('Question 1',{exact:true}).inputValue(),'Fictional ordinary')
  accept=true;await page.getByRole('button',{name:'Remove question 1',exact:true}).click()
  assert.equal(await page.getByLabel('Question 1',{exact:true}).inputValue(),'Retained unsaved signature wording')
  assert.deepEqual(await page.evaluate(()=>window.calls.map(c=>c.p_action)),['read'])
  assert.equal(await page.getByRole('button',{name:'Preview complete checklist'}).isDisabled(),true)
  await page.getByLabel('Revision / publication note').fill('Fictional approved removal')
  await page.getByRole('button',{name:'Save unpublished draft'}).click()
  await page.getByRole('status').filter({hasText:'Unpublished draft saved'}).waitFor()
  assert.equal(await page.evaluate(()=>window.state.published.definition.length),5)
  assert.equal(await page.getByRole('button',{name:'Publish new version'}).isDisabled(),true)
  await page.getByRole('button',{name:'Preview complete checklist'}).click()
  const preview=page.getByRole('region',{name:'Complete checklist preview',exact:true});await preview.waitFor()
  assert.equal(await preview.getByText(/Fictional ordinary/).count(),0)
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  await page.screenshot({path:join(output,`${name}-preview.png`),fullPage:true})
  await page.getByRole('button',{name:'Publish new version'}).click()
  await page.getByRole('status').filter({hasText:'Published version 2'}).waitFor()
  assert.equal(await page.evaluate(()=>window.state.versions.find(v=>v.version===1).definition.length),5)
  await page.getByText('Published versions',{exact:true}).click()
  await page.getByRole('button',{name:'Restore version 1 to draft',exact:true}).click()
  await page.getByRole('status').filter({hasText:'Prior version copied'}).waitFor()
  assert.equal(await page.getByLabel('Question 1',{exact:true}).inputValue(),'Fictional ordinary')
  await page.getByRole('button',{name:'Remove question 1',exact:true}).click()
  await page.evaluate(()=>{window.conflict=true})
  await page.getByRole('button',{name:'Save unpublished draft'}).click()
  await page.getByRole('alert').filter({hasText:'changed elsewhere'}).waitFor()
  assert.equal(await page.getByLabel('Question 1',{exact:true}).inputValue(),'Fictional signature')
  assert.equal(await page.getByRole('button',{name:'Publish new version'}).isDisabled(),true)
  assert.deepEqual(errors,[])
  await context.close();console.log(name+': confirmation, protected questions, unsaved edits, draft/preview/publish, history, restore, conflict and responsive layout PASS')
 }
 console.log('Screenshots: '+output)
}finally{await browser?.close();server.close()}
