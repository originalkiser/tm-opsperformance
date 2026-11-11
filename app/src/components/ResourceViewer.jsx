import { useEffect, useState } from 'react'
import { downloadResource } from '../utils/resourceLibrary'

export default function ResourceViewer({ client, document, userId, onClose }) {
  const [url, setUrl] = useState(''), [error, setError] = useState('')
  useEffect(() => {
    let alive = true, localUrl
    const controller = new AbortController()
    downloadResource(client, document, userId, controller.signal).then(blob => {
      if (!alive) return
      localUrl = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' })); setUrl(localUrl)
    }).catch(error => { if (alive) setError(error.message) })
    return () => { alive = false; controller.abort(); if (localUrl) URL.revokeObjectURL(localUrl) }
  }, [document.id, document.object_path, userId])
  return <div role="dialog" aria-modal="true" aria-label={document.title} className="fixed inset-0 z-50 bg-tm-cream dark:bg-tm-dark-bg flex flex-col p-3 gap-3">
    <div className="flex flex-wrap items-center gap-3"><h2 className="font-brand text-xl font-bold flex-1 text-tm-blue dark:text-tm-teal">{document.title}</h2><button autoFocus className="resource-control" onClick={onClose}>Close PDF</button></div>
    {error && <p role="alert">{error}</p>}
    {!error && !url && <p role="status">Loading PDF… Larger manuals may take a moment.</p>}
    {url && <>
      <div className="flex flex-wrap gap-3 text-sm">
        <a className="resource-control" href={url} target="_blank" rel="noopener noreferrer">Open PDF in new tab</a>
        <a className="resource-control" href={url} download={document.original_name?.split(/[\\/]/).pop() || 'document.pdf'}>Download PDF</a>
      </div>
      <p className="text-sm">If your device cannot display the preview, open the PDF in a new tab or download it.</p>
      <iframe title={`${document.title} PDF preview`} src={url} className="w-full flex-1 min-h-0 border border-gray-200 dark:border-tm-dark-border rounded-xl bg-white" />
    </>}
  </div>
}
