import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

// deno-lint-ignore no-explicit-any
type Supabase = SupabaseClient<any, any, any>

// The organisation owner's login email. Used when no alert address is set.
export async function ownerLoginEmail(supabase: Supabase, ownerId: string) {
  const { data, error } = await supabase.auth.admin.getUserById(ownerId)
  if (error) return { email: null as string | null, error }
  return { email: data.user?.email ?? null, error: null }
}
