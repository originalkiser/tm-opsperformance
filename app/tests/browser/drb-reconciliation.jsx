import React from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import SalesReconciliation from '../../src/pages/SalesReconciliation'
import '../../src/index.css'
createRoot(document.getElementById('root')).render(<MemoryRouter><SalesReconciliation/></MemoryRouter>)
