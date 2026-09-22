import { supabase } from './supabase'

export const FEEDBACK_TYPES = [
  { value: 'bug', label: 'Bug' },
  { value: 'improvement', label: 'Improvement' },
  { value: 'feature_request', label: 'Feature request' },
  { value: 'other', label: 'Other' },
]

const SUBMIT_TYPES = new Set([
  ...FEEDBACK_TYPES.map((item) => item.value),
  'feature-interest',
])

export function currentPagePath(location) {
  return `${location.pathname}${location.search}${location.hash}`
}

export async function submitFeedback({ orgId, type, message, page }) {
  const trimmed = typeof message === 'string' ? message.trim() : ''

  if (!orgId) {
    return { error: new Error('No organization yet.') }
  }

  if (!SUBMIT_TYPES.has(type)) {
    return { error: new Error('Choose a feedback type.') }
  }

  if (!trimmed) {
    return { error: new Error('Message is required.') }
  }

  const { data, error } = await supabase.functions.invoke('send-feedback', {
    body: {
      org_id: orgId,
      type,
      message: trimmed,
      page: page || '/',
    },
  })

  if (error) {
    const fromBody =
      data && typeof data === 'object' && typeof data.error === 'string'
        ? data.error
        : null
    return { error: new Error(fromBody || error.message) }
  }

  if (data && typeof data === 'object' && typeof data.error === 'string') {
    return { error: new Error(data.error) }
  }

  return { error: null }
}

function feedbackInsertError(error) {
  const text = error?.message ?? 'Could not save this.'
  if (/feedback_type_check|violates check constraint/i.test(text)) {
    return 'Could not save this yet. Re-run schema.sql so feature-interest is allowed on the feedback table.'
  }
  return text
}

export async function submitFeatureInterest({ orgId, feature, page }) {
  const name = String(feature ?? '').trim()
  if (!name) {
    return { error: new Error('Choose a feature.') }
  }

  if (!orgId) {
    return { error: new Error('No organization yet.') }
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return { error: new Error(userError?.message ?? 'Sign in to continue.') }
  }

  const { error } = await supabase.from('feedback').insert({
    org_id: orgId,
    user_id: user.id,
    type: 'feature-interest',
    message: name,
    page: page || `feature:${name}`,
  })

  if (error) {
    return { error: new Error(feedbackInsertError(error)) }
  }

  return { error: null }
}
