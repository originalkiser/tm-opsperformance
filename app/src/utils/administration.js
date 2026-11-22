export const adminCategories = [
  { id: 'locations', label: 'Locations & Cash Management' },
  { id: 'budget', label: 'Budget & Performance Configuration' },
  { id: 'checklists', label: 'Checklists & Audits' },
  { id: 'people', label: 'People & Access' },
  { id: 'system', label: 'System Settings' },
]

export const adminTools = [
  { id: 'locations', category: 'locations', name: 'Location settings', scope: 'Per Location', description: 'Manage markets, site email, time zones, reporting visibility, operating hours overrides, and feature switches.', aliases: 'downtime budget ownership thresholds opportunities formula' },
  { id: 'cash-on-hand', category: 'locations', name: 'Cash on Hand', scope: 'Per Location', description: 'Set a verified fixed cash amount and effective business date, and review its history.', aliases: 'drawer float till cash reconciliation' },
  { id: 'operating-hours', category: 'locations', name: 'Operating hours', scope: 'Global', description: 'Set standard and winter hours used by locations without overrides.', aliases: 'opening closing schedule' },
  { id: 'budget_tracking', category: 'budget', name: 'Historical MTD Starting Balances', scope: 'Per Location', description: 'Manage historical revenue opening balances and review balance changes.', aliases: 'starting balance revenue cutoff' },
  { id: 'budget-labels', category: 'budget', name: 'Budget Tracker Labels', scope: 'Global', description: 'Edit or restore Budget Tracker field labels and help text.', aliases: 'budget labels wording helper text', restricted: true },
  { id: 'performance-settings', category: 'budget', name: 'Location performance settings', scope: 'Per Location', description: 'Open Location settings for performance thresholds, opportunities formulas, and Budget Tracking or Ownership Tools switches.', aliases: 'conversion p-mix thresholds scoring', tool: 'locations' },
  { id: 'budget-targets', category: 'budget', name: 'Budget targets and workbook import', scope: 'Site and Month', description: 'Open AM Entry to manage site targets or import a monthly budget workbook.', aliases: 'goals monthly import spreadsheet', path: '/am-entry' },
  { id: 'checklist-qr', category: 'checklists', name: 'Checklist QR access', scope: 'Per Location', description: 'Check, create, replace, or revoke a store’s guest checklist link.', aliases: 'qr code guest store access rotate revoke' },
  { id: 'checklist-templates', category: 'checklists', name: 'Checklist and audit templates', scope: 'Global', description: 'Edit, preview, and publish template drafts or see version history.', aliases: 'checklist templates management audits questions photos', restricted: true },
  { id: 'users', category: 'people', name: 'User accounts', scope: 'Per Account', description: 'Manage roles, site assignments, email, password resets, and account status.', aliases: 'permissions access deactivate reactivate delete restore' },
  { id: 'add_user', category: 'people', name: 'Add user', scope: 'Per Account', description: 'Create an account and issue its temporary password.', aliases: 'new user invite create account' },
  { id: 'employees', category: 'people', name: 'Employee roster administration', scope: 'Per Location', description: 'Add employees and manage roster activation by site.', aliases: 'staff employee roster' },
  { id: 'employee-mapping', category: 'people', name: 'Historical employee name mapping', scope: 'Per Location', description: 'Open Employees to review historical name mappings.', aliases: 'roster historical aliases duplicate names', path: '/employees', section: 'history' },
  { id: 'downtime', category: 'system', name: 'Downtime reasons and reporting connection', scope: 'Global', description: 'Maintain reason categories and view the Power BI / Data Lake connection reference. The downtime log remains here.', aliases: 'downtime reasons powerbi power bi data lake' },
  { id: 'jotform', category: 'system', name: 'Jotform integration', scope: 'Global', description: 'Configure the downtime form and field mappings.', aliases: 'jotform downtime integration' },
  { id: 'resources', category: 'system', name: 'Resource library administration', scope: 'Global', description: 'Open Resources to manage shared folders, PDFs, and document details.', aliases: 'resource catalog document file upload', path: '/resources' },
]

export function availableAdminTools(canEditConfiguration) {
  return adminTools.filter(tool => !tool.restricted || canEditConfiguration)
}

export function findAdminTools(tools, query) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return tools.filter(({ name, description, aliases }) => {
    const searchable = `${name} ${description} ${aliases}`.toLowerCase()
    return terms.every(term => searchable.includes(term))
  })
}

export function adminDestination(tool, site) {
  const params = new URLSearchParams({ tool })
  if (site) params.set('site', site)
  return `/admin?${params}`
}

export function scopedAdminSite(locations, requested) {
  return locations.find(location => location.id === requested)?.id || ''
}
