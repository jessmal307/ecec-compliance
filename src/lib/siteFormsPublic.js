import { createClient } from '@supabase/supabase-js'
import { sydneyToday } from './sydneyTime'

const FORM_UPLOADS_BUCKET = 'form-uploads'

export const SIGNATURE_AGAIN_MESSAGE = 'Draw the sign-off signature again.'

const INACTIVE_MESSAGE =
  'This link is no longer active — please contact your service.'

function siteFormsUrl() {
  const base = import.meta.env.VITE_SUPABASE_URL
  return base ? `${base.replace(/\/$/, '')}/functions/v1/site-forms` : ''
}

export function todayIsoDate() {
  return sydneyToday()
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

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
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

const UPLOAD_FAILED_MESSAGE = 'Could not upload the signature. Try again.'

let anonClient = null

// Anon-only client: never reads or refreshes a signed-in session in this browser.
function floorLinkClient() {
  const url = import.meta.env.VITE_SUPABASE_URL
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!url || !anonKey) return null
  if (!anonClient) {
    anonClient = createClient(url, anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storageKey: 'rtc-floor-link',
      },
    })
  }
  return anonClient
}

export async function uploadSignature(upload, blob) {
  const client = floorLinkClient()
  if (!client || !upload?.path || !upload?.token) {
    return { error: { message: UPLOAD_FAILED_MESSAGE } }
  }
  try {
    const { error } = await client.storage
      .from(FORM_UPLOADS_BUCKET)
      .uploadToSignedUrl(upload.path, upload.token, blob, {
        contentType: blob.type || 'image/png',
        upsert: false,
      })
    if (error) return { error: { message: UPLOAD_FAILED_MESSAGE } }
    return { error: null }
  } catch {
    return { error: { message: UPLOAD_FAILED_MESSAGE } }
  }
}

export { INACTIVE_MESSAGE }
