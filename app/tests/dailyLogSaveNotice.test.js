import test from 'node:test'
import assert from 'node:assert/strict'
import { locationHelpHarness } from './helpers/locationHelpHarness.js'
test('navigation save failures stay visible for their own signed-in user and can be dismissed',()=>{
 let notify
 const h=locationHelpHarness('components/DailyLogSaveNotice',{
  useAuth:()=>({profile:{id:'current'}}),window:{addEventListener(_name,fn){notify=fn},removeEventListener(){}},
 })
 h.render();notify({detail:{userId:'other',date:'2025-01-15',message:'Conflict'}});assert.equal(h.find(n=>n.props.role==='alert'),undefined)
 notify({detail:{userId:'current',date:'2025-01-15',message:'Conflict'}});assert.ok(h.find(n=>n.props.role==='alert'))
 h.find(n=>n.type==='button').props.onClick();assert.equal(h.find(n=>n.props.role==='alert'),undefined)
})
