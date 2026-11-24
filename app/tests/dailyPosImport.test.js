import test from 'node:test'
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import { comparePosMetric, posManagerStatus, summarizePosReview, matchPosLocations, parseDailyPosFile, parseDailyDrb, parseMicrologic, readPosComparisons } from '../src/utils/dailyPosImport.js'
import { budgetCountFields, YESTERDAY_FIELDS } from '../src/utils/budgetDailyFields.js'
import { budgetDisplayFields } from '../src/utils/budgetLabels.js'

const micRow = (item, qty, amount) => [item, '', String(qty), '', '', amount]
const micro = [
  ['Fixture Operator'], ['DAILY, PERIOD, AND SHIFT FINANCIAL'], [], ['REPORTING FOR: Nov 23, 2026 - Nov 23, 2026'],
  ['Fixture Site (TCWWR) — Fixture address'],
  ['Car Count'], micRow('Car Count Total', 121, '0'),
  ['UNLIMITED REDEMPTION'], micRow('UNLIMITED REDEMPTION Total', 105, '($1,790.00)'),
  ['UNLIMITED SIGNUP'], micRow('Basic Signup', 1, '$22.00'), micRow('Better Free Promo', 1, '$0.00'),
  micRow('Best Signup', 1, '$40.00'), micRow('UNLIMITED SIGNUP Total', 3, '$62.00'),
  ['UNLIMITED RECURRING'], micRow('UNLIMITED RECURRING Total', 112, '$3,496.00'),
  ['WASH OVERRIDE'], micRow('  BestRewash ', 1, '($26.00)'), micRow('Ghost Wash', 3, '$0.00'),
  micRow('Rewash', 3, '$0.00'), micRow('WASH OVERRIDE Total', 7, '($26.00)'),
  ['WASH SALES'], micRow('Best Wash', 2, '$52.00'), micRow('WASH SALES Total', 13, '$52.00'),
  ['PAYMENTS'], micRow('CASH', 1, '($38.00)'), micRow('CREDIT -AMEX', 1, '($356.00)'),
  micRow('CREDIT -MC / VISA / DISC', 1, '($3,397.00)'), micRow('-- refunds: credit - mc / visa / disc', 1, '$0.58'),
  ['REVENUE/PAYMENT BALANCE'], micRow('TOTAL REVENUE', 118, '$3,798.42'),
  micRow('TOTAL PAYMENTS', 235, '($3,790.42)'), micRow('TOTAL HOUSE CHARGES', 2, '($8.00)'),
]

const drbRow = (category, quantity, amount, item = '', site = '1518-Greenwood', count = quantity) =>
  [category, site, '', '', item, String(count), String(quantity), String(amount)]
const drb = [
  { name: 'Site Financial Detail Report', rows: [
    ['Report Category', 'Site', 'Terminal', 'Shift', 'Item Name', 'Count', 'Quantity', 'Amount'],
    drbRow('Basic Washes', 62, 539, 'Basic Wash', undefined, 64), drbRow('Wash Packages', 29, 486),
    drbRow('ARM Plans Sold', 0, 0), drbRow('ARM Plans Recharged', 41, 1293),
    drbRow('ARM Plans Redeemed', 54, -915), drbRow('ARM Plans Terminated', 2, 0),
    drbRow('Paidouts', 0, 0), drbRow('Credit Card', 48, -1383),
    drbRow('XPT Cash Add/Remove', 61, -20), drbRow('Cash', 0, 0),
    drbRow('Other Tenders', 1, 0), drbRow('Deposits', 0, 0), drbRow('House Accounts', 0, 0),
    ...['MAGZTX Query Server', 'MAGZTX Rep Hub', 'OLD -1509-Mesquite', 'OLD 1510-McKinney'].map(site => drbRow('Basic Washes', 10, 100, '', site)),
  ] },
  { name: 'Options', rows: [
    ['Report Name', 'Start Date', 'End Date'],
    ['Site Financial Detail Report', '11/23/2026 12:00 AM', '11/23/2026 11:59 PM'],
  ] },
]

async function xlsx(sheets) {
  const zip = new JSZip()
  zip.file('xl/workbook.xml', '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
    sheets.map(({ name }, i) => '<sheet name="' + name + '" r:id="rId' + i + '"/>').join('') + '</sheets></workbook>')
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships>' + sheets.map((_, i) => '<Relationship Id="rId' + i +
    '" Target="worksheets/sheet' + i + '.xml"/>').join('') + '</Relationships>')
  sheets.forEach(({ rows }, i) => zip.file('xl/worksheets/sheet' + i + '.xml', '<worksheet><sheetData>' +
    rows.map(row => '<row>' + row.map(value => '<c t="inlineStr"><is><t>' + String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;') + '</t></is></c>').join('') + '</row>').join('') +
    '</sheetData></worksheet>'))
  return zip.generateAsync({ type: 'arraybuffer' })
}

test('Micrologic original-shape XLSX resolves date, net cash and cards, overrides and promotion quantities', async () => {
  const arrayBuffer = await xlsx([{ name: 'Report', rows: micro }])
  const [row] = await parseDailyPosFile({ name: 'report.xlsx', async arrayBuffer() { return arrayBuffer } })
  assert.equal(row.siteCode, '1529')
  assert.equal(row.businessDate, '2026-11-23')
  const m = row.metrics
  assert.deepEqual([m.revenue, m.payments, m.cards, m.cash, m.reportedCash, m.house], [379842, 379042, 375242, 3800, 3800, 800])
  assert.deepEqual([m.washes, m.redemptions, m.rawOverrides, m.overrides, m.opportunities], [121, 105, 7, 1, 15])
  assert.deepEqual([m.basic, m.good, m.better, m.best, m.memberships, m.conversion, m.pmix], [1, 0, 1, 1, 3, .2, 2 / 3])
  assert.equal(row.signedAmounts.totalPayments, -379042)
})

test('only approved override items count and missing Car Count does not borrow final-summary quantity', () => {
  const rows = micro.flatMap(row => row[0] === 'Car Count Total' ? [] : row[0] === 'Best Wash' ? [row, micRow('zBest Wash', 2, '$40.00'),
    micRow('zBest Wash Redemption', 5, '$0.00')] : [row])
  const [result] = parseMicrologic(rows)
  assert.equal(result.metrics.overrides, 3)
  assert.equal(result.metrics.washes, 121)
  assert.equal(result.washCount.source, 'calculated')
  assert.equal(result.metrics.conversion, 3 / 13)
  assert.match(result.warnings.join(' '), /ambiguous wash override/)
  const missingTender = parseMicrologic(micro.flatMap(row => row[0] === 'REVENUE/PAYMENT BALANCE'
    ? [micRow('Other Credit', 1, '($1.00)'), row] : [row]))[0]
  assert.ok(missingTender.financialWarnings.some(warning => warning.includes('Unresolved payment tender')))
  assert.equal(missingTender.metrics.cash, null)
})

test('DRB original-shape XLSX excludes infrastructure and historical sites and reconciles Greenwood', async () => {
  const arrayBuffer = await xlsx(drb)
  const [row, ...extras] = await parseDailyPosFile({ name: 'report.xlsx', async arrayBuffer() { return arrayBuffer } })
  assert.deepEqual(extras, [])
  assert.equal(row.siteCode, '1518')
  assert.equal(row.businessDate, '2026-11-23')
  const m = row.metrics
  assert.deepEqual([m.revenue, m.payments, m.cards, m.cash, m.reportedCash, m.house, m.other, m.reportBalance],
    [140300, 140300, 138300, 2000, 2000, 0, 0, 0])
  assert.deepEqual([m.washes, m.redemptions, m.memberships, m.recharges, m.terminations, m.conversion, m.pmix], [62, 54, 0, 41, 2, 0, null])
  assert.deepEqual(row.quantityDifferences, [{ category: 'Basic Washes', label: 'Basic Wash', count: 64, quantity: 62 }])
  assert.deepEqual(row.financialWarnings, [])
})

test('DRB signed sales and noncash tenders preserve the revenue boundary and flag imbalance', () => {
  const sheets = structuredClone(drb)
  sheets[0].rows.push(drbRow('ARM Plans Sold', 2, 20.01, 'Unl. Best W$ Sld'), drbRow('Net Change in A/R', 1, -10),
    drbRow('Other Tenders', 1, -10.01), drbRow('Deposits', 1, -5, 'Cash Deposit'))
  const [row] = parseDailyDrb(sheets)
  assert.deepEqual([row.metrics.revenue, row.metrics.house, row.metrics.other, row.metrics.cash], [142301, 1000, 1001, 2000])
  assert.equal(row.metrics.membershipAmounts.at(-1).amount, 2001)
  assert.equal(row.metrics.conversion, 2 / 62)
  assert.equal(row.metrics.pmix, 1)
  assert.equal(row.metrics.reportBalance, -500)
  assert.match(row.financialWarnings.join(' '), /Nonzero/)
})

test('DRB cash reconciliation includes cash deposits, start/end cash and XPT over/short', () => {
  const sheets = structuredClone(drb)
  const rows = sheets[0].rows
  rows.find(row => row[0] === 'XPT Cash Add/Remove')[7] = '-10'
  rows.push(drbRow('Deposits', 0, -8, 'Cash Deposit'), drbRow('Deposits', 0, 5, 'End Cash'),
    drbRow('Deposits', 0, -5, 'Start Cash'), drbRow('XPT Cash Over/Short', 0, -2))
  const [row] = parseDailyDrb(sheets)
  assert.deepEqual([row.metrics.payments, row.metrics.cash, row.metrics.reportedCash, row.metrics.reportBalance],
    [140300, 2000, 2000, 0])
  assert.ok(!row.financialWarnings.some(warning => /differs from the signed cash/.test(warning)))
})

test('matching requires an exact approved source and one active reporting location', () => {
  const [row] = parseMicrologic(micro)
  const location = { id: 'target', site_code: '1529-Largo', name: 'Fixture Largo' }
  assert.equal(matchPosLocations([row], [location])[0].location, location)
  assert.deepEqual(matchPosLocations([row], [{ ...location, exclude_from_reporting: true }]), [])
  assert.equal(matchPosLocations([row], [location, { ...location, id: 'duplicate' }])[0].location, null)
  assert.equal(matchPosLocations([row, row], [location])[0].location, null)
  const unknown = parseDailyDrb([{ ...drb[0], rows: [drb[0].rows[0], drbRow('Basic Washes', 1, 1, '', '1518-Unknown')] }, drb[1]])
  assert.match(matchPosLocations(unknown, [])[0].warnings[0], /Unknown POS/)
})

test('comparison reads the next-morning row only and preserves the manager’s zero overrides', async () => {
  const rows = matchPosLocations(parseMicrologic(micro), [{ id: 'location', site_code: '1529' }])
  const calls = []
  const client = { from(table) { calls.push(table); return {
    select() { return this }, eq(field, date) { calls.push([field, date]); return this },
    async in(field, ids) {
      calls.push([field, ids])
      return { data: [{ location_id: 'location', entry_date: '2026-11-24', yesterday_wash_overrides: 0, yesterday_total_revenue: '3790.42',
        yesterday_cc_revenue: '3752.42', yesterday_house_revenue: '0' }] }
    },
  } } }
  const [row] = await readPosComparisons(client, rows)
  assert.deepEqual(calls, ['budget_daily_entries', ['entry_date', '2026-11-24'], ['location_id', ['location']]])
  assert.equal(row.manager.overrides, 0)
  assert.equal(row.metrics.overrides, 1)
  assert.equal(row.manager.cash, 3800)
})

test('Budget Tracking retains customized labels and shows approved override guidance', () => {
  const fields = budgetCountFields(YESTERDAY_FIELDS, { opportunities_formula: 'detailed' })
  const field = budgetDisplayFields(fields, { 'yesterday-wash-overrides': { label: 'Custom', helper: 'Custom helper' } }).find(value => value.optional)
  assert.equal(field.label, 'Custom')
  assert.match(field.hint, /Basic, Good, Better and Best Rewash.*zBest Wash.*Custom helper/)
})

test('wash fallback trusts explicit count first and fails closed on missing or malformed required subtotals', () => {
  const rows = micro.filter(row => row[0] !== 'Car Count Total')
  assert.deepEqual(parseMicrologic(rows)[0].washCount, {
    source: 'calculated', reported: null, calculated: 121, washSales: 13, signupCount: 3,
    redemptions: 105, confirmedZero: false, summaryQuantity: null,
  })
  for (const key of ['WASH SALES Total', 'UNLIMITED REDEMPTION Total', 'UNLIMITED SIGNUP Total']) {
    for (const invalid of [[], [micRow(key, 'invalid', '$2.00')]]) {
      const [result] = parseMicrologic(rows.flatMap(row => row[0] === key ? invalid : [row]))
      assert.equal(result.metrics.washes, null)
      assert.equal(result.metrics.conversion, null)
      assert.equal(result.metrics.cash, 3800)
    }
  }
  const [different] = parseMicrologic(micro.map(row => row[0] === 'Car Count Total' ? micRow(row[0], 123, '0') : row))
  assert.equal(different.metrics.washes, 123)
  assert.equal(different.washCount.calculated, 121)
  assert.match(different.warnings.join(' '), /differs from the calculated wash count/)
  const [malformed] = parseMicrologic(micro.map(row => row[0] === 'Car Count Total' ? micRow(row[0], 'invalid', '0') : row))
  assert.equal(malformed.metrics.washes, null)
  assert.equal(malformed.washCount.source, 'unavailable')
})

test('omitted signup counts become zero only with corroborating Micrologic totals', () => {
  const fixture = micro.filter(row => !/signup|free promo|car count total/i.test(row[0]))
  const withSummary = [...fixture, ['TOTALS'], micRow('WASH SALES', 13, '0'),
    micRow('UNLIMITED REDEMPTION', 105, '0'), micRow('TOTALS Total', 118, '0'),
    ['REVENUE SUMMARY'], micRow('REVENUE SUMMARY Total', 118, '0')]
  const [supported] = parseMicrologic(withSummary)
  assert.equal(supported.metrics.washes, 118)
  assert.equal(supported.metrics.memberships, 0)
  assert.equal(supported.washCount.confirmedZero, true)
  for (const conflicting of [fixture, withSummary.map(row => row[0] === 'REVENUE SUMMARY Total'
    ? micRow(row[0], 119, '0') : row), [...fixture, ['TOTALS'], micRow('UNLIMITED SIGNUP', 1, '0'),
    micRow('TOTALS Total', 118, '0'), ['REVENUE SUMMARY'], micRow('REVENUE SUMMARY Total', 118, '0')]]) {
    const [unsupported] = parseMicrologic(conflicting)
    assert.equal(unsupported.metrics.washes, null)
    assert.equal(unsupported.metrics.memberships, null)
  }
})

test('unclassified signups count in conversion and nonzero Micrologic balance remains visible', () => {
  const rows = micro.map(row => row[0] === 'Best Signup' ? micRow('', 1, '$40.00')
    : row[0] === 'TOTAL REVENUE' ? micRow(row[0], 118, '$3,808.42') : row)
  const [result] = parseMicrologic(rows)
  assert.equal(result.metrics.memberships, 3)
  assert.equal(result.metrics.best, 0)
  assert.equal(result.metrics.unclassified, 1)
  assert.equal(result.metrics.conversion, .2)
  assert.equal(result.metrics.pmix, null)
  assert.equal(result.metrics.reportBalance, 1000)
  assert.equal(result.metrics.payments, 379042)
  assert.equal(result.signedAmounts.houseCharges, -800)
  assert.match(result.financialWarnings.join(' '), /balance is nonzero/)
})

test('manager and network statuses separate rounding, substantive, missing, and financial warnings', () => {
  const [parsed] = parseMicrologic(micro)
  const m = parsed.metrics
  const exact = { ...parsed, location: { id: 'fictional' }, manager: { ...m } }
  const rounding = { ...exact, manager: { ...m, payments: 379000 } }
  const substantive = { ...rounding, manager: { ...rounding.manager, overrides: 2 }, financialWarnings: ['Fixture warning'],
    washCount: { source: 'calculated' } }
  const unavailable = { ...exact, manager: { ...m, washes: null } }
  const missing = { ...exact, manager: null, managerMissing: true }
  assert.equal(comparePosMetric('payments', 379042, 379000), 'rounding')
  assert.equal(comparePosMetric('payments', 379042, 379001), 'substantive')
  assert.deepEqual([exact, rounding, substantive, unavailable, missing].map(posManagerStatus),
    ['exact', 'rounding', 'substantive', 'unavailable', 'missing'])
  assert.deepEqual(summarizePosReview([exact, rounding, substantive, unavailable, missing]), {
    mapped: 5, drbZero: 0, cashMatched: 5, exact: 1, rounding: 1, substantive: 1, unavailable: 1,
    missing: 1, calculated: 1, financial: 1, anyRounding: 2,
  })
})
