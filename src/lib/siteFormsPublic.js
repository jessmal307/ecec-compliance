const TIME_ZONE = 'Australia/Sydney'
const INACTIVE_MESSAGE =
  'This link is no longer active — please contact your service.'

function siteFormsUrl() {
  const base = import.meta.env.VITE_SUPABASE_URL
  return base ? `${base.replace(/\/$/, '')}/functions/v1/site-forms` : ''
}

function todayParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value
  return { year, month, day }
}

export function todayIsoDate() {
  const { year, month, day } = todayParts()
  if (!year || !month || !day) return new Date().toISOString().slice(0, 10)
  return `${year}-${month}-${day}`
}

export function isSignatureDataUrl(value) {
  return typeof value === 'string' && value.startsWith('data:image/')
}

export function emptyFormState() {
  return {
    values: {},
    notes: {},
    signoff: { name: '', date: todayIsoDate(), note: '', signature: '' },
    rows: [],
  }
}

function fieldFilled(field, value) {
  if (field.type === 'checkbox') return Boolean(value)
  if (field.type === 'signature') {
    return isSignatureDataUrl(value) || Boolean(String(value || '').trim())
  }
  return String(value ?? '').trim() !== ''
}

export function validateFormSubmission(schema, archetype, state) {
  const errors = []
  const fields =
    archetype === 'checklist'
      ? (schema?.items ?? []).map((item) => ({ ...item, type: 'checkbox' }))
      : Array.isArray(schema?.fields)
        ? schema.fields
        : Array.isArray(schema?.items)
          ? schema.items
          : []

  for (const field of fields) {
    if (!field.required) continue
    if (!fieldFilled(field, state.values?.[field.id])) {
      errors.push(`Fill ${field.label || 'required fields'}.`)
    }
  }

  if (schema?.signoff?.required) {
    if (!String(state.signoff?.name || '').trim()) {
      errors.push('Enter the sign-off name.')
    }
    if (!state.signoff?.date) {
      errors.push('Enter the sign-off date.')
    }
    if (
      schema.signoff.signature !== false &&
      !fieldFilled({ type: 'signature' }, state.signoff?.signature)
    ) {
      errors.push('Draw the sign-off signature.')
    }
  }

  return [...new Set(errors)]
}

export function buildPublicSubmissionData(state) {
  const signoff = { ...(state?.signoff || {}) }
  if (isSignatureDataUrl(signoff.signature)) signoff.signature = ''
  const fields = state?.values || {}
  const rows = state?.rows || []
  return {
    room: '',
    values: fields,
    fields,
    notes: state?.notes || {},
    signoff: {
      name: signoff.name || '',
      date: signoff.date || '',
      note: signoff.note || '',
      signature: signoff.signature || '',
    },
    rows,
    hazards: rows,
  }
}

export async function dataUrlToBlob(dataUrl) {
  const response = await fetch(dataUrl)
  return response.blob()
}

function friendlyGatewayError(status, payload) {
  if (status === 401) return INACTIVE_MESSAGE
  if (status === 404) return 'The forms service is not available. Try again later.'
  if (status === 409) {
    const message = String(payload?.error || '')
    if (/locked/i.test(message)) return 'This form is already completed.'
    return message || 'Already completed for this period.'
  }
  if (status === 429) return 'Too many tries. Wait a minute and try again.'
  if (status === 403) return 'This form is not available on this link.'
  if (status === 400) return String(payload?.error || 'Check the form and try again.')
  if (payload?.error) return String(payload.error)
  return 'Something went wrong. Try again.'
}

const REQUEST_TIMEOUT_MS = 15000

async function siteFormsRequest(token, { method, body } = {}) {
  const url = siteFormsUrl()
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!url || !anonKey || !token) {
    return { data: null, error: { message: INACTIVE_MESSAGE, status: 401 } }
  }

  const requestUrl =
    (method || 'GET') === 'GET'
      ? `${url}?token=${encodeURIComponent(token)}`
      : url
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(requestUrl, {
      method: method || 'GET',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        'x-site-token': token,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })

    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      return {
        data: payload,
        error: {
          message: friendlyGatewayError(response.status, payload),
          status: response.status,
        },
      }
    }
    return { data: payload, error: null }
  } catch (error) {
    const timedOut = error?.name === 'AbortError'
    return {
      data: null,
      error: {
        message: timedOut
          ? 'The forms service timed out. Try again.'
          : 'Could not reach the forms service. Try again.',
        status: timedOut ? 408 : 0,
      },
    }
  } finally {
    clearTimeout(timer)
  }
}

export async function getSiteForms(token) {
  return siteFormsRequest(token, { method: 'GET' })
}

export async function saveSiteForm(token, body) {
  return siteFormsRequest(token, { method: 'POST', body })
}

export async function uploadSignature(signedUrl, blob) {
  if (!signedUrl) return { error: { message: 'Could not upload the signature.' } }
  const response = await fetch(signedUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': blob.type || 'image/png',
      'x-upsert': 'true',
    },
    body: blob,
  })
  if (!response.ok) return { error: { message: 'Could not upload the signature.' } }
  return { error: null }
}

export { INACTIVE_MESSAGE }
