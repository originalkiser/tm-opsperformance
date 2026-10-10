import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL

// The new-style publishable key (sb_publishable_…) wins when it's configured; otherwise
// the legacy anon key keeps being used. Both are public by design (row-level security is
// what protects the data). Adding/removing the publishable variable is the switch.
export const supabasePublicKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabasePublicKey) {
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY / VITE_SUPABASE_ANON_KEY — check GitHub repository secrets.')
}

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabasePublicKey || 'placeholder-key'
)
