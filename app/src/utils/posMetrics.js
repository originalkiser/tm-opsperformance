const name = value => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
const sum = (rows, key) => rows.reduce((total, row) => total + row[key], 0)
const retail = new Set(['basic wash', 'good wash', 'better wash', 'best wash'])
const specialDrb = new Set(['government car', 'police wash'])
const redeemTier = label => name(label).match(/\b(basic|good|better|best)\b|^z(basic|good|better|best)\b/)?.slice(1).find(Boolean)
const valid = (rows, key) => rows.every(row => Number.isSafeInteger(row[key]))

export function buildPosReportMetrics(system, rows, metrics) {
  const mic = system === 'Micrologic'
  const lines = category => rows.filter(r => r.category === category && name(r.label) !== category + ' total')
  const unresolved = []
  const memberLines = (mic ? ['unlimited signup', 'unlimited recurring', 'unlimited reactivation']
    : ['arm plans sold', 'arm plans recharged']).flatMap(lines)
  if (mic) {
    // REFUNDED contains the item-level refund. The same transaction can also
    // appear under UWC DOWNGRADES, in tender detail and in the revenue summary.
    const refunds = lines('refunded').filter(r => name(r.label) !== '-- tax refund')
    const membershipRefund = r => Number.isSafeInteger(r.amount) && r.amount <= 0 && /^--\s*(?:refund:\s*)?(?:basic|good|better|best) wash unlimited$/.test(name(r.label))
    memberLines.push(...refunds.filter(membershipRefund))
    if (refunds.some(r => !membershipRefund(r) && r.amount !== 0)) unresolved.push('Unclassified Micrologic refund or adjustment.')
    const refundCents = sum(refunds.filter(membershipRefund), 'amount')
    const downgradeCents = sum(lines('uwc downgrades').filter(membershipRefund), 'amount')
    if (downgradeCents && downgradeCents !== refundCents) unresolved.push('Micrologic downgrade and refund detail do not reconcile.')
    for (const [section, qty] of [['unlimited signup', metrics.memberships], ['unlimited recurring', metrics.recharges]]) {
      const items = lines(section)
      if (qty == null || !valid(items, 'quantity') || sum(items, 'quantity') !== qty) unresolved.push('Incomplete ' + section + ' source detail.')
    }
    const reactivationTotal = rows.find(r => r.category === 'unlimited reactivation' && name(r.label) === 'unlimited reactivation total')
    const reactivations = lines('unlimited reactivation')
    if (reactivations.length && (!reactivationTotal || !valid(reactivations, 'amount') ||
        sum(reactivations, 'amount') !== reactivationTotal.amount)) unresolved.push('Incomplete reactivation detail.')
  } else {
    memberLines.push(...lines('wash lpm discounts').filter(r => name(r.label) === 'unl best 2m disc'))
    const terminations = lines('arm plans terminated').filter(r => r.amount !== 0)
    const approved = r => /^unl\. (basic|good|better|best) rfnd$/.test(name(r.label)) && r.amount < 0
    memberLines.push(...terminations.filter(approved))
    if (terminations.some(r => !approved(r))) unresolved.push('Unclassified DRB membership termination adjustment.')
    if (rows.some(r => /discount|coupon/.test(r.category) && r.amount !== 0 && /\b(?:unl|arm|membership|unlimited)\b/.test(name(r.label)) &&
      !(r.category === 'wash lpm discounts' && name(r.label) === 'unl best 2m disc'))) unresolved.push('Unclassified DRB membership discount.')
  }
  const memberRevenue = metrics.revenue == null || unresolved.length || !valid(memberLines, 'amount') ? null : sum(memberLines, 'amount')
  const retailRevenue = memberRevenue == null ? null : metrics.revenue - memberRevenue

  const sales = mic ? lines('wash sales') : [...lines('basic washes'), ...lines('wash packages')]
  const verifiedSales = sales.filter(r => retail.has(name(r.label)))
  const ignored = r => mic ? name(r.label).replace(/\s/g, '') === 'zbestwash'
    : specialDrb.has(name(r.label)) || ['package wash', 'ghostwash-', 'arm membercross wash'].includes(name(r.label))
  const unknownSales = sales.filter(r => !verifiedSales.includes(r) && !ignored(r) && r.quantity !== 0)
  const ambiguous = unknownSales.length > 0 || !valid(sales, 'quantity')
  const premiumRetail = sum(verifiedSales.filter(r => ['better wash', 'best wash'].includes(name(r.label))), 'quantity')
  const eligibleRetail = sum(verifiedSales, 'quantity')
  const packageBase = mic ? null : sum(lines('basic washes').filter(r => name(r.label) === 'package wash'), 'quantity')
  const retailComplete = !ambiguous && (mic ? metrics.overrides != null : packageBase === premiumRetail)

  const redemptions = lines(mic ? 'unlimited redemption' : 'arm plans redeemed')
  const redeem = { basic: 0, good: 0, better: 0, best: 0, unclassified: 0 }
  for (const r of redemptions) if (Number.isSafeInteger(r.quantity)) redeem[redeemTier(r.label) || 'unclassified'] += r.quantity
  const redemptionComplete = metrics.redemptions != null && valid(redemptions, 'quantity') && sum(redemptions, 'quantity') === metrics.redemptions
  if (!retailComplete) unresolved.push('Retail purchase mix has incomplete or unverified source items.')
  if (!redemptionComplete || redeem.unclassified) unresolved.push('Redemption tier mix is incomplete or unclassified.')
  return {
    memberRevenue, retailRevenue, premiumRetail, eligibleRetail, retailComplete, redeem, redemptionComplete, unresolved,
    sources: {
      member: memberLines.map(({ category, label, amount }) => ({ category, label, amount })),
      unclassifiedRetail: unknownSales.map(({ label, quantity }) => ({ label, quantity })),
      unclassifiedRedemptions: redemptions.filter(r => !redeemTier(r.label) && r.quantity)
        .map(({ label, quantity }) => ({ label, quantity })),
      packageBase,
    },
  }
}
