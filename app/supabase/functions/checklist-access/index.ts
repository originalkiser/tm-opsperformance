import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.58.0'
import { projectKeys } from '../_shared/keys.ts'
import { checklistAccess } from './handler.js'

Deno.serve(async req => {
  const { url, publishableKey, secretKey } = projectKeys()
  const user = createClient(url, publishableKey, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false } })
  const server = createClient(url, secretKey, { auth: { persistSession: false } })
  return checklistAccess(req, user, server)
})
