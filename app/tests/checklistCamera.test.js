import test from 'node:test'
import assert from 'node:assert/strict'
import { locationHelpHarness } from './helpers/locationHelpHarness.js'
const button=(h,label)=>h.find(n=>n.type==='button'&&n.props.children===label)
function camera({available=true,secure=true,denied=false,pending=false}={}) {
 const calls=[],photos=[];let resolve
 const stream={getTracks:()=>[{stop(){calls.push('stop')}}]}
 const h=locationHelpHarness('components/ChecklistCamera',{
  globalThis:{isSecureContext:secure},navigator:{mediaDevices:available?{getUserMedia:async constraints=>{calls.push(constraints);if(denied)throw Error('denied');if(pending)return new Promise(r=>{resolve=r});return stream}}:undefined},
  document:{createElement(){return {getContext:()=>({drawImage(){calls.push('frame')}}),toBlob:cb=>cb(new Blob(['frame'],{type:'image/jpeg'}))}}},
 },{itemId:'entry',disabled:false,onCapture:async photo=>photos.push(photo)})
 return {...h,calls,photos,resolve:()=>resolve(stream)}
}
for(const browser of ['iPhone','Android']) test(`${browser} capture uses camera stream with no library input and stops camera after capture`,async()=>{
 const h=camera();await h.flush();assert.equal(h.all(n=>n.type==='input').length,0)
 await button(h,'Open camera').props.onClick();await h.flush()
 assert.deepEqual(h.calls[0],{video:{facingMode:{ideal:'environment'}},audio:false})
 const video=h.find(n=>n.type==='video');assert.equal(video.props.playsInline,true)
 video.ref.current={videoWidth:1200,videoHeight:900,srcObject:null}
 await button(h,'Take photo').props.onClick();await h.flush()
 assert.equal(h.photos[0].type,'image/jpeg');assert.ok(h.calls.includes('frame'));assert.ok(h.calls.includes('stop'));assert.ok(button(h,'Open camera'));h.unmount()
})
test('unsupported, insecure and denied cameras allow draft guidance with no library fallback',async()=>{
 for(const config of [{available:false},{secure:false},{denied:true}]){
  const h=camera(config);await h.flush();await button(h,'Open camera').props.onClick();await h.flush()
  assert.match(h.find(n=>n.props?.role==='alert').props.children,/incomplete draft/)
  assert.equal(h.all(n=>n.type==='input').length,0);assert.equal(h.photos.length,0);h.unmount()
 }
})
test('cancel/unmount while permission is pending stops any late stream and never captures',async()=>{
 for(const unmount of [false,true]){
  const h=camera({pending:true});await h.flush()
  const start=button(h,'Open camera').props.onClick();await h.flush()
  if(unmount)h.unmount();else button(h,'Cancel camera').props.onClick()
  h.resolve();await start;await h.flush();assert.ok(h.calls.includes('stop'));assert.equal(h.photos.length,0)
  if(!unmount)h.unmount()
 }
})
test('disabled camera cannot start and empty preview cannot produce evidence',async()=>{
 const h=camera();await h.flush();await button(h,'Open camera').props.onClick();await h.flush()
 await button(h,'Take photo').props.onClick();await h.flush();assert.equal(h.photos.length,0)
 assert.match(h.find(n=>n.props?.role==='alert').props.children,/preview/)
 h.props({itemId:'entry',disabled:true,onCapture(){throw Error('disabled')}});await h.flush()
 assert.ok(h.calls.includes('stop'));assert.equal(button(h,'Open camera').props.disabled,true);h.unmount()
})
