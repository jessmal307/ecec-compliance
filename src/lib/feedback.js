import { supabase } from './supabase'

export const FEEDBACK_TYPES = [
  { value: 'bug', label: 'Bug' },
  { value: 'improvement', label: 'Improvement' },
  { value: 'feature_request', label: 'Feature request' },
  { value: 'other', label: 'Other' },
]

export function currentPagePath(location) {
  return `${location.pathname}${location.search}${location.hash}`
}

export async function submitFeedback({ orgId, type, message, page }) {
  const trimmed = typeof message === 'string' ? message.trim() : ''

  if (!orgId) {
    return { error: new Error('No organization yet.') }
  }

  if (!FEEDBACK_TYPES.some((item) => item.value === type)) {
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
