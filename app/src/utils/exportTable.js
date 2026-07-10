// Styled table exports (CSV / Excel / PDF) for the dashboard tables.
// Excel and PDF reproduce the on-screen conditional formatting: green/orange
// P-Mix and red/yellow/green Conversion cells, always in light-mode colors.
// exceljs and jspdf are loaded on demand so they stay out of the main bundle.

import { DEFAULT_THRESHOLDS } from './metricColors'

// ── Palette (light-mode Tailwind hexes used by the live tables) ───────────────

const BRAND_BLUE = '1A3555' // tm-blue table header
const ALT_ROW    = 'F0F9F8' // even-row tint
const TOTALS_ROW = 'E9F6F5' // tm-sky/25 over white

const PMIX = {
  green:        { bg: 'DCFCE7', fg: '166534' }, // green-100 / green-800
  orange:       { bg: 'FFF7ED', fg: '9A3412' }, // orange-50 / orange-800
  greenTotals:  { bg: 'BBF7D0', fg: '14532D' }, // green-200 / green-900
  orangeTotals: { bg: 'FFEDD5', fg: '9A3412' }, // orange-100 / orange-800
}

const CONV = {
  red:          { bg: 'FEE2E2', fg: 'B91C1C' }, // red-100 / red-700
  yellow:       { bg: 'FEF9C3', fg: 'A16207' }, // yellow-100 / yellow-700
  green:        { bg: 'DCFCE7', fg: '166534' },
  redTotals:    { bg: 'FECACA', fg: '991B1B' }, // red-200 / red-800
  yellowTotals: { bg: 'FEF08A', fg: '854D0E' }, // yellow-200 / yellow-800
  greenTotals:  { bg: 'BBF7D0', fg: '14532D' },
}

// value is the display string ("62.0%" or ""); returns { bg, fg } or null
function cellColors(type, value, isTotals, thresholds) {
  if (type !== 'pmix' && type !== 'conv') return null
  const n = parseFloat(value)
  if (type === 'pmix') {
    const green = thresholds?.pmix_green ?? DEFAULT_THRESHOLDS.pmix_green
    const ok = !isNaN(n) && n >= green
    if (isTotals) return ok ? PMIX.greenTotals : PMIX.orangeTotals
    return ok ? PMIX.green : PMIX.orange
  }
  const red    = thresholds?.conv_red    ?? DEFAULT_THRESHOLDS.conv_red
  const yellow = thresholds?.conv_yellow ?? DEFAULT_THRESHOLDS.conv_yellow
  if (isNaN(n))     return isTotals ? PMIX.orangeTotals : PMIX.orange
  if (n < red)      return isTotals ? CONV.redTotals    : CONV.red
  if (n < yellow)   return isTotals ? CONV.yellowTotals : CONV.yellow
  return isTotals ? CONV.greenTotals : CONV.green
}

const hexToRgb = (hex) => [
  parseInt(hex.slice(0, 2), 16),
  parseInt(hex.slice(2, 4), 16),
  parseInt(hex.slice(4, 6), 16),
]

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a   = document.createElement('a')
  a.href     = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ── CSV ───────────────────────────────────────────────────────────────────────

// Leading BOM so Excel opens the file as UTF-8.
export function exportCsv({ filename, columns, rows, totalsRow }) {
  const esc = (v) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const all = [columns.map(c => c.label), ...rows, totalsRow]
  const csv = all.map(r => r.map(esc).join(',')).join('\r\n')
  saveBlob(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }), filename + '.csv')
}

// ── Excel ─────────────────────────────────────────────────────────────────────

export async function exportXlsx({ filename, title, subtitle, columns, rows, totalsRow, thresholds }) {
  const mod     = await import('exceljs')
  const ExcelJS = mod.default ?? mod
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(title.slice(0, 31))

  const titleRow = ws.addRow([title])
  titleRow.getCell(1).font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FF' + BRAND_BLUE } }
  const subRow = ws.addRow([subtitle])
  subRow.getCell(1).font = { name: 'Calibri', size: 10, color: { argb: 'FF6B7280' } }
  ws.addRow([])

  const thin   = { style: 'thin', color: { argb: 'FFD1D5DB' } }
  const border = { top: thin, left: thin, bottom: thin, right: thin }

  const headerRow = ws.addRow(columns.map(c => c.label))
  headerRow.eachCell(cell => {
    cell.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + BRAND_BLUE } }
    cell.font   = { size: 10, bold: true, color: { argb: 'FFFFFFFF' } }
    cell.border = border
    cell.alignment = { horizontal: 'center' }
  })

  const styleDataRow = (excelRow, values, isTotals, rowIdx) => {
    excelRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const type   = columns[colNumber - 1]?.type
      const colors = cellColors(type, values[colNumber - 1], isTotals, thresholds)
      cell.border = border
      cell.font   = { size: 10, bold: isTotals || !!colors }
      if (type === 'num') cell.numFmt = '#,##0'
      if (colors) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + colors.bg } }
        cell.font = { ...cell.font, color: { argb: 'FF' + colors.fg } }
      } else if (isTotals) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + TOTALS_ROW } }
      } else if (rowIdx % 2 === 0) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + ALT_ROW } }
      }
      if (type !== 'text') cell.alignment = { horizontal: 'center' }
    })
  }

  rows.forEach((r, i) => styleDataRow(ws.addRow(r), r, false, i))
  styleDataRow(ws.addRow(totalsRow), totalsRow, true, rows.length)

  columns.forEach((c, i) => {
    const maxLen = Math.max(c.label.length, ...rows.map(r => String(r[i] ?? '').length))
    ws.getColumn(i + 1).width = Math.min(30, Math.max(12, maxLen + 4))
  })
  ws.views = [{ state: 'frozen', ySplit: 4 }]

  const buf = await wb.xlsx.writeBuffer()
  saveBlob(
    new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    filename + '.xlsx',
  )
}

// ── PDF ───────────────────────────────────────────────────────────────────────

export async function exportPdf({ filename, title, subtitle, columns, rows, totalsRow, thresholds }) {
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt' })

  doc.setFontSize(16)
  doc.setFont(undefined, 'bold')
  doc.setTextColor(...hexToRgb(BRAND_BLUE))
  doc.text(title, 40, 42)
  doc.setFontSize(10)
  doc.setFont(undefined, 'normal')
  doc.setTextColor(107, 114, 128)
  doc.text(subtitle, 40, 58)

  const body = [...rows, totalsRow].map(r =>
    r.map((v, i) => (columns[i]?.type === 'num' && typeof v === 'number') ? v.toLocaleString('en-US') : v)
  )
  autoTable(doc, {
    startY: 72,
    head: [columns.map(c => c.label)],
    body,
    styles:        { fontSize: 8, cellPadding: 5, lineColor: [209, 213, 219], lineWidth: 0.5 },
    headStyles:    { fillColor: hexToRgb(BRAND_BLUE), textColor: 255, fontStyle: 'bold', halign: 'center' },
    alternateRowStyles: { fillColor: hexToRgb(ALT_ROW) },
    didParseCell: (data) => {
      if (data.section !== 'body') return
      const isTotals = data.row.index === body.length - 1
      const type     = columns[data.column.index]?.type
      if (type !== 'text') data.cell.styles.halign = 'center'
      if (isTotals) {
        data.cell.styles.fontStyle = 'bold'
        data.cell.styles.fillColor = hexToRgb(TOTALS_ROW)
      }
      const colors = cellColors(type, data.cell.raw, isTotals, thresholds)
      if (colors) {
        data.cell.styles.fillColor = hexToRgb(colors.bg)
        data.cell.styles.textColor = hexToRgb(colors.fg)
        data.cell.styles.fontStyle = 'bold'
      }
    },
  })
  doc.save(filename + '.pdf')
}
