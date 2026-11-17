import { useAuth } from '../contexts/AuthContext'
// Keep the same form components and layout; disable their controls only in Admin preview.
export default function PreviewReadOnly({ children }) {
  const { managerPreview } = useAuth()
  return managerPreview ? <fieldset disabled className="m-0 min-w-0 border-0 p-0" aria-label="Read-only Store form preview">{children}</fieldset> : children
}
