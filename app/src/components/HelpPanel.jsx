import { useEffect, useRef } from 'react'
import LocationRepair from './LocationRepair'

export default function HelpPanel({ onClose }) {
  const dialog = useRef(null)
  useEffect(() => {
    const element = dialog.current
    element.showModal()
    return () => element.close()
  }, [])
  const close = () => { dialog.current.close(); onClose() }
  return <dialog ref={dialog} aria-labelledby="tm-help-title" onCancel={event => { event.preventDefault(); close() }}
    onClick={event => { if (event.target === event.currentTarget) close() }}
    className="w-[calc(100%-2rem)] max-w-xl max-h-[85vh] rounded-2xl bg-white dark:bg-tm-dark-card p-0 text-tm-navy dark:text-tm-dark-text shadow-2xl backdrop:bg-black/50">
    <div className="flex items-center justify-between gap-4 bg-tm-navy px-5 py-4 text-white">
      <h2 id="tm-help-title" className="font-brand font-bold">Help — Missing My Location</h2>
      <button type="button" autoFocus onClick={close} aria-label="Close Help" className="rounded px-3 py-1 text-tm-teal hover:bg-white/10 focus-visible:outline focus-visible:outline-2">Close</button>
    </div>
    <div className="space-y-4 p-5 text-sm">
      <p>Start with Reload My Location. It checks your current assignment without clearing your sign-in or changing your access.</p>
      <LocationRepair />
      <h3 className="font-bold">Still missing? Microsoft Edge steps</h3>
      <p>Save any unfinished work before refreshing or clearing site data.</p>
      <ol className="list-decimal space-y-3 pl-5">
        <li>Refresh TM Operations with <kbd>Ctrl + R</kbd> (Windows) or <kbd>⌘ + R</kbd> (Mac). Try Reload My Location again.</li>
        <li>If the problem continues, open Edge’s <strong>… → Settings</strong>. Search Settings for <strong>cookies</strong>, then open <strong>See all cookies and site data</strong> under the Cookies settings. Some Edge versions call this <strong>See all site data and permissions</strong>.</li>
        <li>Search for the exact website address shown in your TM Operations address bar: <strong>{window.location.hostname}</strong>. Expand that site and delete only its cookies and site data. Keep data for other websites.</li>
        <li>Return to TM Operations, refresh the page, and sign in again. Choose your assigned location if a location selector appears.</li>
      </ol>
      <p>If your location is still missing, ask an Admin to verify your Store account’s location assignment. Clearing browser data cannot create an assignment.</p>
      <a className="inline-block font-semibold text-tm-blue dark:text-tm-teal underline" href="https://support.microsoft.com/en-us/edge/manage-cookies-in-microsoft-edge-view-allow-block-delete-and-use" target="_blank" rel="noreferrer">Microsoft Edge cookie instructions</a>
    </div>
  </dialog>
}
