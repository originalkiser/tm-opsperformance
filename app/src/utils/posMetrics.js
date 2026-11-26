const name = value => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
const sum = (rows, key) => rows.reduce((total, row) => total + row[key], 0)
const retail = new Set(['basic wash', 'good wash', 'better wash', 'best wash'])
const specialDrb = new Set(['government car', 'police wash', 'employee wash 002'])
const redeemTier = label => name(label).match(/\b(basic|good|better|best)\b|^z(basic|good|better|best)\b/)?.slice(1).find(Boolean)
const drbTiers = new Map([
  ['unl. military sld','best'], ['unl. military rdmd','best'], ['unl police special','nonTier'],
  ['unl. pol spcl rdmd','nonTier'], ['unl. full serve rdmd','best'], ['unl. ultimate rdmd','best'],
  ['unl. wash & dry rdmd','basic'], ['unl. works rdmd-$30','best'],
])
const micRedemption = new Map([
  ['military & veteran','best'], ['police uwc','nonTier'],
])
const housePrograms = new Map([
  ['beaches usa house acct','1529'], ['serenity funeral home house acct','1529'], ['birk motors-mo','1532'],
])
export function posTierAlias(system, category, label, siteCode) {
  const key = name(label)
  if (system === 'DRB') {
    if (category === 'arm plans sold' && (key === 'unl. military sld' || key === 'unl police special')) return drbTiers.get(key)
    if (category === 'arm plans redeemed' && !['unl. military sld','unl police special'].includes(key)) return drbTiers.get(key)
  }
  if (system === 'Micrologic' && category === 'unlimited redemption') {
    if (key === '$18 unlimited' && siteCode === '1512') return 'basic'
    return micRedemption.get(key) ?? (housePrograms.get(key) === siteCode && housePrograms.has(key) ? 'nonTier' : undefined)
  }
}
const drbDiscounts = new Set(['unl best 2m disc','unl best 3m disc','unl better 2m disc','unl better 3m disc'])
const drbRefunds = new Set(['unl. basic gf4 rfnd','unl. best gf4 rfnd','unl. better int rfnd','unl. good gf4 rfnd','unl. military rfnd'])
const micRefunds = new Set(['best - rinsed - 50% off 3 months updated','better - rinsed - 50% off 3 months updated','uwc-partial refund'])
const refundItem = row => name(row.label).replace(/^--\s*(?:refund:\s*)?/, '').replace(/ sign up$/, '')
const memberRefund = row => name(row.label).startsWith('--') && Number.isSafeInteger(row.amount) && row.amount < 0 &&
  (micRefunds.has(refundItem(row)) || /^(basic|good|better|best) wash unlimited$/.test(refundItem(row)))
const refundKey = row => JSON.stringify([refundItem(row), row.quantity, row.amount])
function matchRefund(rows, refund, used) {
  const index = rows.findIndex((row, i) => !used.has(i) && refundKey(row) === refundKey(refund))
  if (index < 0) return false
  used.add(index)
  return true
}
const valid = (rows, key) => rows.every(row => Number.isSafeInteger(row[key]))

export function buildPosReportMetrics(system, rows, metrics, siteCode) {
  const mic = system === 'Micrologic'
  const lines = category => rows.filter(r => r.category === category && name(r.label) !== category + ' total')
  const unresolved = []
  const memberLines = (mic ? ['unlimited signup', 'unlimited recurring', 'unlimited reactivation']
    : ['arm plans sold', 'arm plans recharged']).flatMap(lines)
  if (mic) {
    // REFUNDED contains the item-level refund. The same transaction can also
    // appear under UWC DOWNGRADES, in tender detail and in the revenue summary.
    const refunds = lines('refunded').filter(r => name(r.label) !== '-- tax refund')
    const existingRefunds = memberLines.filter(memberRefund)
    const recurringMatches = new Set()
    const approved = refunds.filter(memberRefund)
    memberLines.push(...approved.filter(row => !matchRefund(existingRefunds, row, recurringMatches)))
    if (refunds.some(row => !memberRefund(row) && !(name(row.label).startsWith('--') &&
        retail.has(refundItem(row)) && Number.isSafeInteger(row.amount) && row.amount < 0) && row.amount !== 0)) {
      unresolved.push('Unclassified Micrologic refund or adjustment.')
    }
    const mirrorMatches = new Set()
    if ([...lines('uwc downgrades'), ...lines('open refund')].some(row => row.amount !== 0 &&
      !matchRefund(approved, row, mirrorMatches))) unresolved.push('Micrologic downgrade and refund detail do not reconcile.')
    for (const [section, qty] of [['unlimited signup', metrics.memberships], ['unlimited recurring', metrics.recharges]]) {
      const items = lines(section)
      if (qty == null || !valid(items, 'quantity') || sum(items, 'quantity') !== qty) unresolved.push('Incomplete ' + section + ' source detail.')
    }
    const reactivationTotal = rows.find(r => r.category === 'unlimited reactivation' && name(r.label) === 'unlimited reactivation total')
    const reactivations = lines('unlimited reactivation')
    if (reactivations.length && (!reactivationTotal || !valid(reactivations, 'amount') ||
        sum(reactivations, 'amount') !== reactivationTotal.amount)) unresolved.push('Incomplete reactivation detail.')
  } else {
    memberLines.push(...lines('wash lpm discounts').filter(r => drbDiscounts.has(name(r.label)) && r.amount < 0))
    const terminations = lines('arm plans terminated').filter(r => r.amount !== 0)
    const approved = r => (drbRefunds.has(name(r.label)) || /^unl\. (basic|good|better|best) rfnd$/.test(name(r.label))) && r.amount < 0
    memberLines.push(...terminations.filter(approved))
    if (terminations.some(r => !approved(r))) unresolved.push('Unclassified DRB membership termination adjustment.')
    if (rows.some(r => /discount|coupon/.test(r.category) && r.amount !== 0 && /\b(?:unl|arm|membership|unlimited)\b/.test(name(r.label)) &&
      !(r.category === 'wash lpm discounts' && drbDiscounts.has(name(r.label)) && r.amount < 0))) unresolved.push('Unclassified DRB membership discount.')
  }
  const memberRevenue = metrics.revenue == null || unresolved.length || !valid(memberLines, 'amount') ? null : sum(memberLines, 'amount')
  const retailRevenue = memberRevenue == null ? null : metrics.revenue - memberRevenue

  const sales = mic ? lines('wash sales') : [...lines('basic washes'), ...lines('wash packages')]
  const refundMatches = new Set()
  const sourceRefunds = lines('refunded')
  const tier = r => {
    const label = name(r.label)
    if (retail.has(label)) return label
    if (!mic && r.category === 'wash packages' && label === 'the works') return 'best wash'
    if (!mic && r.category === 'basic washes' && label === 'wash & dry') return 'basic wash'
    if (mic && label.startsWith('-- refund: ') && r.quantity < 0 && r.amount < 0 &&
        retail.has(refundItem(r)) && matchRefund(sourceRefunds, r, refundMatches)) return refundItem(r)
    return null
  }
  const ignored = r => mic ? name(r.label).replace(/\s/g, '') === 'zbestwash'
    : specialDrb.has(name(r.label)) || ['package wash', 'ghostwash-', 'arm membercross wash'].includes(name(r.label))
  const purchaseCounts = Object.fromEntries([...retail].map(label => [label, 0]))
  const unknownSales = []
  for (const row of sales) {
    const label = tier(row)
    if (label) purchaseCounts[label] += row.quantity
    else if (!ignored(row) && row.quantity !== 0) unknownSales.push(row)
  }
  const unmatchedRetailRefund = mic && sourceRefunds.some((row, index) =>
    name(row.label).startsWith('--') && retail.has(refundItem(row)) && row.amount !== 0 && !refundMatches.has(index))
  const ambiguous = unmatchedRetailRefund || unknownSales.length > 0 || !valid(sales, 'quantity') || Object.values(purchaseCounts).some(qty => qty < 0)
  const premiumRetail = purchaseCounts['better wash'] + purchaseCounts['best wash']
  const eligibleRetail = Object.values(purchaseCounts).reduce((total, qty) => total + qty, 0)
  const packageBase = mic ? null : sum(lines('basic washes').filter(r => name(r.label) === 'package wash'), 'quantity')
  const packageDetail = sum(lines('wash packages').filter(r => ['better wash','best wash','the works'].includes(name(r.label))), 'quantity')
  const retailComplete = !ambiguous && (mic ? metrics.overrides != null : packageBase === packageDetail)

  const redemptions = lines(mic ? 'unlimited redemption' : 'arm plans redeemed')
  const tierFor = row => posTierAlias(system, row.category, row.label, siteCode) || redeemTier(row.label)
  const redeem = { basic: 0, good: 0, better: 0, best: 0, nonTier: 0, unclassified: 0 }
  for (const r of redemptions) if (Number.isSafeInteger(r.quantity)) redeem[tierFor(r) || 'unclassified'] += r.quantity
  const redemptionComplete = metrics.redemptions != null && valid(redemptions, 'quantity') && sum(redemptions, 'quantity') === metrics.redemptions
  if (!retailComplete) unresolved.push('Retail purchase mix has incomplete or unverified source items.')
  if (!redemptionComplete || redeem.unclassified) unresolved.push('Redemption tier mix is incomplete or unclassified.')
  return {
    memberRevenue, retailRevenue, premiumRetail, eligibleRetail, retailComplete, redeem, redemptionComplete, unresolved,
    sources: {
      member: memberLines.map(({ category, label, amount }) => ({ category, label, amount })),
      unclassifiedRetail: unknownSales.map(({ label, quantity }) => ({ label, quantity })),
      unclassifiedRedemptions: redemptions.filter(r => !tierFor(r) && r.quantity)
        .map(({ label, quantity }) => ({ label, quantity })),
      packageBase,
    },
  }
}
