import React,{useState} from 'react'
import {createRoot} from 'react-dom/client'
import '../../src/index.css'
import EmployeeSelect from '../../src/components/EmployeeSelect.jsx'
const employees=[{id:'a',name:'Alex'},{id:'c',name:'Cam'},{id:'s',name:'Sam with a longer display name'}]
function Fixture(){
 const [value,setValue]=useState('Recorded nickname'),[dark,setDark]=useState(false),[state,setState]=useState('ready')
 return <main className="min-h-screen bg-white dark:bg-tm-dark-bg text-gray-800 dark:text-tm-dark-text p-4"><h1>Daily Log picker visual check</h1><button onClick={()=>{document.documentElement.classList.toggle('dark');setDark(!dark)}}>{dark?'Light mode':'Dark mode'}</button><label className="block">Roster state <select value={state} onChange={e=>setState(e.target.value)}><option>ready</option><option>empty</option><option>loading</option><option>error</option></select></label><p className="text-sm my-4">Recorded name: {value}</p><div className="grid grid-cols-2 gap-4 rounded-xl bg-gray-50 dark:bg-tm-dark-card p-3"><label>Hour <select className="block w-full bg-transparent"><option>8:00 AM</option></select></label><div><p>Employee</p><EmployeeSelect value={value} onChange={setValue} employees={state==='empty'?[]:employees} loading={state==='loading'} error={state==='error'?'offline':''} align="right" onRefresh={()=>{}}/></div></div><div className="grid grid-cols-2 gap-3 mt-4">{['Google Reviews','Total Washes','Member Washes','Basic'].map(label=><div key={label} className="border dark:border-tm-dark-border rounded-xl p-3"><p className="text-xs">{label}</p><p className="text-2xl">0</p></div>)}</div></main>
}
createRoot(document.getElementById('root')).render(<Fixture/> )
