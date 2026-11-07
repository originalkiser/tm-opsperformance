import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.58.0'
import { projectKeys } from '../_shared/keys.ts'
import { cleanupResourceFiles } from './handler.js'

Deno.serve(async req => {
  const { url, publishableKey, secretKey } = projectKeys()
  const user = createClient(url, publishableKey, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false } })
  const storage = createClient(url, secretKey, { auth: { persistSession: false } })
  return cleanupResourceFiles(req, user, storage)
})
