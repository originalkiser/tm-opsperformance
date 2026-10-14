// Read-only refresh: corrections made by other users appear without a page reload.
// Polling avoids requiring any database publication or permission changes.
export function watchBudgetReport(load, {
  page = document,
  schedule = setInterval,
  cancel = clearInterval,
} = {}) {
  let active = true, busy = false
  const refresh = async () => {
    if (!active || busy || page.visibilityState === 'hidden') return
    busy = true
    try { await load() } finally { busy = false }
  }
  const timer = schedule(refresh, 60000)
  page.addEventListener('visibilitychange', refresh)
  return () => { active = false; cancel(timer); page.removeEventListener('visibilitychange', refresh) }
}
