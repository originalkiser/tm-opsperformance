// User-account actions that need Supabase's admin API: create a user, reset a
// password, change an email, permanently delete a user.
//
// These used to run in the browser with the service-role key, which meant that key
// (it bypasses ALL database security) was baked into the public JavaScript bundle.
// Here the key stays on the server and the caller's role is checked first.
//
// POST { action, ... }  (caller must be signed in)
//   create          { email, name? }          admin only        → { ok, temp_password }
//   reset_password  { user_id }               admin, or an area manager for a STORE user
//                                             at one of their assigned locations
//                                                               → { ok, temp_password }
//   change_email    { user_id, new_email }    admin only        → { ok }
//   delete          { user_id }               admin only; the user must already be in
//                                             "Deleted Users" and not be the caller
//                                                               → { ok }
//   anything else / not allowed               → { ok: false, error }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { projectKeys } from '../_shared/keys.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

// Same alphabet as the old browser version (no look-alike characters), but drawn from
// the OS random source instead of Math.random, with rejection sampling to avoid bias.
const PASSWORD_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
function generatePassword(length = 10) {
  const limit = 256 - (256 % PASSWORD_CHARS.length)
  let out = ''
  while (out.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length * 2))
    for (const b of bytes) {
      if (b < limit && out.length < length) out += PASSWORD_CHARS[b % PASSWORD_CHARS.length]
    }
  }
  return out
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const { url, publishableKey: anonKey, secretKey: serviceKey } = projectKeys()

  // deno-lint-ignore no-explicit-any
  let body: any = null
  try { body = await req.json() } catch { /* handled below */ }
  const action = body?.action
  if (!action) return json({ ok: false, error: 'action is required' }, 400)

  // ── Who is calling? ──────────────────────────────────────────────────────────
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const { data: { user }, error: authError } = await userClient.auth.getUser()
  if (authError || !user) return json({ ok: false, error: 'Unauthorized' }, 401)

  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

  const { data: caller } = await admin.from('user_profiles')
    .select('role, is_active').eq('id', user.id).maybeSingle()
  if (!caller || caller.is_active === false) return json({ ok: false, error: 'Forbidden' }, 403)
  const isAdmin   = caller.role === 'admin'
  const isAreaMgr = caller.role === 'area_manager'

  try {
    switch (action) {
      case 'create': {
        if (!isAdmin) return json({ ok: false, error: 'Only admins can add users' }, 403)
        const email = String(body.email ?? '').trim()
        const name  = String(body.name ?? '').trim()
        if (!EMAIL_RE.test(email)) return json({ ok: false, error: 'Enter a valid email address' }, 400)

        const tempPassword = generatePassword()
        const { error } = await admin.auth.admin.createUser({
          email, password: tempPassword, email_confirm: true, user_metadata: { name },
        })
        if (error) return json({ ok: false, error: error.message })
        return json({ ok: true, temp_password: tempPassword })
      }

      case 'reset_password': {
        const userId = String(body.user_id ?? '')
        if (!userId) return json({ ok: false, error: 'user_id is required' }, 400)

        if (!isAdmin) {
          // Area managers: only store users at one of their assigned locations.
          if (!isAreaMgr) return json({ ok: false, error: 'Forbidden' }, 403)
          const { data: target } = await admin.from('user_profiles')
            .select('role, location_id').eq('id', userId).maybeSingle()
          if (!target || target.role !== 'store' || !target.location_id) {
            return json({ ok: false, error: 'Forbidden' }, 403)
          }
          const { data: link } = await admin.from('manager_locations').select('location_id')
            .eq('manager_id', user.id).eq('location_id', target.location_id).maybeSingle()
          if (!link) return json({ ok: false, error: 'Forbidden' }, 403)
        }

        const tempPassword = generatePassword()
        const { error } = await admin.auth.admin.updateUserById(userId, { password: tempPassword })
        if (error) return json({ ok: false, error: error.message })
        return json({ ok: true, temp_password: tempPassword })
      }

      case 'change_email': {
        if (!isAdmin) return json({ ok: false, error: 'Only admins can change emails' }, 403)
        const userId   = String(body.user_id ?? '')
        const newEmail = String(body.new_email ?? '').trim()
        if (!userId) return json({ ok: false, error: 'user_id is required' }, 400)
        if (!EMAIL_RE.test(newEmail)) return json({ ok: false, error: 'Enter a valid email address' }, 400)

        const { error } = await admin.auth.admin.updateUserById(userId, { email: newEmail })
        if (error) return json({ ok: false, error: error.message })
        await admin.from('user_profiles').update({ email: newEmail }).eq('id', userId)
        return json({ ok: true })
      }

      case 'delete': {
        if (!isAdmin) return json({ ok: false, error: 'Only admins can delete users' }, 403)
        const userId = String(body.user_id ?? '')
        if (!userId) return json({ ok: false, error: 'user_id is required' }, 400)
        if (userId === user.id) return json({ ok: false, error: "You can't delete your own account" }, 400)

        // Permanent deletion is only for users already moved to "Deleted Users".
        const { data: target } = await admin.from('user_profiles')
          .select('deleted_at').eq('id', userId).maybeSingle()
        if (!target?.deleted_at) {
          return json({ ok: false, error: 'Move the user to Deleted Users first' }, 400)
        }
        const { error } = await admin.auth.admin.deleteUser(userId)
        if (error) return json({ ok: false, error: error.message })
        return json({ ok: true })
      }

      default:
        return json({ ok: false, error: `Unknown action: ${action}` }, 400)
    }
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) })
  }
})
