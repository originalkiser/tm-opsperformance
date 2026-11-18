import assert from 'node:assert/strict'
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE)
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true})
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[]
page.on('pageerror',e=>errors.push(e.message));page.on('dialog',dialog=>dialog.accept())
await page.route('**/*',async route=>{
 const url=new URL(route.request().url())
 if(url.hostname!=='127.0.0.1')return route.abort()
 if(url.pathname.endsWith('/src/lib/supabase.js'))return route.fulfill({contentType:'application/javascript',body:`
 export const supabase={async rpc(name,p){
  if(name!=='checklist_template_editor')throw Error('Unexpected endpoint');
  window.editorCalls.push(p);const s=window.editorState,clone=v=>JSON.parse(JSON.stringify(v));
  const result=()=>({data:clone(s)}),a=p.p_action;
  if(a==='read')return result();
  if(a==='version')return {data:clone(s.versions.find(v=>v.version===p.p_restore_version))};
  if(a==='revisions')return {data:{revisions:clone(window.revisionHistory)}};
  if(window.forceConflict){window.forceConflict=false;s.draft.revision++;return {error:{message:'Template changed elsewhere. Reload and review before saving'}}}
  if(p.p_revision!==(s.draft?.revision||0)||p.p_version!==s.published.version)return {error:{message:'Template changed elsewhere. Reload and review before saving'}};
  if(a==='preview'){s.draft.preview_revision=s.draft.revision;return {data:{definition:clone(s.draft.definition),name:s.published.name,revision:s.draft.revision}}}
  const definition=a==='save'?clone(p.p_definition):a==='restore'?clone(s.versions.find(v=>v.version===p.p_restore_version).definition):clone(s.draft.definition);
  if(a==='publish'&&s.draft.preview_revision!==s.draft.revision)return {error:{message:'Preview first'}};
  s.draft={base_version:s.published.version,revision:(s.draft?.revision||0)+1,definition,editing:a!=='publish'};
  window.revisionHistory.push({revision:s.draft.revision,action:a,recorded_at:'2026-11-18',note:p.p_note||'',definition:clone(definition)});
  if(a==='publish'){s.published={...s.published,version:s.published.version+1,definition};s.versions.unshift({...clone(s.published),note:p.p_note,published_at:'2026-11-18'})}
  return result();
 }};
 `})
 return route.continue()
})
await page.addInitScript(()=>{
 const question=(id,text)=>({id,section:'Fictional section',text,instruction:'Fictional instruction',type:'yesno',options:['Yes','No'],failure_values:['No'],critical:false,photo_required:false,na_allowed:false})
 window.fixtureTemplate={key:'midday',name:'Fictional checklist',cadence:'daily',version:1,definition:[question('midday-1','First fictional question'),question('midday-2','Second fictional question')]}
 window.editorState={published:structuredClone(window.fixtureTemplate),draft:null,versions:[{...structuredClone(window.fixtureTemplate),published_at:'2026-11-17',note:'Baseline'}]}
 window.editorCalls=[];window.revisionHistory=[]
})
try{
 await page.goto('http://127.0.0.1:5188/tm-opsperformance/tests/browser/super-admin-editor.html')
 await page.getByRole('button',{name:'Fictional checklist',exact:true}).click()
 await page.getByLabel('Question 1',{exact:true}).fill('Edited fictional wording')
 await page.getByLabel('Required photos 1',{exact:true}).fill('3')
 await page.getByLabel('Critical 1',{exact:true}).check()
 await page.getByRole('button',{name:'Move question 1 down',exact:true}).click()
 assert.equal(await page.getByLabel('Question 2',{exact:true}).inputValue(),'Edited fictional wording')
 await page.getByRole('button',{name:'Add question',exact:true}).click()
 assert.equal(await page.getByLabel('Question 3',{exact:true}).count(),1)
 await page.getByLabel('Revision / publication note').fill('Fictional reviewed update')
 await page.getByRole('button',{name:'Save unpublished draft'}).click()
 await page.getByRole('status').filter({hasText:'Unpublished draft saved'}).waitFor()
 assert.equal(await page.getByRole('button',{name:'Publish new version'}).isDisabled(),true)
 await page.getByRole('button',{name:'Preview complete checklist'}).click()
 await page.getByRole('region',{name:'Complete checklist preview',exact:true}).waitFor()
 assert.equal(await page.getByRole('region',{name:'Complete checklist preview',exact:true}).getByText('Edited fictional wording',{exact:false}).count(),1)
 await page.screenshot({path:'/tmp/tm-super-admin-editor-desktop.png',fullPage:true})
 await page.getByRole('button',{name:'Publish new version'}).click()
 await page.getByRole('status').filter({hasText:'Published version 2'}).waitFor()
 await page.getByText('Published versions',{exact:true}).click()
 await page.getByRole('button',{name:'Restore version 1 to draft',exact:true}).click()
 await page.getByRole('status').filter({hasText:'Prior version copied into a draft'}).waitFor()
 await page.getByRole('button',{name:'Preview complete checklist'}).click()
 await page.getByRole('button',{name:'Publish new version'}).click()
 await page.getByRole('status').filter({hasText:'Published version 3'}).waitFor()
 assert.equal(await page.getByLabel('Question 3',{exact:true}).count(),0)
 await page.getByLabel('Question 1',{exact:true}).fill('Concurrent local change')
 await page.evaluate(()=>{window.forceConflict=true})
 await page.getByRole('button',{name:'Save unpublished draft'}).click()
 await page.getByRole('alert').filter({hasText:'Template changed elsewhere'}).waitFor()
 assert.equal(await page.getByLabel('Question 1',{exact:true}).inputValue(),'Concurrent local change')
 assert.equal(await page.getByRole('button',{name:'Publish new version'}).isDisabled(),true)
 await page.getByRole('button',{name:'Reload saved template'}).click()
 await page.getByLabel('Required photos 1',{exact:true}).fill('11')
 assert.equal(await page.getByRole('button',{name:'Save unpublished draft'}).isDisabled(),true)
 await page.getByLabel('Required photos 1',{exact:true}).fill('10')
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.classList.add('dark'))
 await page.screenshot({path:'/tmp/tm-super-admin-editor-mobile-dark.png',fullPage:true})
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
 assert.deepEqual(errors,[])
 const actions=await page.evaluate(()=>window.editorCalls.map(p=>p.p_action))
 assert.equal(actions.filter(a=>a==='publish').length,2)
 assert.equal(actions.includes('restore'),true)
 console.log('Browser editor: wording, Critical, 3/10 photos, add/reorder, save, full preview, publish, restore, stale conflict and mobile/dark checks passed; fictional data only.')
}finally{await browser.close()}
