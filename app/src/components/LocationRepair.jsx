import { useAuth } from '../contexts/AuthContext'

export default function LocationRepair() {
  const { profile, locations, loading, locationError, repairingLocation, locationRepairMessage, reloadMyLocation } = useAuth()
  const message = locationError || locationRepairMessage || (
    loading ? 'Loading your current location…' : profile?.role === 'store' && !locations.length
      ? 'No location is assigned to your account. An Admin must assign your location.'
      : 'Reload your current authorized locations if your site is missing or incorrect.')
  return <section aria-label="Location recovery" className="my-4 rounded-xl border border-tm-teal/50 bg-white dark:bg-tm-dark-surface p-4 text-tm-navy dark:text-tm-dark-text space-y-3">
    <p role={locationError ? 'alert' : 'status'} aria-live="polite" className="text-sm">{message}</p>
    <button type="button" onClick={reloadMyLocation} disabled={repairingLocation || loading}
      className="rounded-md bg-tm-teal px-4 py-2 text-sm font-bold text-tm-navy disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tm-blue">
      {repairingLocation ? 'Reloading your location…' : 'Reload My Location'}
    </button>
  </section>
}
