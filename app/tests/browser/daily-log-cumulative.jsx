// Fictional, hosted-traffic-blocked browser validation. No real session or client.
import React from 'react'
import { createRoot } from 'react-dom/client'
import Dashboard from '../../src/pages/Dashboard'
import '../../src/index.css'
createRoot(document.getElementById('root')).render(<><nav><a href="/away">Fictional Reports</a><button onClick={()=>window.signedOut=true}>Sign Out</button></nav><Dashboard /></>)
