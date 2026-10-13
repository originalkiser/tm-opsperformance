import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fmtNum } from '../src/utils/format.js'

test('Copy preserves entered numeric/string zeros while blank cells and calculated zeros stay blank', async () => {
  const source = readFileSync(new URL('../src/components/DailyLogTable.jsx', import.meta.url), 'utf8')
  const start = source.indexOf('  const copyTableAsImage = async () => {')
  const end = source.indexOf('  // ── Paste from table', start)
  const copiedText = [], drawn = []
  let completed
  const ctx = new Proxy({}, { get: (_, key) => key === 'fillText' ? (value, x, y) => drawn.push({ value, x, y }) : () => {} })
  const canvas = { getContext: () => ctx, toBlob(callback) { completed = callback({}) } }
  const navigator = { clipboard: { async write() { throw new Error('Image clipboard unavailable') }, async writeText(text) { copiedText.push(text) } } }
  const columns = [{ key: 'total_washes', label: 'Total\nWashes' }, { key: 'basic', label: 'Basic' }]
  const rows = [{ row: { time_slot: '08:00:00', total_washes: 0, basic: '0' } }, { row: { time_slot: '09:00:00', total_washes: 12, basic: '' } }]
  const compute = row => ({ memberships_sold: 0, opportunities: Number(row.total_washes), p_mix: '', conversion: Number(row.total_washes) ? '0.0%' : '' })
  const run = new Function('document', 'navigator', 'ClipboardItem', 'orderedCols', 'displayRows', 'compute', 'opportunitiesFormula', 'TIME_SLOTS', 'groupInfo', 'toInt', 'totals', 'totComputed', 'fmtNum', 'selectedDate', 'locationName', 'metricThresholds', 'setCopyFeedback', 'setTimeout', source.slice(start, end) + '\nreturn copyTableAsImage()')
  await run({ createElement: () => canvas }, navigator, class {}, columns, rows, compute, 'detailed', [{ value: '08:00:00', label: '8:00 AM' }, { value: '09:00:00', label: '9:00 AM' }], { '08:00:00': { first: 0 }, '09:00:00': { first: 1 } }, value => Math.max(0, parseInt(value) || 0), { total_washes: 12, basic: 0 }, { memberships_sold: 0, opportunities: 12, p_mix: '', conversion: '0.0%' }, fmtNum, '2026-10-13', 'Fictional Wash', null, () => {}, () => {})
  await completed
  // Only the two explicitly entered zeros render; calculated zero counts stay blank.
  assert.equal(drawn.filter(cell => cell.y === 88 && cell.value === '0').length, 2)
  assert.equal(drawn.filter(cell => cell.y === 136 && cell.value === '0').length, 0)
  const lines = copiedText[0].split('\n').map(line => line.split('\t'))
  assert.deepEqual(lines[1].slice(2), ['0', '0', '', '', '', ''])
  assert.deepEqual(lines[2].slice(2), ['12', '', '', '12', '', '0.0%'])
})
