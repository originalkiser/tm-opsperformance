// Ownership posts reset on the site's calendar date; wash goals have no date key.
export function ownershipBusinessDate(timeZone = 'America/Chicago', now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone || 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)
  const part = type => parts.find(value => value.type === type).value
  return `${part('year')}-${part('month')}-${part('day')}`
}
