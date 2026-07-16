// Styled exports (CSV / Excel / PDF) for the dashboard tables and trend charts.
// Excel and PDF reproduce the on-screen conditional formatting: green/orange
// P-Mix and red/yellow/green Conversion cells, always in light-mode colors.
// Charts are drawn to an offscreen canvas (light mode) and embedded as images.
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
  if (value === '' || value == null || isNaN(n)) return null
  if (type === 'pmix') {
    const green = thresholds?.pmix_green ?? DEFAULT_THRESHOLDS.pmix_green
    const ok = n >= green
    if (isTotals) return ok ? PMIX.greenTotals : PMIX.orangeTotals
    return ok ? PMIX.green : PMIX.orange
  }
  const red    = thresholds?.conv_red    ?? DEFAULT_THRESHOLDS.conv_red
  const yellow = thresholds?.conv_yellow ?? DEFAULT_THRESHOLDS.conv_yellow
  if (n < red)    return isTotals ? CONV.redTotals    : CONV.red
  if (n < yellow) return isTotals ? CONV.yellowTotals : CONV.yellow
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
  const all = [columns.map(c => c.label), ...rows, ...(totalsRow ? [totalsRow] : [])]
  const csv = all.map(r => r.map(esc).join(',')).join('\r\n')
  saveBlob(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }), filename + '.csv')
}

// ── Excel helpers ─────────────────────────────────────────────────────────────

// Writes title + subtitle + a styled table into a worksheet. Returns nothing.
function addStyledSheet(ws, { title, subtitle, columns, rows, totalsRow, thresholds }) {
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
  if (totalsRow) styleDataRow(ws.addRow(totalsRow), totalsRow, true, rows.length)

  columns.forEach((c, i) => {
    const maxLen = Math.max(c.label.length, ...rows.map(r => String(r[i] ?? '').length))
    ws.getColumn(i + 1).width = Math.min(30, Math.max(12, maxLen + 4))
  })
  ws.views = [{ state: 'frozen', ySplit: 4 }]
}

async function loadExcelJS() {
  const mod = await import('exceljs')
  return mod.default ?? mod
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

// ── Excel (table) ─────────────────────────────────────────────────────────────

export async function exportXlsx({ filename, title, subtitle, columns, rows, totalsRow, thresholds }) {
  const ExcelJS = await loadExcelJS()
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(title.slice(0, 31))
  addStyledSheet(ws, { title, subtitle, columns, rows, totalsRow, thresholds })
  const buf = await wb.xlsx.writeBuffer()
  saveBlob(new Blob([buf], { type: XLSX_MIME }), filename + '.xlsx')
}

// ── PDF helpers ───────────────────────────────────────────────────────────────

function pdfHeader(doc, title, subtitle) {
  doc.setFontSize(16)
  doc.setFont(undefined, 'bold')
  doc.setTextColor(...hexToRgb(BRAND_BLUE))
  doc.text(title, 40, 42)
  doc.setFontSize(10)
  doc.setFont(undefined, 'normal')
  doc.setTextColor(107, 114, 128)
  doc.text(subtitle, 40, 58)
}

function pdfStyledTable(doc, autoTable, { columns, rows, totalsRow, thresholds }, startY) {
  const raw  = totalsRow ? [...rows, totalsRow] : rows
  const body = raw.map(r =>
    r.map((v, i) => (columns[i]?.type === 'num' && typeof v === 'number') ? v.toLocaleString('en-US') : v)
  )
  autoTable(doc, {
    startY,
    head: [columns.map(c => c.label)],
    body,
    styles:        { fontSize: 8, cellPadding: 5, lineColor: [209, 213, 219], lineWidth: 0.5 },
    headStyles:    { fillColor: hexToRgb(BRAND_BLUE), textColor: 255, fontStyle: 'bold', halign: 'center' },
    alternateRowStyles: { fillColor: hexToRgb(ALT_ROW) },
    didParseCell: (data) => {
      if (data.section !== 'body') return
      const isTotals = !!totalsRow && data.row.index === body.length - 1
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
}

// ── PDF (table) ───────────────────────────────────────────────────────────────

export async function exportPdf({ filename, title, subtitle, columns, rows, totalsRow, thresholds }) {
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt' })
  pdfHeader(doc, title, subtitle)
  pdfStyledTable(doc, autoTable, { columns, rows, totalsRow, thresholds }, 72)
  doc.save(filename + '.pdf')
}

// ── Offscreen chart renderer (always light mode) ──────────────────────────────

const CHART_W = 800
const CHART_H = 420

function niceCeil(v) {
  if (v <= 10) return 10
  const mag  = Math.pow(10, Math.floor(Math.log10(v)))
  const norm = v / mag
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10
  return nice * mag
}

// spec: { title, dataKey, type: 'bar'|'line', isPct, color, colorFn }
// data: chartData rows [{ label, tw, mw, ms, gr, conversion, pmix }]
function renderChartPng(spec, data) {
  const { title, dataKey, type = 'bar', isPct = false, color, colorFn } = spec
  const PAD_L = 68, PAD_R = 24, PAD_T = 56, PAD_B = 44

  const canvas  = document.createElement('canvas')
  canvas.width  = CHART_W
  canvas.height = CHART_H
  const ctx = canvas.getContext('2d')

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, CHART_W, CHART_H)

  ctx.fillStyle = '#' + BRAND_BLUE
  ctx.font = 'bold 18px "Chakra Petch", Arial, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText(title, PAD_L, 32)

  const vals = data.map(d => d[dataKey]).filter(v => v != null)
  const plotW = CHART_W - PAD_L - PAD_R
  const plotH = CHART_H - PAD_T - PAD_B

  if (!vals.length) {
    ctx.fillStyle = '#9ca3af'
    ctx.font = '14px "Chakra Petch", Arial, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('No data', PAD_L + plotW / 2, PAD_T + plotH / 2)
    return canvas.toDataURL('image/png')
  }

  const yMax = isPct
    ? Math.max(10, Math.ceil(Math.max(...vals) / 10) * 10)
    : niceCeil(Math.max(...vals))

  // Gridlines + y-axis labels
  const TICKS = 5
  ctx.font = '12px "Chakra Petch", Arial, sans-serif'
  for (let i = 0; i <= TICKS; i++) {
    const v = yMax * i / TICKS
    const y = PAD_T + plotH - (v / yMax) * plotH
    ctx.strokeStyle = i === 0 ? '#d1d5db' : '#f0f0f0'
    ctx.beginPath()
    ctx.moveTo(PAD_L, y)
    ctx.lineTo(PAD_L + plotW, y)
    ctx.stroke()
    ctx.fillStyle = '#6B7280'
    ctx.textAlign = 'right'
    ctx.fillText(isPct ? `${v}%` : Math.round(v).toLocaleString('en-US'), PAD_L - 8, y + 4)
  }

  const n    = data.length
  const step = plotW / n

  // X-axis labels (thin out when crowded)
  const every = Math.ceil(n / 12)
  ctx.fillStyle = '#6B7280'
  ctx.textAlign = 'center'
  data.forEach((d, i) => {
    if (i % every) return
    ctx.fillText(d.label, PAD_L + step * (i + 0.5), PAD_T + plotH + 20)
  })

  const xC = (i) => PAD_L + step * (i + 0.5)
  const yC = (v) => PAD_T + plotH - (v / yMax) * plotH

  if (type === 'bar') {
    const bw = Math.min(40, Math.max(4, step * 0.6))
    data.forEach((d, i) => {
      const v = d[dataKey]
      if (v == null || v <= 0) return
      ctx.fillStyle = colorFn ? colorFn(v) : color
      ctx.fillRect(xC(i) - bw / 2, yC(v), bw, PAD_T + plotH - yC(v))
    })
  } else {
    ctx.strokeStyle = colorFn ? '#9ca3af' : color
    ctx.lineWidth = 2
    ctx.beginPath()
    let started = false
    data.forEach((d, i) => {
      const v = d[dataKey]
      if (v == null) { started = false; return }
      if (!started) { ctx.moveTo(xC(i), yC(v)); started = true }
      else ctx.lineTo(xC(i), yC(v))
    })
    ctx.stroke()
    data.forEach((d, i) => {
      const v = d[dataKey]
      if (v == null) return
      ctx.fillStyle = colorFn ? colorFn(v) : color
      ctx.beginPath()
      ctx.arc(xC(i), yC(v), 4.5, 0, Math.PI * 2)
      ctx.fill()
    })
  }

  return canvas.toDataURL('image/png')
}

// ── Trends export (charts + optional table) ───────────────────────────────────
// spec: { filename, title, subtitle, charts: [chartSpec], data, columns, rows,
//         totalsRow?, thresholds, includeTable }

export async function exportTrendsXlsx(spec) {
  const { filename, title, subtitle, charts, data, columns, rows, totalsRow, thresholds, includeTable } = spec
  const ExcelJS = await loadExcelJS()
  const wb = new ExcelJS.Workbook()

  const ws = wb.addWorksheet('Charts')
  const titleRow = ws.addRow([title])
  titleRow.getCell(1).font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FF' + BRAND_BLUE } }
  const subRow = ws.addRow([subtitle])
  subRow.getCell(1).font = { name: 'Calibri', size: 10, color: { argb: 'FF6B7280' } }

  // Two charts per row, sized 480×252 px (row height defaults to 20px)
  const IMG_W = 480, IMG_H = 252
  const ROWS_PER_BAND = 14
  charts.forEach((chartSpec, i) => {
    const png   = renderChartPng(chartSpec, data)
    const imgId = wb.addImage({ base64: png.split(',')[1], extension: 'png' })
    const col   = (i % 2) * 8
    const row   = 3 + Math.floor(i / 2) * ROWS_PER_BAND
    ws.addImage(imgId, { tl: { col, row }, ext: { width: IMG_W, height: IMG_H } })
  })

  if (includeTable) {
    const dataWs = wb.addWorksheet('Data')
    addStyledSheet(dataWs, { title, subtitle, columns, rows, totalsRow, thresholds })
  }

  const buf = await wb.xlsx.writeBuffer()
  saveBlob(new Blob([buf], { type: XLSX_MIME }), filename + '.xlsx')
}

export async function exportTrendsPdf(spec) {
  const { filename, title, subtitle, charts, data, columns, rows, totalsRow, thresholds, includeTable } = spec
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt' })

  pdfHeader(doc, title, subtitle)

  // 2×2 chart grid per page, preserving the 800:420 aspect ratio
  const IMG_W = 360, IMG_H = 189, GAP = 22, MARGIN = 40
  const START_Y = 76
  charts.forEach((chartSpec, i) => {
    const slot = i % 4
    if (i > 0 && slot === 0) {
      doc.addPage()
      pdfHeader(doc, title, subtitle)
    }
    const png = renderChartPng(chartSpec, data)
    const x = MARGIN + (slot % 2) * (IMG_W + GAP)
    const y = START_Y + Math.floor(slot / 2) * (IMG_H + GAP)
    doc.addImage(png, 'PNG', x, y, IMG_W, IMG_H)
  })

  if (includeTable) {
    const autoTable = (await import('jspdf-autotable')).default
    doc.addPage()
    pdfHeader(doc, title, subtitle)
    pdfStyledTable(doc, autoTable, { columns, rows, totalsRow, thresholds }, 72)
  }

  doc.save(filename + '.pdf')
}
