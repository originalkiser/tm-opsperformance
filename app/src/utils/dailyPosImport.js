import { buildPosReportMetrics } from './posMetrics.js'
import { readWorkbookSheets } from './drbWorkbook.js'
import { drbDate } from './drbReconciliation.js'
import { cashRevenue, revenueCents, shiftDate } from './budgetRevenue.js'

const text = value => String(value ?? '').trim()
const norm = value => text(value).replace(/\s+/g, ' ').toLowerCase()
const tiers = ['basic', 'good', 'better', 'best']

const micrologicSites = {
  TCWWR: '1529', TCWBR: '1528', PECWF: '1517', TCWBLO: '1531',
  TCWEJB: '1532', TCWCB: '1515', TCWFM: '1512',
}
const drbSites = new Map([
  '1508-Mesquite', '1511-Allen', '1516-Plano', '1518-Greenwood', '1519-Greenville',
  '1520-Cleveland', '1521-Port Arthur', '1522-Groves', '1524-Beaumont', '1525-Breaux Bridge',
  '1526-Mansura', '1527-Carencro', '1530-Batesville',
].map(name => [norm(name), name.slice(0, 4)]))
const drbIgnored = new Set(['magztx query server', 'magztx rep hub', 'old -1509-mesquite', 'old 1510-mckinney', '1509-mesquite'])

function cents(value) {
  const raw = text(value)
  const accounting = /^\((.*)\)$/.exec(raw)
  const formatted = accounting ? accounting[1].trim() : raw
  if (!/^-?\$?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(formatted) ||
      (accounting && formatted.startsWith('-'))) throw new Error('Invalid report amount.')
  const digits = formatted.replace(/[$,]/g, '')
  const unsigned = digits.replace(/^-/, '')
  const [whole, fraction = ''] = unsigned.split('.')
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  if (!Number.isSafeInteger(result) || result > 100_000_000_000) throw new Error('Report amount is out of range.')
  return accounting || digits.startsWith('-') ? -result : result
}

const collection = signed => signed == null ? null : -signed || 0

function quantity(value) {
  const raw = text(value).replace(/,/g, '')
  const result = Number(raw)
  if (!/^-?\d+(?:\.0+)?$/.test(raw) || !Number.isSafeInteger(result) || Math.abs(result) > 100_000_000) throw new Error('Invalid report quantity.')
  return result
}

function singleDate(start, end) {
  if (start !== end) throw new Error('Choose a report for one business date.')
  return start
}

function micDate(value) {
  const match = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),\s+(\d{4})$/i.exec(value)
  if (!match) throw new Error('Invalid Micrologic business date.')
  const month = 'jan feb mar apr may jun jul aug sep oct nov dec'.split(' ').indexOf(match[1].toLowerCase()) + 1
  return drbDate(match[3] + '-' + String(month).padStart(2, '0') + '-' + match[2].padStart(2, '0'))
}

const sum = (rows, field) => rows.reduce((total, row) => total + row[field], 0)
const category = (rows, key) => rows.filter(row => row.category === key)

function memberships(rows, warnings) {
  const counts = Object.fromEntries(tiers.map(tier => [tier, 0]))
  let unclassified = 0
  for (const row of rows) {
    const matches = [...new Set(norm(row.label).match(/\b(?:basic|good|better|best)\b/g) || [])]
    if (!matches.length && /^zbest\b/i.test(row.label)) matches.push('best')
    if (matches.length === 1) counts[matches[0]] += row.quantity
    else if (row.quantity) {
      unclassified += row.quantity
      warnings.push('Unclassified new membership: ' + (row.label || '(blank item)'))
    }
  }
  return { ...counts, unclassified, memberships: sum(rows, 'quantity'), membershipAmounts: rows.map(({ label, amount, quantity }) => ({ label, amount, quantity })) }
}

function ratios(metrics, system) {
  const opportunities = metrics.washes == null || (system === 'Micrologic' && (metrics.redemptions == null || metrics.overrides == null)) ? null : system === 'DRB' ? metrics.washes : metrics.washes - metrics.redemptions - metrics.overrides
  return {
    ...metrics,
    opportunities: opportunities == null ? null : Math.max(0, opportunities),
    conversion: opportunities > 0 && metrics.memberships != null ? metrics.memberships / opportunities : null,
    pmix: metrics.memberships > 0 && metrics.unclassified === 0 ? (metrics.better + metrics.best) / metrics.memberships : null,
  }
}

function micLocation(rows, sourceId, businessDate) {
  const warnings = [], financialWarnings = [], sections = new Set()
  const values = []
  let section = ''
  const balanceSection = 'revenue/payment balance'
  const balanceLabels = ['total revenue', 'total payments', 'total house charges', 'total taxes']
  const parseCell = (parse, value) => {
    if (!text(value)) return null
    try { return parse(value) } catch { return null }
  }
  for (const [description, , qty, , , amount] of rows) {
    const label = text(description)
    const key = norm(label)
    if (/\([a-z0-9]+\) total$/i.test(label) || key === 'all locations') continue
    if ((!label && !text(qty) && !text(amount)) || key === 'description') continue
    if (!text(qty) && !text(amount) && !key.endsWith(' total') &&
        !(section === balanceSection && balanceLabels.includes(key))) {
      section = key
      sections.add(section)
      continue
    }
    if (!['car count', balanceSection, 'payments', 'wash sales', 'wash override',
      'unlimited redemption', 'unlimited signup', 'unlimited recurring', 'unlimited reactivation', 'refunded', 'uwc downgrades', 'totals', 'revenue summary'].includes(section)) continue
    const count = /^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.0+)?$/.test(text(qty)) ? parseCell(quantity, qty) : null
    values.push({ category: section, label, quantity: count, amount: parseCell(cents, amount) })
  }
  const matching = (section, label) => category(values, section).filter(row => norm(row.label) === label)
  function readSubtotal(section, label, field, issues, optional = false) {
    const matches = matching(section, label)
    if (!matches.length && optional) return null
    const value = matches.length === 1 ? matches[0][field] : null
    if (value == null || (field === 'quantity' && value < 0)) {
      issues.push('Micrologic ' + label + ': ' + (matches.length > 1 ? 'duplicate' : matches.length ? 'invalid' : 'missing') + ' ' + field + '.')
      return null
    }
    return value
  }
  const subtotal = (section, label = section + ' total', optional = false) =>
    readSubtotal(section, label, 'quantity', warnings, optional)
  const balanceAmount = (label, optional = false) => readSubtotal(balanceSection, label, 'amount', financialWarnings, optional)
  const rawPayments = balanceAmount('total payments')
  const revenue = balanceAmount('total revenue')
  const rawHouse = balanceAmount('total house charges', true)
  const rawTaxes = balanceAmount('total taxes', true)
  const reportedBalance = balanceAmount('revenue/payment balance total', true)
  const tenderRows = category(values, 'payments').filter(row => norm(row.label) !== 'payments total')
  const paymentSubtotal = readSubtotal('payments', 'payments total', 'amount', financialWarnings, true)
  const detailComplete = tenderRows.length > 0 && tenderRows.every(row => row.amount != null)
  const detailSum = detailComplete ? sum(tenderRows, 'amount') : null
  const paymentSubtotalPresent = matching('payments', 'payments total').length > 0
  const detailVerified = detailComplete && (paymentSubtotalPresent ? paymentSubtotal === detailSum : rawPayments === detailSum)
  if (!detailComplete) financialWarnings.push('Missing or invalid Micrologic payment detail.')
  else if (!detailVerified) financialWarnings.push('Payment detail cannot be verified against a valid payment subtotal.')
  if (detailComplete && rawPayments != null && detailSum !== rawPayments) financialWarnings.push('Payment detail differs from TOTAL PAYMENTS.')
  const tenderType = row => {
    const label = norm(row.label).replace(/^--\s*refunds?:\s*/, '')
    if (/^credit\s*-\s*(amex|mc|visa|disc|mc\s*\/\s*visa\s*\/\s*disc)$/.test(label)) return 'card'
    if (label === 'cash') return 'cash'
    if (/^check$/.test(label)) return 'other'
    return 'unmapped'
  }
  const tenderAmount = type => {
    const items = tenderRows.filter(row => tenderType(row) === type)
    return items.length && items.every(row => row.amount != null)
      ? sum(items, 'amount') : !items.length && detailVerified ? 0 : null
  }
  const rawCard = tenderAmount('card')
  const rawOther = tenderAmount('other')
  const rawCash = tenderAmount('cash')
  const unmapped = tenderRows.filter(row => tenderType(row) === 'unmapped' && row.amount !== 0)
  if (unmapped.length) financialWarnings.push('Unresolved payment tender: ' + unmapped.map(row => row.label || '(blank item)').join(', '))
  const expectedCash = detailVerified && !unmapped.length && rawPayments != null && rawCard != null && rawOther != null
    ? -rawPayments + rawCard + rawOther : null
  if (expectedCash != null && rawCash != null && expectedCash !== -rawCash) financialWarnings.push('Calculated cash differs from net cash payments.')
  const explicitCountPresent = matching('car count', 'car count total').length > 0
  const reported = subtotal('car count', 'car count total', !explicitCountPresent)
  const washSales = subtotal('wash sales')
  const redemptions = subtotal('unlimited redemption')
  const summaryQuantity = subtotal('revenue summary', 'revenue summary total', true)
  const signupSubtotal = subtotal('unlimited signup', 'unlimited signup total', !sections.has('unlimited signup'))
  const signupInTotals = matching('totals', 'unlimited signup').length > 0
  // A missing signup section can mean zero only when the other subtotals corroborate it.
  const confirmedZero = !sections.has('unlimited signup') && !signupInTotals &&
    subtotal('totals', 'totals total', true) != null && washSales != null && redemptions != null &&
    subtotal('totals', 'wash sales', true) === washSales && subtotal('totals', 'unlimited redemption', true) === redemptions &&
    summaryQuantity === washSales + redemptions
  const signupCount = signupSubtotal ?? (confirmedZero ? 0 : null)
  const signups = category(values, 'unlimited signup').filter(row => norm(row.label) !== 'unlimited signup total')
  const signup = memberships(signups, warnings)
  const signupMatches = signupCount != null && signups.every(row => row.quantity != null) && signup.memberships === signupCount
  if (!signupMatches) {
    warnings.push('New membership quantity is missing or differs from the signup subtotal.')
    for (const tier of tiers) signup[tier] = null
    signup.unclassified = signupCount
    signup.memberships = signupCount
  }
  const calculated = washSales != null && signupMatches && redemptions != null ? washSales + signupCount + redemptions : null
  const washes = explicitCountPresent ? reported : calculated
  if (washes == null) warnings.push('Total Washes unavailable. Car Count Total and supported calculation inputs are missing or invalid.')
  if (reported != null && calculated != null && reported !== calculated) warnings.push('Reported Car Count Total differs from the calculated wash count.')
  const washCount = { source: washes == null ? 'unavailable' : reported != null ? 'reported' : 'calculated',
    reported, calculated, washSales, signupCount, redemptions, confirmedZero, summaryQuantity }
  const omittedHouse = !matching(balanceSection, 'total house charges').length
  const omittedTaxes = !matching(balanceSection, 'total taxes').length
  const baseBalance = revenue != null && rawPayments != null ? revenue + rawPayments : null
  const knownBalance = baseBalance == null ? null : baseBalance + (rawHouse ?? 0) + (rawTaxes ?? 0)
  // An omitted zero line can be inferred only when the signed balance corroborates it.
  const corroboratedOmissions = reportedBalance != null && knownBalance === reportedBalance
  const house = rawHouse ?? (omittedHouse && corroboratedOmissions ? 0 : null)
  const taxes = rawTaxes ?? (omittedTaxes && corroboratedOmissions ? 0 : null)
  const balance = house == null || taxes == null || baseBalance == null ? null : baseBalance + house + taxes
  if (balance == null) financialWarnings.push('Micrologic revenue/payment balance cannot be verified from the available subtotals.')
  else if (balance) financialWarnings.push('Micrologic revenue/payment balance is nonzero.')
  if (balance != null && reportedBalance != null && balance !== reportedBalance) {
    financialWarnings.push('Calculated revenue/payment balance differs from the reported balance.')
  }
  const overrideItems = category(values, 'wash override').filter(row => !/ total$/i.test(row.label))
  const salesItems = category(values, 'wash sales').filter(row => !/ total$/i.test(row.label))
  const normalized = row => norm(row.label).replace(/\s/g, '')
  const qualifyingOverride = row => /^(basic|good|better|best)rewash$/.test(normalized(row))
  const qualifyingSale = row => normalized(row) === 'zbestwash'
  if (overrideItems.some(row => /(?:basic|good|better|best).*rewash/i.test(row.label) && !qualifyingOverride(row)) ||
    salesItems.some(row => /z\s*best.*wash/i.test(row.label) && !qualifyingSale(row))) warnings.push('Review ambiguous wash override spelling.')
  const qualifying = [...overrideItems.filter(qualifyingOverride), ...salesItems.filter(qualifyingSale)]
  const overrideTotal = subtotal('wash override', 'wash override total', !sections.has('wash override'))
  const noOverrideCategory = !sections.has('wash override') && subtotal('totals', 'totals total', true) != null &&
    !matching('totals', 'wash override').length
  const rawOverrides = overrideTotal ?? (noOverrideCategory ? 0 : null)
  const overrideDetailValid = rawOverrides != null && overrideItems.every(row => row.quantity != null) &&
    sum(overrideItems, 'quantity') === rawOverrides
  const salesDetailValid = washSales != null && salesItems.every(row => row.quantity != null) && sum(salesItems, 'quantity') === washSales
  const overrides = !salesDetailValid || !overrideDetailValid || qualifying.some(row => row.quantity == null)
    ? null : sum(qualifying, 'quantity')
  if (overrides == null) warnings.push('Qualifying wash overrides are unavailable because source subtotals or detail are incomplete.')
  const recharges = subtotal('unlimited recurring')
  const metrics = ratios({ revenue, payments: collection(rawPayments), cards: collection(rawCard), other: collection(rawOther), house: collection(house),
      cash: expectedCash, reportedCash: collection(rawCash), reportBalance: balance, washes, overrides,
      rawOverrides,
      redemptions, recharges, terminations: null,
      ...signup }, 'Micrologic')
  return { system: 'Micrologic', sourceId, businessDate, siteCode: micrologicSites[sourceId], warnings, financialWarnings, washCount,
    provisionalTenders: !detailVerified || unmapped.length > 0, metrics,
    reportMetrics: buildPosReportMetrics('Micrologic', values, metrics),
    signedAmounts: { totalRevenue: revenue, totalPayments: rawPayments, houseCharges: rawHouse, taxes: rawTaxes, reportedBalance,
      tenders: tenderRows.map(({ label, amount }) => ({ label, amount })) } }
}

export function parseMicrologic(rows) {
  if (norm(rows[1]?.[0]) !== 'daily, period, and shift financial') throw new Error('Expected the original Micrologic financial export.')
  const periods = rows.map(row => text(row[0])).filter(label => /^reporting for:/i.test(label))
  if (periods.length !== 1) throw new Error('Expected one Micrologic reporting period.')
  const range = /^reporting for:\s*(.+?)\s+[-–—]\s+(.+)$/i.exec(periods[0])
  if (!range) throw new Error('Missing Micrologic reporting dates.')
  const date = singleDate(micDate(range[1]), micDate(range[2]))
  const headings = rows.flatMap((row, index) => {
    const match = /\(([A-Z0-9]+)\)\s+[—–-]\s+/i.exec(text(row[0]))
    return match && row.slice(1).every(value => !text(value)) ? [{ index, id: match[1].toUpperCase() }] : []
  })
  if (!headings.length) throw new Error('No Micrologic location sections found.')
  return headings.map(({ index, id }, i) => {
    if (!micrologicSites[id]) return { system: 'Micrologic', sourceId: id, businessDate: date }
    try { return micLocation(rows.slice(index + 1, headings[i + 1]?.index), id, date) }
    catch (error) { return { system: 'Micrologic', sourceId: id, businessDate: date, siteCode: micrologicSites[id], warnings: [error.message] } }
  })
}

const revenueCategories = new Set([
  'Basic Washes', 'Wash Packages', 'Wash Extras', 'Wash Misc.', 'Wash Coupons', 'Wash Discounts',
  'Wash LPM Discounts', 'Express Services', 'Express Coupons', 'Detail Services', 'Detail Coupons',
  'Other Coupons', 'Sales Taxes', 'ARM Plans Sold', 'ARM Plans Recharged', 'ARM Plans Redeemed',
  'ARM Plans Terminated', 'Prepaid Sold', 'Prepaid Redeemed', 'Online Sold', 'Online Discounts',
  'Online Redeemed', 'Paidouts',
].map(norm))
const balanceCategories = new Set([
  'Deposits', 'Starting Cash', 'XPT Cash Add/Remove', 'House Accounts', 'Net Change in A/R', 'Cash',
  'XPT Cash Over/Short', 'XPT Chg Over/Short', 'Check', 'Credit Card', 'Other Tenders', 'XPT Balancing',
].map(norm))
const drbCashCategories = new Set(['cash', 'xpt cash add/remove', 'xpt cash over/short', 'xpt chg over/short'])
const drbCashDepositItems = new Set(['cash deposit', 'end cash', 'start cash'])

export function parseDailyDrb(sheets) {
  const options = sheets.find(sheet => sheet.name === 'Options')?.rows
  const details = sheets.find(sheet => sheet.name === 'Site Financial Detail Report')?.rows
  if (!options || !details) throw new Error('Expected the DRB Site Financial Detail Report and Options tabs.')
  const option = key => options[1]?.[options[0].findIndex(value => text(value) === key)]
  if (text(option('Report Name')) !== 'Site Financial Detail Report') throw new Error('Unexpected DRB report name.')
  const date = singleDate(drbDate(option('Start Date')), drbDate(option('End Date')))
  const header = details[0].map(text)
  const required = ['Report Category', 'Site', 'Terminal', 'Shift', 'Item Name', 'Count', 'Quantity', 'Amount']
  if (required.some(name => header.filter(value => value === name).length !== 1)) throw new Error('Missing or ambiguous DRB report columns.')
  const grouped = new Map()
  for (const row of details.slice(1)) {
    const get = key => text(row[header.indexOf(key)])
    if (!row.some(value => text(value))) continue
    const site = get('Site'), type = norm(get('Report Category'))
    if (drbIgnored.has(norm(site)) || /^old\b/i.test(site) || /^1509(?:\b|$)/.test(site)) continue
    if (!site || !type) throw new Error('DRB detail row is missing a site or category.')
    if (!grouped.has(site)) grouped.set(site, [])
    if (!drbSites.has(norm(site))) continue
    if (get('Terminal') || get('Shift')) throw new Error('Use DRB totals by site without Terminal or Shift breakdown.')
    grouped.get(site).push({ category: type, sourceCategory: get('Report Category'), label: get('Item Name'), amount: cents(get('Amount')),
      quantity: quantity(get('Quantity')), count: quantity(get('Count')) })
  }
  if (!grouped.size) throw new Error('No eligible DRB report locations found.')
  return [...grouped].map(([sourceId, rows]) => {
    const siteCode = drbSites.get(norm(sourceId))
    if (!siteCode) return { system: 'DRB', sourceId, businessDate: date }
    const warnings = [], financialWarnings = []
    const unknown = [...new Set(rows.filter(row => !revenueCategories.has(row.category) && !balanceCategories.has(row.category)).map(row => row.category))]
    if (unknown.length) financialWarnings.push('Unmapped DRB categories: ' + unknown.join(', '))
    if (!rows.some(row => row.category === 'paidouts') || !rows.some(row => row.category === 'basic washes')) {
      return { system: 'DRB', sourceId, siteCode, businessDate: date, warnings: [...warnings, 'Required financial category boundaries are missing.'] }
    }
    const total = sum(rows.filter(row => revenueCategories.has(row.category)), 'amount')
    const card = collection(sum(category(rows, 'credit card'), 'amount'))
    const houseRows = category(rows, 'net change in a/r')
    const house = collection(sum(houseRows.length ? houseRows : category(rows, 'house accounts'), 'amount'))
    const other = collection(sum(category(rows, 'other tenders'), 'amount'))
    const cash = total - card - house - other
    const cashRows = rows.filter(row => drbCashCategories.has(row.category)
      || row.category === 'deposits' && drbCashDepositItems.has(norm(row.label)))
    const reportedCash = cashRows.length ? collection(sum(cashRows, 'amount')) : null
    const reportBalance = unknown.length ? null : sum(rows, 'amount')
    if (reportedCash == null) financialWarnings.push('No independent cash reconciliation detail is present.')
    else if (cash !== reportedCash) financialWarnings.push('Calculated cash differs from the signed cash, deposit and XPT reconciliation detail.')
    if (reportBalance) financialWarnings.push('Nonzero DRB report balance.')
    if (houseRows.length && category(rows, 'house accounts').some(row => row.amount)) {
      financialWarnings.push('Both Net Change in A/R and House Accounts are present. Review the reconciliation categories for overlap.')
    }
    const quantityDifferences = rows.filter(row => ['basic washes', 'arm plans sold', 'arm plans recharged',
      'arm plans redeemed', 'arm plans terminated'].includes(row.category) && row.count !== row.quantity)
      .map(({ sourceCategory, label, count, quantity }) => ({ category: sourceCategory, label, count, quantity }))
    const metrics = ratios({ revenue: total, payments: total, cards: card, house, other, cash, reportedCash, reportBalance, overrides: null,
        washes: sum(category(rows, 'basic washes'), 'quantity'), redemptions: sum(category(rows, 'arm plans redeemed'), 'quantity'),
        recharges: sum(category(rows, 'arm plans recharged'), 'quantity'), terminations: sum(category(rows, 'arm plans terminated'), 'quantity'),
        ...memberships(category(rows, 'arm plans sold'), warnings) }, 'DRB')
    return { system: 'DRB', sourceId, siteCode, businessDate: date, warnings, financialWarnings, quantityDifferences,
      provisionalFinancial: unknown.length > 0, metrics, reportMetrics: buildPosReportMetrics('DRB', rows, metrics),
      signedAmounts: Object.fromEntries([...new Set(rows.map(row => row.category))]
        .map(key => [key, sum(category(rows, key), 'amount')])) }
  })
}

export async function parseDailyPosFile(file) {
  if (!file || !/\.xlsx$/i.test(file.name)) throw new Error('Choose an original XLSX export.')
  const sheets = await readWorkbookSheets(await file.arrayBuffer())
  return sheets.length === 1 ? parseMicrologic(sheets[0].rows) : parseDailyDrb(sheets)
}

export function matchPosLocations(report, locations) {
  return report.flatMap(row => {
    const matches = locations.filter(location => {
      const code = text(location.site_code)
      return !!row.siteCode && (code === row.siteCode || code.startsWith(row.siteCode + '-'))
    })
    if (row.siteCode === '1509' || (matches.length === 1 && matches[0].exclude_from_reporting)) return []
    const warning = !row.siteCode ? 'Unknown POS location. Review its exact identifier before mapping.'
      : matches.length !== 1 ? 'POS mapping must match exactly one TM Ops location.'
        : report.filter(candidate => candidate.siteCode === row.siteCode && candidate.businessDate === row.businessDate).length > 1
          ? 'Duplicate POS coverage for this location and date.' : null
    return [{ ...row, location: warning ? null : matches[0], warnings: [...(row.warnings || []), ...(warning ? [warning] : [])] }]
  })
}

export async function readPosComparisons(client, rows) {
  const days = [...new Set(rows.filter(row => row.location && row.metrics).map(row => row.businessDate))]
  const entries = []
  for (const day of days) {
    const ids = [...new Set(rows.filter(row => row.businessDate === day && row.location && row.metrics).map(row => row.location.id))]
    const { data, error } = await client.from('budget_daily_entries')
      .select('location_id,entry_date,yesterday_total_revenue,yesterday_cc_revenue,yesterday_house_revenue,yesterday_washes,yesterday_redemptions,yesterday_wash_overrides,yesterday_basic,yesterday_good,yesterday_better,yesterday_best')
      .eq('entry_date', shiftDate(day, 1)).in('location_id', ids)
    if (error || !data) throw new Error('Budget Tracking comparison could not be loaded.')
    entries.push(...data)
  }
  return rows.map(row => {
    const found = entries.filter(entry => entry.location_id === row.location?.id && entry.entry_date === shiftDate(row.businessDate, 1))
    if (found.length !== 1) return {
      ...row, managerMissing: !!row.location && !!row.metrics && !found.length,
      warnings: found.length > 1 ? [...row.warnings, 'More than one Budget Tracking entry matched.'] : row.warnings,
    }
    const entry = found[0]
    const value = field => entry['yesterday_' + field] == null ? null : Number(entry['yesterday_' + field])
    const result = cashRevenue(entry)
    const managerCash = result == null ? null : Math.round(result * 100)
    const managerOverrides = value('wash_overrides') ?? (row.system === 'Micrologic' ? 0 : null)
    const counts = Object.fromEntries(tiers.map(tier => [tier, value(tier)]))
    const memberships = Object.values(counts).some(count => count == null) ? null : Object.values(counts).reduce((a, b) => a + b, 0)
    const washes = value('washes'), redemptions = value('redemptions')
    const opportunities = washes == null ? null : row.system === 'DRB' ? washes
      : redemptions == null ? null : Math.max(0, washes - redemptions - managerOverrides)
    return { ...row, manager: { ...counts, memberships, opportunities,
      conversion: opportunities > 0 && memberships != null ? memberships / opportunities : null,
      pmix: memberships > 0 ? (counts.better + counts.best) / memberships : null,
      payments: revenueCents(entry.yesterday_total_revenue), cards: revenueCents(entry.yesterday_cc_revenue),
      other: revenueCents(entry.yesterday_house_revenue), cash: managerCash, washes,
      redemptions, overrides: managerOverrides } }
  })
}

const comparisonFields = ['payments', 'cards', 'budgetOther', 'cash', 'washes', 'redemptions', ...tiers]
const moneyFields = new Set(['payments', 'cards', 'budgetOther', 'cash'])
export const comparisonLabels = {
  exact: 'Exact match',
  rounding: 'Rounding-only difference',
  substantive: 'Substantive discrepancy',
  unavailable: 'Unclassified or unavailable metric',
  missing: 'Missing manager entry',
}

export function posComparisonValues(row) {
  const { metrics, manager, system } = row
  return {
    imported: { ...metrics, budgetOther: system === 'DRB' ? metrics.house + metrics.other : metrics.other },
    saved: manager ? { ...manager, budgetOther: manager.other, other: null } : null,
  }
}

export const isProvisionalPosMetric = (row, key) =>
  (row.provisionalFinancial && ['revenue', 'payments', 'cash'].includes(key)) ||
  (row.provisionalTenders && ['cards', 'budgetOther'].includes(key))

export function comparePosMetric(key, imported, saved) {
  if (imported == null || saved == null) return 'unavailable'
  if (imported === saved) return 'exact'
  if (moneyFields.has(key) && saved % 100 === 0 && Math.round(imported / 100) * 100 === saved) return 'rounding'
  return 'substantive'
}

export function posManagerStatus(row) {
  if (!row.location || !row.metrics) return 'unavailable'
  if (!row.manager) return row.managerMissing ? 'missing' : 'unavailable'
  const { imported, saved } = posComparisonValues(row)
  const fields = row.system === 'Micrologic' ? [...comparisonFields, 'overrides'] : comparisonFields
  const statuses = fields.map(key => isProvisionalPosMetric(row, key) ? 'unavailable' : comparePosMetric(key, imported[key], saved[key]))
  if (imported.unclassified || statuses.includes('substantive')) return 'substantive'
  if (statuses.includes('unavailable')) return 'unavailable'
  return statuses.includes('rounding') ? 'rounding' : 'exact'
}

export function groupPosReviewByDate(rows) {
  const dates = new Map()
  for (const row of rows) {
    if (!dates.has(row.businessDate)) dates.set(row.businessDate, [])
    dates.get(row.businessDate).push(row)
  }
  return [...dates.entries()].sort(([a], [b]) => b.localeCompare(a))
}

export function summarizePosReview(rows) {
  const results = { mapped: 0, drbZero: 0, cashMatched: 0, exact: 0, rounding: 0,
    substantive: 0, unavailable: 0, missing: 0, calculated: 0, financial: 0, anyRounding: 0 }
  for (const row of rows) {
    results[posManagerStatus(row)]++
    if (row.financialWarnings?.length) results.financial++
    if (!row.location) continue
    results.mapped++
    if (!row.metrics) continue
    const { imported, saved } = posComparisonValues(row)
    if (saved && [...moneyFields].some(key => !isProvisionalPosMetric(row, key) && comparePosMetric(key, imported[key], saved[key]) === 'rounding')) results.anyRounding++
    if (row.system === 'DRB' && row.metrics.reportBalance === 0) results.drbZero++
    if (!row.provisionalFinancial && row.metrics.cash != null && row.metrics.cash === row.metrics.reportedCash) results.cashMatched++
    if (row.washCount?.source === 'calculated') results.calculated++
  }
  return results
}
