import React from 'react'
import {createRoot} from 'react-dom/client'
import {MemoryRouter} from 'react-router-dom'
import ManagerChecklists from '../../src/pages/ManagerChecklists'
import GuestChecklists from '../../src/pages/GuestChecklists'
import '../../src/index.css'
const Component=window.fixtureMode==='guest'?GuestChecklists:ManagerChecklists
createRoot(document.getElementById('root')).render(<MemoryRouter><Component /></MemoryRouter>)
