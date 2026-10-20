import { useId, useState, useRef } from 'react'
import { parsePlansLost } from '../utils/dailyMemberships'

export default function PlansLostInput({ value, onChange, disabled, status, error }) {
  const id = useId()
  const dialog = useRef(null)
  const [help, setHelp] = useState(false)
  const [invalid, setInvalid] = useState(false)
  return <div data-plans-lost className="p-2 text-xs font-normal whitespace-normal text-tm-navy dark:text-tm-dark-text bg-white dark:bg-tm-dark-card rounded">
    <div className="flex items-center justify-center gap-1">
      <label htmlFor={id} className="text-[10px] font-bold">PLANS LOST TODAY</label>
      <button type="button" aria-label="Where to Find Plans Lost Today" aria-expanded={help} aria-controls={`${id}-help`}
        onClick={() => { setHelp(true); dialog.current.showModal() }} className="min-h-[44px] min-w-[44px] rounded focus-visible:outline focus-visible:outline-2">ⓘ</button>
    </div>
    <dialog ref={dialog} id={`${id}-help`} aria-labelledby={`${id}-title`} onClose={() => setHelp(false)}
      className="w-[calc(100%-2rem)] max-w-sm rounded-xl bg-white dark:bg-tm-dark-card text-tm-navy dark:text-tm-dark-text p-5 shadow-xl backdrop:bg-black/40 text-left font-normal">
      <h2 id={`${id}-title`} className="font-bold text-sm">Where to Find Plans Lost Today</h2>
      <p className="mt-3 text-sm">DRB Sites: Plan Analysis Report → Pass Plans Lost</p>
      <p className="mt-3 text-sm">Micrologic Sites: UNLIMITED GROWTH/CHURN BY DAY V1 → Growth</p>
      <button type="button" autoFocus onClick={() => dialog.current.close()} className="mt-4 min-h-[44px] px-4 border rounded">Close</button>
    </dialog>
    <input id={id} aria-invalid={invalid} aria-describedby={`${id}-status`} type="number" min="0" max="2147483647" step="1" inputMode="numeric"
      value={value ?? ''} disabled={disabled} onChange={e => { const next = e.target.value; setInvalid(parsePlansLost(next) === null); onChange(next) }}
      className="w-24 max-w-full border rounded p-2 text-center bg-transparent disabled:opacity-50" />
    <p id={`${id}-status`} role={error || invalid ? 'alert' : 'status'} className="mt-1 text-[10px]">
      {invalid ? 'Enter a nonnegative whole number.' : error || status || 'Enter losses, including zero.'}
    </p>
  </div>
}
