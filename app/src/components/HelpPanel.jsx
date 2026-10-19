import { useEffect, useRef } from 'react'
import LocationRepair from './LocationRepair'
import edgeSettings from '../assets/help/edge-settings.png'
import edgeManageCookies from '../assets/help/edge-manage-cookies.png'
import edgeSiteData from '../assets/help/edge-site-data.png'
import edgeDeleteSite from '../assets/help/edge-delete-site.png'

function EdgeScreenshot({ src, alt, caption, width, height }) {
  return <figure className="mt-3 space-y-2">
    <a href={src} target="_blank" rel="noreferrer" aria-label={`View full-size screenshot: ${alt}`} className="block rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tm-teal">
      <img src={src} alt={alt} width={width} height={height} loading="lazy" decoding="async" className="block h-auto w-full max-w-full rounded border border-gray-300 dark:border-tm-dark-border" />
    </a>
    <figcaption className="text-xs text-gray-600 dark:text-tm-dark-muted">{caption}</figcaption>
  </figure>
}

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
      <p>Still missing? Refresh TM Operations with <kbd>Ctrl + R</kbd> (Windows) or <kbd>⌘ + R</kbd> (Mac), then try Reload My Location again. Save unfinished work before refreshing.</p>
      <details className="rounded-lg border border-gray-300 dark:border-tm-dark-border p-3">
        <summary className="cursor-pointer font-bold">Microsoft Edge: clear only TM Operations site data</summary>
        <div className="mt-4 space-y-4">
          <p>Use these steps only if Reload My Location and refreshing did not help. Save unfinished work; you may need to sign in again. Select any screenshot to view it full size.</p>
          <ol className="list-decimal space-y-5 pl-5">
            <li>Open Edge’s <strong>…</strong> menu, then <strong>Settings</strong>.
              <EdgeScreenshot src={edgeSettings} width={601} height={1122} alt="Edge menu with Settings circled" caption="Open Settings, not Delete browsing data." />
            </li>
            <li>Search Settings for <strong>cookies</strong> and open <strong>Manage cookies</strong>.
              <EdgeScreenshot src={edgeManageCookies} width={1167} height={191} alt="Edge Settings with Manage cookies circled" caption="Manage cookies opens the site-specific settings." />
            </li>
            <li>Select <strong>See all cookies and site data</strong>. Some Edge versions call this <strong>See all site data and permissions</strong>.
              <EdgeScreenshot src={edgeSiteData} width={1247} height={471} alt="Edge Cookies settings with See all cookies and site data circled" caption="Open the list of individual websites." />
            </li>
            <li>Search for <strong className="break-all">{window.location.hostname}</strong> — the exact hostname in your TM Operations address bar. Expand only that site and select the trash icon beside its matching row.
              <p className="mt-2 font-semibold">Do not use Delete displayed data or clear all browser cookies. Leave github.com, github.dev and other unrelated sites alone.</p>
              <EdgeScreenshot src={edgeDeleteSite} width={936} height={517} alt="Example of the trash icon beside the originalkiser.github.io site row in Edge" caption="Example only: this screenshot searches for GitHub. Instead, search for the exact TM Operations hostname shown above and delete only its matching row." />
            </li>
            <li>Return to TM Operations, refresh, and sign in again if prompted. Choose your assigned location if a selector appears.</li>
          </ol>
        </div>
      </details>
      <p>If your location is still missing, ask an Admin to verify your Store account’s location assignment. Clearing browser data cannot create an assignment.</p>
      <a className="inline-block font-semibold text-tm-blue dark:text-tm-teal underline" href="https://support.microsoft.com/en-us/edge/manage-cookies-in-microsoft-edge-view-allow-block-delete-and-use" target="_blank" rel="noreferrer">Microsoft Edge cookie instructions</a>
    </div>
  </dialog>
}
