import { supabase } from './supabase'

const TOKEN_FIELDS = 'id, org_id, site_id, label, status, created_at, last_used_at'

function mapToken(row) {
  return {
    id: row.id,
    org_id: row.org_id,
    site_id: row.site_id,
    label: row.label || '',
    status: row.status,
    created_at: row.created_at,
    last_used_at: row.last_used_at ?? null,
  }
}

export function mintFloorToken() {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export async function hashFloorToken(rawToken) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(rawToken),
  )
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export async function listSiteAccessTokens(orgId, siteId) {
  if (!orgId || !siteId) return { data: [], error: null }

  const { data, error } = await supabase
    .from('site_access_tokens')
    .select(TOKEN_FIELDS)
    .eq('org_id', orgId)
    .eq('site_id', siteId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })

  if (error) return { data: [], error }
  return { data: (data ?? []).map(mapToken), error: null }
}

export async function createSiteAccessToken({
  orgId,
  siteId,
  tokenHash,
  label,
  createdBy,
}) {
  const { data, error } = await supabase
    .from('site_access_tokens')
    .insert({
      org_id: orgId,
      site_id: siteId,
      token_hash: tokenHash,
      label: String(label || '').trim(),
      status: 'active',
      created_by: createdBy || null,
    })
    .select(TOKEN_FIELDS)
    .single()

  if (error) return { data: null, error }
  return { data: mapToken(data), error: null }
}

export async function revokeSiteAccessToken(id) {
  const { error } = await supabase
    .from('site_access_tokens')
    .update({ status: 'revoked' })
    .eq('id', id)
    .eq('status', 'active')

  return { error }
}
