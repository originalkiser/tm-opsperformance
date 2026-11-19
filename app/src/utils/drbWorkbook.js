// Values-only DRB XLSX reader, reused from the local import prototype.
const fail = message => { throw new Error(message) }
const text = value => String(value ?? '').trim()
export async function readDrbWorkbook(buffer) {
  if (buffer.byteLength > 10_000_000) fail('Choose a workbook up to 10 MB.')
  // Read the original XML: census exports use namespace prefixes and omit
  // cell references, which ExcelJS does not support. Preserve exact ID strings.
  const { default: JSZip } = await import('jszip')
  const { SaxesParser } = await import('saxes')
  const zip = await JSZip.loadAsync(buffer)
  if (Object.keys(zip.files).some(path => /comments.*\.xml$/i.test(path))) fail('Workbook comments require separate review. Export their reasons into values before importing.')
  let size = 0
  for (const file of Object.values(zip.files)) {
    if (file.dir) continue
    size += file._data?.uncompressedSize || 0
    if (size > 40_000_000 || Object.keys(zip.files).length > 300) fail('Workbook is too large after decompression.')
  }
  const read = async path => {
    const file = zip.file(path)
    if (!file) fail('Missing Excel part: ' + path)
    const source = await file.async('string')
    if (source.length > 40_000_000 || /<!DOCTYPE|<!ENTITY/i.test(source)) fail('Unsupported Excel XML.')
    const root = { children: [] }, stack = [root], parser = new SaxesParser({ xmlns: true })
    parser.on('opentag', tag => {
      const node = { name: tag.local, attrs: Object.fromEntries(Object.values(tag.attributes).map(a => [a.local === 'id' && a.uri.includes('relationships') ? 'relationshipId' : a.local, a.value])), children: [], text: '' }
      stack.at(-1).children.push(node); stack.push(node)
      if (stack.length > 30) fail('Excel XML nesting limit exceeded.')
    })
    parser.on('text', value => { stack.at(-1).text += value })
    parser.on('closetag', () => { stack.pop() })
    parser.write(source).close()
    return root
  }
  const find = (node, name) => node.children.flatMap(c => [...(c.name === name ? [c] : []), ...find(c, name)])
  const content = node => (node.text || '') + node.children.map(content).join('')
  const workbook = await read('xl/workbook.xml'), sheets = find(workbook, 'sheet')
  if (sheets.length !== 1) fail('Expected a single Export worksheet.')
  const relations = find(await read('xl/_rels/workbook.xml.rels'), 'Relationship')
  const relation = relations.find(r => r.attrs.Id === sheets[0].attrs.relationshipId)
  if (!relation || relation.attrs.TargetMode === 'External' || /\.\.|\\|:/.test(relation.attrs.Target)) fail('Invalid worksheet relationship.')
  const target = relation.attrs.Target.startsWith('/') ? relation.attrs.Target.slice(1) : 'xl/' + relation.attrs.Target
  const strings = zip.file('xl/sharedStrings.xml') ? find(await read('xl/sharedStrings.xml'), 'si').map(content) : []
  const tree = await read(target), matrix = [], numericCells = []
  for (const row of find(tree, 'row')) {
    const rowIndex = row.attrs.r ? Number(row.attrs.r) - 1 : matrix.length
    if (!Number.isSafeInteger(rowIndex) || rowIndex < 0 || rowIndex > 20000 || matrix[rowIndex]) fail('Invalid, duplicate or oversized Excel row.')
    while (matrix.length < rowIndex) matrix.push([])
    const values = [], numeric = new Set()
    for (const cell of row.children.filter(c => c.name === 'c')) {
      let col = values.length
      if (cell.attrs.r) {
        const ref = cell.attrs.r.match(/^([A-Z]+)(\d+)$/)
        if (!ref || Number(ref[2]) !== rowIndex + 1) fail('Invalid cell reference.')
        col = [...ref[1]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1
      }
      if (col > 49 || col < 0 || Object.hasOwn(values, col)) fail('Duplicate or oversized Excel column.')
      if (find(cell, 'f').length || cell.attrs.t === 'e') fail('Import an export containing values, not formulas or errors.')
      const raw = cell.children.find(c => c.name === 'v')?.text || ''
      if (cell.attrs.t === 's') {
        if (!/^\d+$/.test(raw) || strings[Number(raw)] == null) fail('Invalid shared string.')
        values[col] = strings[Number(raw)]
      } else if (cell.attrs.t === 'inlineStr') values[col] = find(cell, 't').map(content).join('')
      else if (!cell.attrs.t || cell.attrs.t === 'n') { values[col] = raw; numeric.add(col) }
      else if (cell.attrs.t === 'str' || cell.attrs.t === 'd') values[col] = raw
      else fail('Unsupported spreadsheet cell type.')
    }
    matrix[rowIndex] = values; numericCells[rowIndex] = numeric
  }
  if (!matrix.length) fail('Empty workbook.')
  const dateColumn = matrix[0].findIndex(v => text(v) === 'LOGDATE')
  const date1904 = find(workbook, 'workbookPr').some(n => ['1', 'true'].includes(n.attrs.date1904))
  if (dateColumn >= 0) for (let row = 1; row < matrix.length; row++) {
    const value = matrix[row][dateColumn]
    if (value && numericCells[row]?.has(dateColumn)) {
      if (!/^\d+$/.test(value) || Number(value) > 100000) fail('Invalid Excel sale date.')
      matrix[row][dateColumn] = new Date(Date.UTC(date1904 ? 1904 : 1899, date1904 ? 0 : 11, date1904 ? 1 : 30) + Number(value) * 86400000).toISOString().slice(0, 10)
    }
  }
  return matrix
}
