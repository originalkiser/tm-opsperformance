// Fictional browser fixture only. Runner replaces the database module; no Auth session.
import React from 'react'
import { createRoot } from 'react-dom/client'
import ChecklistAdmin from '../../src/components/ChecklistAdmin'
import '../../src/index.css'
createRoot(document.getElementById('root')).render(<main className="p-4 max-w-6xl mx-auto dark:bg-tm-dark-bg dark:text-tm-dark-text"><ChecklistAdmin templates={[window.fixtureTemplate]} reload={async()=>{}} /></main>)
