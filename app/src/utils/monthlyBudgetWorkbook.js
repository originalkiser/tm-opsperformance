// Same layout/controls as preview_november_budget.py; raw XML avoids IEEE-754 loss.
import JSZip from 'jszip'
import { SaxesParser } from 'saxes'

export function decimal(value) {
  const match = String(value).match(/^(\d+)(?:\.(\d*))?(?:[Ee]([+-]?\d+))?$/)
  if (!match || String(value).length > 100) throw new Error('Invalid nonnegative decimal budget value')
  const exponent = Number(match[3] || 0), digits = match[1] + (match[2] || '')
  const position = match[1].length + exponent
  if (Math.abs(exponent) > 100) throw new Error('Budget value out of range')
  const expanded = position <= 0 ? '0.' + '0'.repeat(-position) + digits : position >= digits.length ? digits + '0'.repeat(position - digits.length) : digits.slice(0, position) + '.' + digits.slice(position)
  const [whole, fraction = ''] = expanded.split('.')
  return whole.replace(/^0+(?=\d)/, '') + (fraction.replace(/0+$/, '') ? '.' + fraction.replace(/0+$/, '') : '')
}
const units = (v, scale) => { const [w, f = ''] = decimal(v).split('.'); return BigInt(w + f.padEnd(scale, '0')) }
export function sumDecimals(values) {
  const clean = values.map(decimal), scale = Math.max(0, ...clean.map(x => x.split('.')[1]?.length || 0))
  const text = clean.reduce((n, v) => n + units(v, scale), 0n).toString().padStart(scale + 1, '0')
  return decimal(scale ? text.slice(0, -scale) + '.' + text.slice(-scale) : text)
}
const reconciles = (a, b) => { const scale = Math.max(6, ...[a,b].map(x => decimal(x).split('.')[1]?.length || 0)); const diff = units(a, scale) - units(b, scale); return (diff < 0n ? -diff : diff) <= 10n ** BigInt(scale - 6) }
const column = n => { let out = ''; for (; n; n = Math.floor((n - 1) / 26)) out = String.fromCharCode(65 + (n - 1) % 26) + out; return out }
export const monthDays = month => new Date(Date.UTC(Number(month.slice(0,4)), Number(month.slice(5,7)), 0)).getUTCDate()
function xml(text) {
  if (text.length > 20_000_000 || /<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('Unsupported or oversized Excel XML')
  const root = { children: [] }, stack = [root], parser = new SaxesParser({ xmlns: true })
  parser.on('opentag', tag => { const node = { name: tag.local, attrs: Object.fromEntries(Object.values(tag.attributes).map(a => [a.name, a.value])), children: [], text: '' }; stack.at(-1).children.push(node); stack.push(node) })
  parser.on('text', text => { stack.at(-1).text += text })
  parser.on('closetag', () => { stack.pop() })
  parser.write(text).close()
  return root
}
const find = (node, name) => node.children.flatMap(n => [...(n.name === name ? [n] : []), ...find(n, name)])
const content = node => node.text + node.children.map(content).join('')
export async function parseMonthlyBudget(buffer) {
  if (buffer.byteLength > 10_000_000) throw new Error('Workbook exceeds 10 MB')
  const zip = await JSZip.loadAsync(buffer)
  const read = async path => { const file = zip.file(path); if (!file) throw new Error('Missing Excel part: ' + path); return xml(await file.async('string')) }
  const book = await read('xl/workbook.xml')
  const date1904 = find(book, 'workbookPr').some(n => ['1','true'].includes(n.attrs.date1904))
  const relationships = Object.fromEntries(find(await read('xl/_rels/workbook.xml.rels'), 'Relationship').map(n => [n.attrs.Id, n.attrs.Target]))
  const strings = zip.file('xl/sharedStrings.xml') ? find(await read('xl/sharedStrings.xml'), 'si').map(content) : []
  const sheets = []
  for (const sheet of find(book, 'sheet')) {
    const target = relationships[sheet.attrs['r:id']]
    if (!target || target.includes('..') || /^\w+:/.test(target)) throw new Error('Invalid Excel worksheet reference')
    const tree = await read(target.startsWith('/') ? target.slice(1) : 'xl/' + target)
    const cells = new Map()
    for (const c of find(tree, 'c')) {
      if (cells.has(c.attrs.r)) throw new Error('Duplicate Excel cell')
      const v = c.children.find(n => n.name === 'v')
      if (c.attrs.t === 'e' || (c.children.some(n => n.name === 'f') && !v)) throw new Error('Workbook formula has no valid cached result; recalculate in Excel')
      const value = c.attrs.t === 's' ? strings[Number(v?.text)] : c.attrs.t === 'inlineStr' ? content(c) : v?.text
      if (value != null) cells.set(c.attrs.r, { value, numeric: !c.attrs.t || c.attrs.t === 'n' })
    }
    sheets.push({ name: sheet.attrs.name, cells })
  }
  return parseBudgetSheets(sheets, date1904)
}

export function parseBudgetSheets(sheets, date1904 = false) {
  const plans = sheets.filter(s => /plan$/i.test(s.name.trim()))
  const labor = sheets.find(s => s.name.trim() === 'Labor and Membership Goals')
  if (plans.length !== 1 || !labor) throw new Error('Expected one monthly Plan sheet and Labor and Membership Goals')
  const cells = plans[0].cells, value = (map, address) => map.get(address)?.value
  const number = (map, address) => { const cell = map.get(address); if (!cell?.numeric) throw new Error('Missing numeric budget cell ' + address); return decimal(cell.value) }
  const date = serial => { if (serial == null || !Number.isSafeInteger(Number(serial)) || Number(serial) < 0 || Number(serial) > 2958465) return null; const ms = Date.UTC(date1904 ? 1904 : 1899, date1904 ? 0 : 11, date1904 ? 1 : 30) + Number(serial) * 86400000; const d = new Date(ms); return Number.isFinite(d.valueOf()) ? d.toISOString().slice(0,10) : null }
  const first = date(value(cells, 'C3'))
  if (!first || !/^\d{4}-\d{2}-01$/.test(first) || first < '1900-01-01' || first > '9999-12-01') throw new Error('Invalid budget month')
  const days = monthDays(first), blocks = []
  for (const [address, cell] of cells) if (/^C\d+$/.test(address) && cell.numeric && date(cell.value) === first && !/^\d{4}$/.test(String(value(cells,'A'+address.slice(1))))) {
    const row = Number(address.slice(1))
    if (/^\d{4}$/.test(String(value(cells,'A'+(row+1))))) blocks.push(row)
  }
  blocks.sort((a,b) => a-b)
  if (blocks.length !== 3) throw new Error('Expected Total, Retail and Recurring daily blocks')
  const sites = new Map()
  blocks.forEach((header, block) => {
    const category = ['total','retail','recurring'][block], seen = new Set()
    for (let day = 1; day <= days; day++) {
      const expected = first.slice(0,8) + String(day).padStart(2,'0')
      if (date(value(cells, column(day+2)+header)) !== expected) throw new Error('Incomplete or duplicate business dates')
    }
    // Undated zero padding columns are allowed; extra dated columns are not.
    for (let col = days+3; col <= 40; col++) {
      const extra = cells.get(column(col)+header)
      if (extra?.numeric && Number(extra.value) > 30000 && Number(extra.value) < 80000) throw new Error('Unexpected extra business date')
    }
    let row = header + 1
    for (; /^\d{4}$/.test(String(value(cells, 'A'+row))); row++) {
      const site = String(value(cells,'A'+row)); if (seen.has(site)) throw new Error('Duplicate site in revenue block'); seen.add(site)
      if (block === 0) sites.set(site,{ site, daily: Array.from({length:days},(_,i)=>({business_date:first.slice(0,8)+String(i+1).padStart(2,'0')})) })
      const record = sites.get(site); if (!record) throw new Error('Revenue site sets do not match')
      const amounts = record.daily.map((d,i) => (d[category] = number(cells,column(i+3)+row)))
      const total = sumDecimals(amounts)
      if (!reconciles(total,number(cells,'B'+row)) || !reconciles(total,number(cells,column(days+4)+row))) throw new Error('Site monthly revenue control mismatch')
    }
    if (seen.size !== sites.size || !seen.size || seen.size > 200) throw new Error('Revenue site coverage mismatch')
    for (let day=1;day<=days;day++) if (!reconciles(sumDecimals([...sites.values()].map(s=>s.daily[day-1][category])),number(cells,column(day+2)+row))) throw new Error('Network daily revenue control mismatch')
  })
  const seenLabor = new Set()
  for (const [address, cell] of labor.cells) if (/^A\d+$/.test(address) && /^\d{4}$/.test(String(cell.value))) {
    const row = address.slice(1), record=sites.get(String(cell.value)); if (!record || seenLabor.has(record.site)) throw new Error('Labor site coverage mismatch'); seenLabor.add(record.site)
    const percentage = labor.cells.get('D'+row)
    if (['1508','1511'].includes(record.site)) {
      record.percentage=number(labor.cells,'D'+row)
      if (Number(record.percentage)>1 || ['B','C'].some(c=>value(labor.cells,c+row) != null && value(labor.cells,c+row)!=='')) throw new Error('Invalid full-service labor method')
      record.hours='0';record.hours_with_manager='0'
    } else {
      if (percentage && percentage.value!=='') throw new Error('Express site has percentage labor')
      record.hours=number(labor.cells,'B'+row);record.hours_with_manager=number(labor.cells,'C'+row);record.percentage=null
      if (sumDecimals([record.hours,'45'])!==record.hours_with_manager) throw new Error('Express manager hours must add 45')
    }
  }
  if (seenLabor.size!==sites.size) throw new Error('Missing labor budgets')
  for (const record of sites.values()) {
    for (const d of record.daily) if (!reconciles(d.total,sumDecimals([d.retail,d.recurring]))) throw new Error('Total / Retail / Recurring mismatch')
    record.revenue_goal=sumDecimals(record.daily.map(d=>d.total))
  }
  return { month:first, sites:[...sites.values()], totals:Object.fromEntries(['total','retail','recurring'].map(k=>[k,sumDecimals([...sites.values()].flatMap(s=>s.daily.map(d=>d[k])))])) }
}
