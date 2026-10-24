import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync,readdirSync } from 'node:fs'
const dir=new URL('../supabase/migrations/',import.meta.url)
const file=readdirSync(dir).find(f=>f.endsWith('_employee_roster_permissions.sql'))
const sql=readFileSync(new URL(file,dir),'utf8')
test('roster SQL changes only employee permissions and caller-scoped helper',()=>{
  assert.match(sql,/set search_path=''/)
  assert.match(sql,/p.id=auth.uid\(\) and p.is_active is true and p.deleted_at is null/)
  assert.doesNotMatch(sql,/alter table public\.(daily_logs|user_profiles|manager_locations)|update public\.|delete from|employee_id|create or replace/i)
  assert.match(sql,/using \(public.can_maintain_employee_roster\(location_id\)\)\s+with check/)
})
test('employee writes are field-limited and cannot delete, relocate or replace identity',()=>{
  assert.match(sql,/grant insert\(location_id,name,is_active\),update\(name,is_active\)/)
  assert.match(sql,/revoke insert,update,delete,truncate,references,trigger/)
  assert.doesNotMatch(sql,/drop policy employees_select/)
})
test('Admin cannot invoke the removed permanent employee deletion flow',()=>{
  const admin=readFileSync(new URL('../src/pages/Admin.jsx',import.meta.url),'utf8')
  assert.doesNotMatch(admin,/deleteEmployee/)
})
