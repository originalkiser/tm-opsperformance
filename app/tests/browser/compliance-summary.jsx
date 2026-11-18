import React from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import ChecklistCompliance from '../../src/pages/ChecklistCompliance'
import '../../src/index.css'
createRoot(document.getElementById('root')).render(<MemoryRouter><ChecklistCompliance /></MemoryRouter>)
