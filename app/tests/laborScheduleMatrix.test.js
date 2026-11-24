import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as planner from '../src/utils/laborPlanner.js'

const source = readFileSync(new URL('../src/components/LaborScheduleMatrix.jsx', import.meta.url), 'utf8')
  .replace(/^import .*\n/gm, '')
const module = { exports: {} }
new Function('module', 'exports', 'React', ...Object.keys(planner),
  transformSync(source, { loader: 'jsx', format: 'cjs' }).code)(module, module.exports, React, ...Object.values(planner))
const { default: Matrix, scheduleRows } = module.exports
const roster = [{ id: 'a', name: 'Fixture Employee' }]
const shifts = [
  { day: 1, role: 'AGM', employeeId: 'a', start: 420, end: 780, breakStart: 600 },
  { day: 2, role: 'TL 1', employeeId: 'a', start: 750, end: 1140, breakStart: 900 },
  { day: 2, role: 'GM', employeeId: '', start: 480, end: 1020 },
]
const props = { roster, shifts, roles: ['GM', 'AGM', 'TL 1', 'TL 2'], week: '2026-11-22', combined: 1260 }

test('weekly matrix combines an employee’s positions into one row and uses paid hours for totals', () => {
  const row = scheduleRows(shifts, roster, props.roles).find(row => row.employeeId === 'a')
  assert.equal(row.total, 720)
  assert.deepEqual([...row.positions], ['AGM', 'TL 1'])
  const screen = renderToStaticMarkup(React.createElement(Matrix, props))
  const headers = screen.match(/<th scope="col">[^<]*/g).map(text => text.replace('<th scope="col">', ''))
  assert.deepEqual(headers, ['Employee / Position', ...planner.days])
  assert.match(screen, /<small>2026-11-22<\/small>/)
  assert.match(screen, /7:00 AM–1:00 PM/)
  assert.match(screen, /12.00 h weekly/)
  assert.match(screen, /<tfoot>.*21.00 h.*<td>0.00 h<\/td><td>6.00 h<\/td><td>15.00 h<\/td>/)
  assert.match(screen, /labor-matrix-scroll/)
})

test('print keeps the eight columns and totals, omitting editing controls and person totals', () => {
  const print = renderToStaticMarkup(React.createElement(Matrix, { ...props, print: true }))
  assert.equal((print.match(/scope="col"/g) || []).length, 8)
  assert.match(print, /Fixture Employee/)
  assert.match(print, /Weekly total<small>21.00 h/)
  assert.doesNotMatch(print, /labor-person-total|<button|labor-matrix-scroll/)
  const css = readFileSync(new URL('../src/pages/weeklyLaborPlanner.css', import.meta.url), 'utf8')
  assert.match(css, /@page labor-weekly\s*{\s*size: letter landscape/)
  assert.match(css, /display: table-header-group/)
})
