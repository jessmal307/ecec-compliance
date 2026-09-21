import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

const JWT_FUTURE_RE = /jwt issued at future|pgrst303/i
const JWT_SKEW_RETRY_DELAYS_MS = [300, 900]

function jwtFutureMessage(body) {
  if (!body || typeof body !== 'object') return ''
  return [body.message, body.code, body.error, body.error_description]
    .filter((value) => typeof value === 'string')
    .join(' ')
}

async function isJwtIssuedAtFuture(response) {
  if (response.status !== 401) return false
  try {
    const body = await response.clone().json()
    return JWT_FUTURE_RE.test(jwtFutureMessage(body))
  } catch {
    return false
  }
}

async function fetchWithJwtSkewRetry(input, init) {
  let response = await fetch(input, init)

  for (const delayMs of JWT_SKEW_RETRY_DELAYS_MS) {
    if (!(await isJwtIssuedAtFuture(response))) return response
    await new Promise((resolve) => setTimeout(resolve, delayMs))
    response = await fetch(input, init)
  }

  return response
}

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'public-anon-key',
  { global: { fetch: fetchWithJwtSkewRetry } },
)
