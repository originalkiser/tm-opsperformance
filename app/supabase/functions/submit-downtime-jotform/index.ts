// Sends a resolved downtime to the Jotform "Downtime Update" form.
//
// This used to run in the browser of whoever ended the downtime, reading the Jotform
// API key out of app_settings with that user's own login. Store logins can't read that
// row, so for store users it silently did nothing. Doing it here means the hand-off no
// longer depends on who clicked, their network, or whether they closed the tab — and
// the Jotform API key never has to reach a browser.
//
// POST { downtime_log_id, dry_run? }  (caller must be signed in)
//   → { ok: true, submission_id }                        sent (or was already sent)
//   → { ok: true, in_progress: true }                    another attempt is mid-flight
//   → { ok: true, dry_run: true, fields: [[k, v], ...] } admin/AM only; nothing is sent
//   → { ok: false, error }                               recorded on the row as 'failed'

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildSubmissionFields } from './build.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

// An attempt marked 'sending' for longer than this is assumed dead and may be retried.
const STALE_SENDING_MS = 2 * 60 * 1000

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const url        = Deno.env.get('SUPABASE_URL') ?? ''
  const anonKey    = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

  let downtimeLogId: string | undefined
  let dryRun = false
  try {
    const body = await req.json()
    downtimeLogId = body?.downtime_log_id
    dryRun = body?.dry_run === true
  } catch { /* handled below */ }
  if (!downtimeLogId) return json({ ok: false, error: 'downtime_log_id is required' }, 400)

  // ── Who is calling? ──────────────────────────────────────────────────────────
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const { data: { user }, error: authError } = await userClient.auth.getUser()
  if (authError || !user) return json({ ok: false, error: 'Unauthorized' }, 401)

  const admin = createClient(url, serviceKey)

  const { data: log } = await admin.from('downtime_logs').select('*').eq('id', downtimeLogId).maybeSingle()
  if (!log) return json({ ok: false, error: 'Downtime not found' }, 404)

  const { data: prof } = await admin.from('user_profiles').select('role, location_id').eq('id', user.id).maybeSingle()
  let allowed = false
  if (prof?.role === 'admin') allowed = true
  else if (prof?.role === 'area_manager') {
    const { data: link } = await admin.from('manager_locations').select('location_id')
      .eq('manager_id', user.id).eq('location_id', log.location_id).maybeSingle()
    allowed = !!link
  } else if (prof?.role === 'store') allowed = prof.location_id === log.location_id
  if (!allowed) return json({ ok: false, error: 'Forbidden' }, 403)

  if (log.status !== 'resolved' || !log.ended_at) {
    return json({ ok: false, error: 'This downtime has not been resolved yet' }, 400)
  }
  if (dryRun && !['admin', 'area_manager'].includes(prof?.role)) {
    return json({ ok: false, error: 'Forbidden' }, 403)
  }

  // Already sent — never create a second Jotform record for the same downtime.
  if (log.jotform_submission_id && !dryRun) {
    return json({ ok: true, already_sent: true, submission_id: log.jotform_submission_id })
  }

  // ── Claim this downtime so two simultaneous attempts can't both submit it ────
  if (!dryRun) {
    const staleBefore = new Date(Date.now() - STALE_SENDING_MS).toISOString()
    const { data: claimed } = await admin.from('downtime_logs')
      .update({ jotform_status: 'sending', jotform_error: null, jotform_attempted_at: new Date().toISOString() })
      .eq('id', downtimeLogId)
      .is('jotform_submission_id', null)
      .or(`jotform_status.is.null,jotform_status.neq.sending,jotform_attempted_at.lt.${staleBefore}`)
      .select('id')
    if (!claimed?.length) return json({ ok: true, in_progress: true })
  }

  const fail = async (message: string) => {
    if (!dryRun) {
      await admin.from('downtime_logs')
        .update({ jotform_status: 'failed', jotform_error: message.slice(0, 500) })
        .eq('id', downtimeLogId)
    }
    return json({ ok: false, error: message })
  }

  let apiKey = ''
  try {
    // ── Settings + location ────────────────────────────────────────────────────
    const { data: settings } = await admin.from('app_settings').select('key, value').in('key', ['jotform', 'operating_hours'])
    const jotform = settings?.find((s) => s.key === 'jotform')?.value
    const hours   = settings?.find((s) => s.key === 'operating_hours')?.value
    if (!jotform?.form_id || !jotform?.api_key || !jotform?.mappings) {
      return await fail('Jotform integration is not configured (Admin → JotForm Integration)')
    }
    apiKey = jotform.api_key

    const { data: location } = await admin.from('locations')
      .select('name, timezone, operating_hours_override, site_email').eq('id', log.location_id).maybeSingle()
    if (!location) return await fail('Location not found for this downtime')

    const fields = buildSubmissionFields(log, location, hours, jotform.mappings)
    if (dryRun) return json({ ok: true, dry_run: true, form_id: jotform.form_id, fields })

    // ── Send ───────────────────────────────────────────────────────────────────
    const form = new FormData()
    for (const [k, v] of fields) form.append(k, v)

    const resp = await fetch(
      `https://api.jotform.com/form/${jotform.form_id}/submissions?apiKey=${encodeURIComponent(apiKey)}`,
      { method: 'POST', body: form },
    )
    const text = await resp.text()
    let result: { content?: { submissionID?: string }; message?: string } | null = null
    try { result = JSON.parse(text) } catch { /* non-JSON body */ }

    const submissionId = result?.content?.submissionID
    if (!resp.ok || !submissionId) {
      return await fail(`Jotform ${resp.status}: ${result?.message ?? text.slice(0, 200)}`)
    }

    await admin.from('downtime_logs')
      .update({ jotform_submission_id: String(submissionId), jotform_status: 'sent', jotform_error: null })
      .eq('id', downtimeLogId)
    return json({ ok: true, submission_id: String(submissionId) })
  } catch (err) {
    // Network errors can echo the request URL (which contains the API key) — scrub it.
    let message = err instanceof Error ? err.message : String(err)
    if (apiKey) message = message.split(apiKey).join('***')
    return await fail(message)
  }
})
