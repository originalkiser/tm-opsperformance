import test from 'node:test'
import assert from 'node:assert/strict'
import { locationHelpHarness } from './helpers/locationHelpHarness.js'
import * as folders from '../src/utils/resourceCatalog.js'
import { resourceAccess, filterResources, validateResourceMetadata } from '../src/utils/resourceLibrary.js'
const catalog=[
 {id:'c1',category_key:'Equipment Manuals',brand_key:'',name:'Equipment',sort_order:1,revision:1,uses_manufacturers:true},
 {id:'c2',category_key:'Employee Handbook',brand_key:'',name:'Handbooks',sort_order:0,revision:1},
 {id:'m1',category_key:'Equipment Manuals',brand_key:'brand-key',name:'Example Maker',sort_order:0,revision:1},
]
const documents=[{id:'d1',category:'Equipment Manuals',brand:'brand-key',title:'Pump guide',object_path:'d1/file.pdf'},
 {id:'d2',category:'Employee Handbook',brand:'',title:'Employee reference',object_path:'d2/file.pdf'}]
const text=node=>typeof node==='string'?node:Array.isArray(node)?node.map(text).join(''):node?.props?text(node.props.children):''
const editor=()=>null
function page(role='admin') {
 return locationHelpHarness('pages/Resources',{
  ...folders,resourceAccess,filterResources,validateResourceMetadata,ResourceCatalogEditor:editor,
  useAuth:()=>({user:{id:'fictional'},profile:{role,is_active:true,deleted_at:null}}),
  supabase:{from(table){return {select(){return this},order:async()=>({data:table==='resource_catalog'?catalog:documents})}}},
  NavBar:()=>null,ResourceViewer:()=>null,
 })
}
const folder=(h,name)=>h.find(n=>n.type==='button'&&text(n)===name+' →')
const button=(h,name)=>h.find(n=>n.type==='button'&&text(n)===name)
test('Admin and Store see folders first, manufacturer drill-down, breadcrumbs and Back',async()=>{
 for(const role of ['admin','store']){
  const h=page(role);await h.flush()
  assert.deepEqual(h.all(n=>n.type==='button'&&text(n).endsWith(' →')).map(text),['Handbooks →','Equipment →'])
  assert.equal(button(h,'Open / Download PDF'),undefined)
  assert.equal(!!h.find(n=>n.type===editor),role==='admin')
  folder(h,'Equipment').props.onClick();await h.flush()
  assert.ok(folder(h,'Example Maker'));assert.equal(button(h,'Open / Download PDF'),undefined)
  folder(h,'Example Maker').props.onClick();await h.flush()
  assert.ok(button(h,'Open / Download PDF'));assert.equal(h.all(n=>n.type==='h3').map(text).includes('Employee reference'),false)
  assert.match(text(h.find(n=>n.type==='nav'&&n.props['aria-label']==='Resource folders')),/Resources.*Equipment.*Example Maker.*Back/)
  button(h,'Back').props.onClick();await h.flush();assert.ok(folder(h,'Example Maker'))
  button(h,'Back').props.onClick();await h.flush();assert.ok(folder(h,'Equipment'))
  folder(h,'Handbooks').props.onClick();await h.flush();assert.ok(h.find(n=>n.type==='h3'&&text(n)==='Employee reference'))
  assert.equal(!!button(h,'Edit metadata'),role==='admin')
  button(h,'Resources').props.onClick();await h.flush();assert.ok(folder(h,'Handbooks'));h.unmount()
 }
})
test('global search crosses the current folder and resolves renamed category/manufacturer labels',async()=>{
 const h=page();await h.flush();folder(h,'Equipment').props.onClick();await h.flush()
 const search=()=>h.find(n=>n.type==='input'&&n.props.type==='search')
 search().props.onChange({target:{value:'Handbooks'}});await h.flush()
 assert.ok(h.find(n=>n.type==='h3'&&text(n)==='Employee reference'))
 button(h,'Back').props.onClick();await h.flush();assert.ok(folder(h,'Example Maker'))
 search().props.onChange({target:{value:'Example Maker'}});await h.flush();assert.ok(h.find(n=>n.type==='h3'&&text(n)==='Pump guide'))
 button(h,'Resources').props.onClick();await h.flush();assert.equal(search().props.value,'');h.unmount()
 assert.equal(filterResources(documents,{query:'Handbooks'},catalog)[0].id,'d2')
 assert.equal(filterResources(documents,{query:'Example Maker'},catalog)[0].id,'d1')
 assert.doesNotThrow(()=>validateResourceMetadata(documents[0],catalog))
 assert.throws(()=>validateResourceMetadata({...documents[0],brand:'invented'},catalog),/manufacturer/)
})
test('catalog management binds changes to the full reviewed revision inventory',async()=>{
 let args
 const client={rpc:async(name,parameters)=>{assert.equal(name,'manage_resource_catalog');args=parameters;return {data:{ok:true}}}}
 await folders.catalogAction(client,'rename',catalog,catalog[2],{name:'New maker'})
 assert.deepEqual(args.p_expected,folders.catalogExpectation(catalog));assert.equal(args.p_id,'m1');assert.equal(args.p_data.name,'New maker')
 await assert.rejects(folders.catalogAction({rpc:async()=>({error:{message:'Catalog changed; refresh'}})},'delete',catalog,catalog[0]),/Catalog changed/)
})
test('Admin folder editor adds, renames and reorders via the scoped RPC',async()=>{
 const calls=[]
 const h=locationHelpHarness('components/ResourceCatalogEditor',{
  ...folders,catalogAction:async(...args)=>{calls.push(args)},
 },{client:{},catalog,busy:false,run:async action=>action()})
 h.find(n=>n.type==='input'&&n.props.required).props.onChange({target:{value:'New folder'}});await h.flush()
 await h.find(n=>n.type==='form').props.onSubmit({preventDefault(){}});await h.flush()
 assert.equal(calls[0][1],'add_category');assert.equal(calls[0][4].name,'New folder')
 button(h,'Rename').props.onClick();await h.flush()
 h.find(n=>n.type==='input'&&n.props['aria-label']==='Folder name').props.onChange({target:{value:'New label'}});await h.flush()
 await h.all(n=>n.type==='form')[1].props.onSubmit({preventDefault(){}});await h.flush()
 assert.equal(calls[1][1],'rename');assert.equal(calls[1][4].name,'New label')
 h.find(n=>n.type==='button'&&n.props['aria-label']==='Move Handbooks down').props.onClick();await h.flush();assert.equal(calls[2][1],'move')
 h.unmount()
})
