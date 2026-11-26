import { matchPosLocations, parseDailyPosFile, readPosComparisons } from './dailyPosImport.js'

export const POS_START = '2026-11-01'
export const POS_PARSER_VERSION = 'daily-pos-v3.1.0'
const integer = value => Number.isSafeInteger(value) ? value : null
const quantity = value => Number.isSafeInteger(value) && value >= 0 ? value : null

export function posDocument(row) {
  const m = row.metrics, p = row.reportMetrics
  return {
    quality: {
      revenueStatus: row.revenueVerified ? 'supported' : 'provisional',
      tenderStatus: row.provisionalTenders || row.provisionalFinancial ? 'provisional' :
        row.financialWarnings?.length || m.reportBalance !== 0 || m.cash == null || m.cash !== m.reportedCash ? 'warning' : 'reconciled',
      employeeWashes: quantity(m.employeeWashes),
      nonTierSold: quantity(m.nonTier),
      nonTierRedeemed: p.redemptionComplete ? quantity(p.redeem.nonTier) : null,
    },
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
      sourceId: row.sourceId, locationId: row.location.id, name: row.location.name, document, previous: current?.document,
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

const historicalInvariants = ['total','washes','memberships','redemptions','payments','cash','reportedCash','cards',
  'house','other','balance','governmentWashes','policeWashes']

export function historicalChanges(candidate) {
  const { previous, document } = candidate
  const metrics = { ...document.metrics, ...document.quality }
  const prior = { ...previous?.metrics, ...previous?.quality }
  const changes = Object.entries(metrics).filter(([key, value]) => value !== prior[key])
    .map(([key, value]) => ({ key, previous: prior[key], proposed: value }))
  const signed = value => {
    const { revenueSummary: _, ...rest } = value?.sources?.signedAmounts ?? {}
    return rest
  }
  const invariant = !!previous && historicalInvariants.every(key => previous.metrics[key] === document.metrics[key]) &&
    canonical(previous.financialWarnings) === canonical(document.financialWarnings) &&
    previous.provisionalFinancial === document.provisionalFinancial && canonical(signed(previous)) === canonical(signed(document))
  return { changes, invariant, unresolved: [ ...document.warnings,
    ...Object.entries(metrics).filter(([key, value]) => value == null &&
      ['total','member','retail','washes','memberships','opportunities','eligibleRetail','premiumSold','premiumRedeemed'].includes(key))
      .map(([key]) => key + ' unavailable') ] }
}

export async function historicalRpc(client, name, args) {
  const { data, error } = await client.rpc('pos_reprocess_' + name, args)
  if (error) throw new Error(error.message)
  return data
}

export async function prepareHistoricalManifest(client, workbooks, reason) {
  if (!reason.trim() || !workbooks.length || new Set(workbooks.map(w => w.sha)).size !== workbooks.length ||
      workbooks.some(w => w.issues.length || w.storageError || !w.candidates.length ||
        w.candidates.some(row => !historicalChanges(row).invariant))) {
    throw new Error('Review all workbook invariants and enter a correction reason before locking the manifest.')
  }
  return historicalRpc(client, 'prepare', { p_reason: reason.trim(), p_workbooks: workbooks.map(workbook => ({
    name: workbook.name, sha: workbook.sha, parser: POS_PARSER_VERSION, day: workbook.day, system: workbook.system,
    rows: workbook.candidates.map(({ sourceId, locationId, expectedRevision, document }) =>
      ({ sourceId, locationId, expectedRevision, document })),
  })) })
}
