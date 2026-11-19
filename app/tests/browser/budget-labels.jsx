import React from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import ManagerChecklists from '../../src/pages/ManagerChecklists'
import BudgetTrackingSection from '../../src/components/BudgetTrackingSection'
import * as report from '../../src/components/BudgetTrackingReport'
import '../../src/index.css'
// The isolated runner exports the existing private correction pane without changing production code.
const CorrectionPane = report.DailyEntryPane
createRoot(document.getElementById('root')).render(<MemoryRouter><ManagerChecklists /><main className="mx-auto max-w-5xl space-y-4 bg-tm-cream p-4 text-slate-900 dark:bg-tm-dark-bg dark:text-tm-dark-text"><section aria-label="Site Entry fixture"><h2>Site Entry</h2><BudgetTrackingSection locations={[window.site]} profile={window.profile} /></section><section aria-label="Admin correction fixture"><h2>Admin correction</h2><CorrectionPane location={window.site} /></section></main></MemoryRouter>)
