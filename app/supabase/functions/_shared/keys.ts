// The project's API keys as seen from inside an edge function.
//
// Supabase injects the new-style keys (publishable `sb_publishable_…`, secret
// `sb_secret_…`) as SUPABASE_PUBLISHABLE_KEYS / SUPABASE_SECRET_KEYS, and the legacy
// JWT keys as SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY (until legacy keys are
// disabled in the dashboard, after which the legacy ones stop working). Prefer the
// new keys so these functions keep working once the legacy ones are switched off,
// and fall back to the legacy ones if the new variables aren't present.

function pickKey(raw: string | undefined): string {
  if (!raw) return ''
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed === 'string') return parsed
    if (parsed && typeof parsed === 'object') {
      const values = parsed as Record<string, unknown>
      const key = values.default ?? Object.values(values)[0]
      return typeof key === 'string' ? key : ''
    }
  } catch { /* not JSON — treat as the key itself */ }
  return raw
}

export function projectKeys() {
  return {
    url: Deno.env.get('SUPABASE_URL') ?? '',
    publishableKey: pickKey(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')) || (Deno.env.get('SUPABASE_ANON_KEY') ?? ''),
    secretKey: pickKey(Deno.env.get('SUPABASE_SECRET_KEYS')) || (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''),
  }
}
