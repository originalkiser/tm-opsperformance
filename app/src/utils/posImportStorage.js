import { matchPosLocations, parseDailyPosFile, readPosComparisons } from './dailyPosImport.js'

export const POS_START = '2026-11-01'
export const POS_PARSER_VERSION = 'daily-pos-v2.0.0'
const integer = value => Number.isSafeInteger(value) ? value : null
const quantity = value => Number.isSafeInteger(value) && value >= 0 ? value : null

export function posDocument(row) {
  const m = row.metrics, p = row.reportMetrics
  return {
    metrics: {
      total: integer(m.revenue), member: integer(p.memberRevenue), retail: integer(p.retailRevenue),
      payments: integer(m.payments), cards: integer(m.cards), house: integer(m.house), other: integer(m.other),
      cash: integer(m.cash), reportedCash: integer(m.reportedCash), balance: integer(m.reportBalance),
      washes: quantity(m.washes), governmentWashes: quantity(m.governmentWashes), policeWashes: quantity(m.policeWashes), opportunities: quantity(m.opportunities), redemptions: quantity(m.redemptions),
      overrides: quantity(m.overrides), memberships: quantity(m.memberships),
      basicSold: quantity(m.basic), goodSold: quantity(m.good), betterSold: quantity(m.better), bestSold: quantity(m.best),
      recharges: quantity(m.recharges), terminations: quantity(m.terminations),
      premiumSold: m.better == null || m.best == null ? null : quantity(m.better + m.best),
      unclassifiedSold: quantity(m.unclassified), premiumRetail: p.retailComplete ? quantity(p.premiumRetail) : null,
      eligibleRetail: p.retailComplete ? quantity(p.eligibleRetail) : null,
      premiumRedeemed: p.redemptionComplete ? quantity(p.redeem.better + p.redeem.best) : null,
      unclassifiedRedeemed: p.redemptionComplete ? quantity(p.redeem.unclassified) : null,
    },
    sources: {
      signedAmounts: row.signedAmounts, washCount: row.washCount ?? null,
      memberships: m.membershipAmounts, redemptionTiers: p.redeem, quantityDifferences: row.quantityDifferences ?? [],
      report: p.sources,
    },
    warnings: [...row.warnings, ...p.unresolved],
    financialWarnings: row.financialWarnings ?? [],
    provisionalFinancial: !!row.provisionalFinancial || !!row.provisionalTenders,
  }
}

export async function fileDigest(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('')
}

export async function readStoredPos(client, start, end) {
  if (!start || !end || end < start) return []
  const rows = []
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await client.rpc('pos_daily_report', { p_start: start, p_end: end, p_offset: offset })
    if (error || !data) throw new Error(error?.message || 'Could not load saved POS data.')
    rows.push(...data)
    if (data.length < 100) return rows
  }
}

function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort()
    .map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
  return JSON.stringify(value)
}

export async function preparePosWorkbook(client, file, locations) {
  if (!/\.xlsx$/i.test(file.name) || file.size > 10_000_000) throw new Error('Choose an original XLSX workbook up to 10 MB.')
  const bytes = await file.arrayBuffer()
  const sha = await fileDigest(bytes)
  const report = await parseDailyPosFile({ name: file.name, arrayBuffer: async () => bytes })
  const day = report[0]?.businessDate
  const system = report[0]?.system
  if (!day || day < POS_START || report.some(row => row.businessDate !== day || row.system !== system)) {
    throw new Error('Choose a single business date from November 1, 2026 onward.')
  }
  const matched = matchPosLocations(report, locations)
  // Do not silently drop unrecognized locations from a consolidated workbook.
  const usable = matched.filter(row => row.location && row.metrics && row.reportMetrics)
  const issues = matched.filter(row => !usable.includes(row))
  const [existing, comparison] = await Promise.allSettled([
    readStoredPos(client, day, day),
    readPosComparisons(client, matched),
  ])
  const fromStore = existing.status === 'fulfilled' ? existing.value : []
  const candidates = usable.map(row => {
    const current = fromStore.find(item => item.location_id === row.location.id && item.business_date === day)
    const document = posDocument(row)
    return {
      sourceId: row.sourceId, locationId: row.location.id, name: row.location.name, document,
      expectedRevision: current?.revision ?? 0,
      change: !current ? 'new' : canonical(current.document) === canonical(document) ? 'duplicate' : 'correction',
    }
  })
  return { name: file.name, sha, day, system, candidates, issues, rows: comparison.status === 'fulfilled' ? comparison.value : matched,
    comparisonError: comparison.status === 'rejected' ? comparison.reason.message : null,
    storageError: existing.status === 'rejected' ? existing.reason.message : null }
}

export async function processPosFiles(files, process, onProgress) {
  // Sequential processing keeps at most one workbook buffer and parsed XML tree live.
  for (const [index, file] of files.entries()) {
    let outcome
    try { outcome = { result: await process(file) } }
    catch (error) { outcome = { error: error.message } }
    onProgress(file, outcome, index + 1, files.length)
  }
}

export async function commitPosWorkbook(client, workbook, correctionReason) {
  if (workbook.storageError || workbook.issues.length || !workbook.candidates.length) throw new Error('Resolve workbook validation issues before saving.')
  const reason = correctionReason?.trim()
  if (!reason && workbook.candidates.some(row => row.change === 'correction')) throw new Error('Enter a reason and approve the corrections.')
  const { data, error } = await client.rpc('pos_daily_commit', {
    p_file_name: workbook.name, p_sha: workbook.sha, p_parser: POS_PARSER_VERSION, p_system: workbook.system, p_day: workbook.day,
    p_rows: workbook.candidates.map(({ sourceId, locationId, expectedRevision, document, change }) =>
      ({ sourceId, locationId, expectedRevision, document, reason: change === 'correction' ? reason : null })),
  })
  if (error || !data) throw new Error(error?.message || 'POS import could not be saved.')
  return data
}
