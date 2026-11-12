import { useRef } from 'react'
import ChecklistForm from './ChecklistForm'
import { supabase, supabasePublicKey } from '../lib/supabase'
import { createChecklistTransport } from '../utils/checklistAccess'

// A separate transport keeps guest credentials out of the signed-in client and
// leaves the reusable question/signature UI independent of account identity.
export default function ChecklistAccessForm(props) {
  const transport = useRef(null)
  if (!transport.current) transport.current = createChecklistTransport(supabase, supabasePublicKey)
  return <ChecklistForm {...props} transport={transport.current} />
}
