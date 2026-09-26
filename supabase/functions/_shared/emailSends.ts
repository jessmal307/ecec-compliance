import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { chunk } from './batch.ts'
import { retryOnJwtSkew } from './retry.ts'

// deno-lint-ignore no-explicit-any
type Supabase = SupabaseClient<any, any, any>
export type EmailSendKind = 'alert_digest' | 'monthly_report'

const STALE_CLAIM_MINUTES = 10

export type StaleClaim = { org_id: string; period: string; created_at: string }

// A claim still 'sending' after this long belongs to a run that died before
// finishing. Deleting it also deletes its alert rows, so they are re-sent.
export async function clearStaleClaims(supabase: Supabase, kind: EmailSendKind) {
  const cutoff = new Date(Date.now() - STALE_CLAIM_MINUTES * 60_000).toISOString()
  const { data, error } = await retryOnJwtSkew(
    () =>
      supabase
        .from('email_sends')
        .select('id, org_id, period, created_at')
        .eq('kind', kind)
        .eq('status', 'sending')
        .lt('created_at', cutoff),
    'stale email_sends',
  )
  if (error) return { cleared: [] as StaleClaim[], error: error.message ?? 'unknown error' }

  const rows = (data ?? []) as (StaleClaim & { id: string })[]
  const cleared: StaleClaim[] = []
  for (const batch of chunk(rows)) {
    const { error: deleteError } = await supabase
      .from('email_sends')
      .delete()
      .in(
        'id',
        batch.map((row) => row.id),
      )
    if (deleteError) return { cleared, error: deleteError.message ?? 'unknown error' }
    cleared.push(
      ...batch.map((row) => ({ org_id: row.org_id, period: row.period, created_at: row.created_at })),
    )
  }
  return { cleared, error: null as string | null }
}

// Returns the claim id, or null with alreadyClaimed when another run holds it.
export async function claimSend(
  supabase: Supabase,
  { orgId, kind, period, itemCount }: { orgId: string; kind: EmailSendKind; period: string; itemCount?: number },
) {
  const { data, error } = await supabase
    .from('email_sends')
    .insert({ org_id: orgId, kind, period, item_count: itemCount ?? null })
    .select('id')
    .single()
  if (error?.code === '23505') return { id: null, alreadyClaimed: true, error: null }
  if (error || !data?.id) {
    return { id: null, alreadyClaimed: false, error: error?.message ?? 'no claim id returned' }
  }
  return { id: data.id as string, alreadyClaimed: false, error: null }
}

export async function releaseClaim(supabase: Supabase, claimId: string) {
  const { error } = await supabase.from('email_sends').delete().eq('id', claimId)
  return error ? error.message ?? 'unknown error' : null
}

export async function markSent(supabase: Supabase, claimId: string) {
  const { error } = await supabase
    .from('email_sends')
    .update({ status: 'sent', sent_at: new Date().toISOString() })
    .eq('id', claimId)
  return error ? error.message ?? 'unknown error' : null
}
