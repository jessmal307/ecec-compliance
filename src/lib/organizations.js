import { supabase } from './supabase'

function emptyToNull(value) {
  const trimmed = typeof value === 'string' ? value.trim() : value
  return trimmed ? trimmed : null
}

function defaultOrgName(user) {
  const fromMeta = user.user_metadata?.organization_name
  if (fromMeta) return fromMeta
  const localPart = user.email?.split('@')[0] ?? 'My'
  return `${localPart}'s organization`
}

export async function getOrganization(id) {
  const { data, error } = await supabase
    .from('organizations')
    .select('id, name, owner_id, alert_email, plan, created_at')
    .eq('id', id)
    .single()

  if (error) {
    return { data: null, error }
  }

  return { data, error: null }
}

export async function updateOrganization(id, { name, alertEmail }) {
  const payload = {}
  if (name !== undefined) payload.name = name.trim()
  if (alertEmail !== undefined) payload.alert_email = emptyToNull(alertEmail)

  const { data, error } = await supabase
    .from('organizations')
    .update(payload)
    .eq('id', id)
    .select('id, name, owner_id, alert_email, plan, created_at')
    .single()

  if (error) {
    return { data: null, error }
  }

  return { data, error: null }
}

export async function ensureOrganization(user) {
  if (!user) return null

  if (user.user_metadata?.organization_id) {
    return user.user_metadata.organization_id
  }

  const { data: existing, error: selectError } = await supabase
    .from('organizations')
    .select('id')
    .eq('owner_id', user.id)
    .maybeSingle()

  if (selectError) {
    console.error('Failed to look up organization', selectError)
    return null
  }

  let organizationId = existing?.id

  if (!organizationId) {
    const { data: created, error: insertError } = await supabase
      .from('organizations')
      .insert({
        name: defaultOrgName(user),
        owner_id: user.id,
        alert_email: user.email ?? null,
      })
      .select('id')
      .single()

    if (insertError) {
      const { data: raced } = await supabase
        .from('organizations')
        .select('id')
        .eq('owner_id', user.id)
        .maybeSingle()

      organizationId = raced?.id
      if (!organizationId) {
        console.error('Failed to create organization', insertError)
        return null
      }
    } else {
      organizationId = created.id
    }
  }

  const { error: updateError } = await supabase.auth.updateUser({
    data: { organization_id: organizationId },
  })

  if (updateError) {
    console.error('Failed to store organization_id on the user', updateError)
  }

  return organizationId
}
