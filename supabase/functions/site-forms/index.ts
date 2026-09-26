import { createClient } from 'npm:@supabase/supabase-js@2'

const TIME_ZONE = 'Australia/Sydney'
const FORM_UPLOADS_BUCKET = 'form-uploads'
const SIGNED_UPLOAD_SECONDS = 600
const TOKEN_WINDOW_MAX = 60
const IP_WINDOW_MAX = 30
const WINDOW_SECONDS = 60
const DEFAULT_OPERATING_DAYS = [1, 2, 3, 4, 5]
const ALREADY_COMPLETED_MESSAGE = 'Already completed for this period'
const COMPLETED_BY_SOMEONE_ELSE_MESSAGE =
  'This was just completed by someone else.'
const SIGNATURE_AGAIN_MESSAGE = 'Draw the sign-off signature again.'
const GENERIC_ERROR_MESSAGE = 'Something went wrong. Try again.'
const SESSION_SECONDS = 15 * 60
const PIN_STAFF_FAIL_MAX = 5
const PIN_STAFF_WINDOW_SECONDS = 15 * 60
const PIN_LINK_FAIL_MAX = 20
const PIN_LINK_WINDOW_SECONDS = 60 * 60
const SESSION_REQUIRED_MESSAGE = 'Sign in with your name and PIN.'
const PIN_FORMAT_MESSAGE = 'Enter your 4-digit PIN.'
const PIN_WRONG_MESSAGE = 'That PIN didn’t work. Try again.'
const PIN_LOCKED_MESSAGE = 'Too many wrong PINs. Try again later.'
const NO_PIN_MESSAGE = 'Ask your director to set your PIN.'
const PICK_AGAIN_MESSAGE = 'Pick your name again.'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-site-token, x-floor-session',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
}

type Supabase = ReturnType<typeof createClient>

type TokenContext = {
  tokenId: string
  orgId: string
  orgName: string
  siteId: string
  siteName: string
  operatingDays: number[]
  siteCreatedAt: string | null
}

type TemplateRow = {
  id: string
  name: string
  archetype: string
  schema: Record<string, unknown>
  cadence: string | null
  scope: string
  created_at: string | null
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function isIsoDate(value: unknown): value is string {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''))
}

function pad2(value: number) {
  return String(value).padStart(2, '0')
}

function formatIso(year: number, month: number, day: number) {
  return `${year}-${pad2(month)}-${pad2(day)}`
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate()
}

function addDaysIso(isoDate: string, days: number) {
  const date = new Date(`${isoDate}T00:00:00`)
  date.setDate(date.getDate() + days)
  return formatIso(date.getFullYear(), date.getMonth() + 1, date.getDate())
}

function isoWeekday(isoDate: string) {
  if (!isIsoDate(isoDate)) return null
  const day = new Date(`${isoDate}T00:00:00`).getDay()
  return day === 0 ? 7 : day
}

function periodBounds(cadence: string, today: string) {
  if (!isIsoDate(today)) return null
  const [year, month] = today.split('-').map(Number)

  if (cadence === 'daily') return { start: today, end: today }
  if (cadence === 'weekly') {
    const weekday = isoWeekday(today)
    if (weekday == null) return null
    const start = addDaysIso(today, 1 - weekday)
    return { start, end: addDaysIso(start, 6) }
  }
  if (cadence === 'monthly') {
    return {
      start: formatIso(year, month, 1),
      end: formatIso(year, month, daysInMonth(year, month)),
    }
  }
  if (cadence === 'quarterly') {
    const startMonth = Math.floor((month - 1) / 3) * 3 + 1
    const endMonth = startMonth + 2
    return {
      start: formatIso(year, startMonth, 1),
      end: formatIso(year, endMonth, daysInMonth(year, endMonth)),
    }
  }
  if (cadence === 'annual') {
    return { start: formatIso(year, 1, 1), end: formatIso(year, 12, 31) }
  }
  if (cadence === 'once') return { start: null, end: null }
  return null
}

function dateInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value
  if (!year || !month || !day) return date.toISOString().slice(0, 10)
  return `${year}-${month}-${day}`
}

function todaySydney() {
  return dateInTimeZone(new Date(), TIME_ZONE)
}

function sameId(left: unknown, right: unknown) {
  return left != null && right != null && String(left) === String(right)
}

function orgHasForms(plan: string | null | undefined) {
  return plan === 'plus' || plan === 'pro'
}

function createdIso(value: string | null | undefined) {
  if (!value) return null
  if (isIsoDate(value)) return value
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return dateInTimeZone(date, TIME_ZONE)
}

function notBeforeIso(siteCreatedAt: string | null, templateCreatedAt: string | null) {
  const dates = [createdIso(siteCreatedAt), createdIso(templateCreatedAt)].filter(
    (value): value is string => Boolean(value),
  )
  return dates.length
    ? dates.reduce((latest, date) => (date > latest ? date : latest))
    : null
}

function isSiteOpenOn(
  operatingDays: number[],
  closures: { closure_date: string }[],
  day: string,
) {
  const weekday = isoWeekday(day)
  const operating = operatingDays.length ? operatingDays : DEFAULT_OPERATING_DAYS
  if (weekday == null || !operating.includes(weekday)) return false
  return !closures.some((row) => row.closure_date === day)
}

function forDateInPeriod(forDate: string | null | undefined, bounds: { start: string | null; end: string | null } | null) {
  const dated = String(forDate ?? '').slice(0, 10)
  if (!isIsoDate(dated)) return false
  if (!bounds || (!bounds.start && !bounds.end)) return true
  if (bounds.start && dated < bounds.start) return false
  if (bounds.end && dated > bounds.end) return false
  return true
}

function periodStatus(
  submissions: { status: string; for_date: string | null }[],
  bounds: { start: string | null; end: string | null } | null,
) {
  if (submissions.some((row) => row.status === 'complete' && forDateInPeriod(row.for_date, bounds))) {
    return 'done'
  }
  if (submissions.some((row) => row.status === 'missed' && forDateInPeriod(row.for_date, bounds))) {
    return 'missed'
  }
  return 'due'
}

function isScheduledTemplate(template: { cadence: string | null; scope: string }) {
  return Boolean(template.cadence) && template.scope === 'all_sites'
}

function isOnDemandTemplate(template: { cadence: string | null; scope: string }) {
  return !template.cadence && template.scope === 'on_demand'
}

function isApplicableTemplate(
  template: { cadence: string | null; scope: string; id: string },
  exclusions: { template_id: string }[],
) {
  if (template.scope === 'all_staff') return false
  if (exclusions.some((row) => sameId(row.template_id, template.id))) return false
  return isScheduledTemplate(template) || isOnDemandTemplate(template)
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function readToken(req: Request) {
  return req.headers.get('x-site-token')?.trim() || ''
}

// Cloudflare sets cf-connecting-ip from the connecting address and overwrites
// any client value. x-forwarded-for's first entry is whatever the client sent.
let warnedNoClientIp = false
function clientIp(req: Request) {
  const ip = req.headers.get('cf-connecting-ip')?.trim()
  if (ip) return ip
  if (!warnedNoClientIp) {
    warnedNoClientIp = true
    console.warn('[site-forms] no trusted client IP (cf-connecting-ip); IP rate limit skipped')
  }
  return null
}

async function hitRate(supabase: Supabase, bucketKey: string, windowSeconds: number) {
  const { data, error } = await supabase.rpc('hit_rate_limit', {
    p_bucket: bucketKey,
    p_window_seconds: windowSeconds,
  })
  if (error) throw error
  return Number(data)
}

async function allowRate(
  supabase: Supabase,
  bucketKey: string,
  maxHits: number,
) {
  return (await hitRate(supabase, bucketKey, WINDOW_SECONDS)) <= maxHits
}

// A lock bucket is hit once when its limit trips, so its window starts then.
async function isLocked(supabase: Supabase, bucketKey: string, windowSeconds: number) {
  const { data, error } = await supabase
    .from('site_access_rate_limits')
    .select('window_start')
    .eq('bucket_key', bucketKey)
    .maybeSingle()
  if (error) throw error
  if (!data?.window_start) return false
  return new Date(data.window_start as string).getTime() > Date.now() - windowSeconds * 1000
}

function toHex(bytes: ArrayBuffer | Uint8Array) {
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function hexToBytes(hex: string) {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

// Must match src/lib/staffPins.js: PBKDF2-SHA256, raw salt bytes, 256 bits, lowercase hex.
async function pinHash(pin: string, saltHex: string, iterations: number) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: hexToBytes(saltHex), iterations },
    key,
    256,
  )
  return toHex(bits)
}

function sameHex(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function randomSessionToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function staffDisplayName(name: unknown) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return 'Staff member'
  if (parts.length === 1) return parts[0]
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`
}

type StaffRow = { id: string; name: string }

// Active, unarchived staff of this org assigned to this site.
async function signableStaff(supabase: Supabase, context: TokenContext, staffId?: string) {
  let links = supabase.from('staff_sites').select('staff_id').eq('site_id', context.siteId)
  if (staffId) links = links.eq('staff_id', staffId)
  const { data: linkRows, error: linkError } = await links
  if (linkError) throw linkError
  const ids = (linkRows ?? []).map((row) => row.staff_id as string)
  if (!ids.length) return [] as StaffRow[]

  const { data, error } = await supabase
    .from('staff')
    .select('id, name')
    .in('id', ids)
    .eq('org_id', context.orgId)
    .eq('employment_status', 'active')
    .is('archived_at', null)
  if (error) throw error
  return (data ?? []) as StaffRow[]
}

async function loadPin(supabase: Supabase, staffId: string) {
  const { data, error } = await supabase
    .from('staff_pins')
    .select('salt, pin_hash, iterations')
    .eq('staff_id', staffId)
    .maybeSingle()
  if (error) throw error
  return data as { salt: string; pin_hash: string; iterations: number } | null
}

type FloorSession = { id: string; staffId: string }

// Re-checked on every save: expired, other link/site, turnover, or no PIN all fail.
async function loadSession(supabase: Supabase, context: TokenContext, rawSession: string) {
  if (!rawSession) return null
  const { data, error } = await supabase
    .from('floor_sessions')
    .select('id, staff_id, site_id, site_access_token_id, expires_at')
    .eq('token_hash', await sha256Hex(rawSession))
    .maybeSingle()
  if (error) throw error
  if (
    !data ||
    !sameId(data.site_access_token_id, context.tokenId) ||
    !sameId(data.site_id, context.siteId) ||
    new Date(data.expires_at as string).getTime() <= Date.now()
  ) {
    return null
  }
  const staffId = data.staff_id as string
  const [staff] = await signableStaff(supabase, context, staffId)
  if (!staff || !(await loadPin(supabase, staffId))) return null
  return { id: data.id as string, staffId } satisfies FloorSession
}

async function handleStaffList(supabase: Supabase, context: TokenContext) {
  const staff = (await signableStaff(supabase, context))
    .map((row) => ({ id: row.id, name: staffDisplayName(row.name) }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return json({ staff })
}

async function handleVerifyPin(supabase: Supabase, context: TokenContext, body: Record<string, unknown>) {
  const staffId = String(body.staff_id || '').trim()
  const pin = String(body.pin ?? '')
  if (!staffId || !/^\d{4}$/.test(pin)) return json({ error: PIN_FORMAT_MESSAGE }, 400)

  const linkFailKey = `pin-fail:link:${context.tokenId}`
  const linkLockKey = `pin-lock:link:${context.tokenId}`
  const staffFailKey = `pin-fail:staff:${staffId}`
  const staffLockKey = `pin-lock:staff:${staffId}`

  if (
    (await isLocked(supabase, linkLockKey, PIN_LINK_WINDOW_SECONDS)) ||
    (await isLocked(supabase, staffLockKey, PIN_STAFF_WINDOW_SECONDS))
  ) {
    return json({ error: PIN_LOCKED_MESSAGE }, 423)
  }

  const [staff] = await signableStaff(supabase, context, staffId)
  if (!staff) {
    if ((await hitRate(supabase, linkFailKey, PIN_LINK_WINDOW_SECONDS)) > PIN_LINK_FAIL_MAX) {
      await hitRate(supabase, linkLockKey, PIN_LINK_WINDOW_SECONDS)
    }
    return json({ error: PICK_AGAIN_MESSAGE, pick_again: true }, 403)
  }

  const stored = await loadPin(supabase, staffId)
  if (!stored) return json({ error: NO_PIN_MESSAGE, no_pin: true }, 400)

  const hash = await pinHash(pin, stored.salt, stored.iterations)
  if (!sameHex(hash, stored.pin_hash)) {
    const staffFails = await hitRate(supabase, staffFailKey, PIN_STAFF_WINDOW_SECONDS)
    const linkFails = await hitRate(supabase, linkFailKey, PIN_LINK_WINDOW_SECONDS)
    let locked = false
    if (staffFails >= PIN_STAFF_FAIL_MAX) {
      await hitRate(supabase, staffLockKey, PIN_STAFF_WINDOW_SECONDS)
      locked = true
    }
    if (linkFails > PIN_LINK_FAIL_MAX) {
      await hitRate(supabase, linkLockKey, PIN_LINK_WINDOW_SECONDS)
      locked = true
    }
    return locked
      ? json({ error: PIN_LOCKED_MESSAGE }, 423)
      : json({ error: PIN_WRONG_MESSAGE }, 400)
  }

  const { error: resetError } = await supabase
    .from('site_access_rate_limits')
    .delete()
    .eq('bucket_key', staffFailKey)
  if (resetError) throw resetError

  const session = randomSessionToken()
  const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000).toISOString()
  const { error: insertError } = await supabase.from('floor_sessions').insert({
    org_id: context.orgId,
    site_id: context.siteId,
    site_access_token_id: context.tokenId,
    staff_id: staffId,
    token_hash: await sha256Hex(session),
    expires_at: expiresAt,
  })
  if (insertError) throw insertError

  return json({
    session,
    expires_at: expiresAt,
    staff: { id: staffId, name: staffDisplayName(staff.name) },
  })
}

function fieldFilled(field: { type?: string }, value: unknown) {
  if (field.type === 'checkbox') return Boolean(value)
  if (field.type === 'signature') {
    return typeof value === 'string' && value.trim() !== '' && !value.startsWith('data:image/')
  }
  return String(value ?? '').trim() !== ''
}

function validateSubmission(
  schema: Record<string, unknown> | null | undefined,
  archetype: string,
  data: Record<string, unknown>,
) {
  const errors: string[] = []
  const values =
    (data.fields && typeof data.fields === 'object' ? data.fields : null) ||
    (data.values && typeof data.values === 'object' ? data.values : {})
  const signoff =
    data.signoff && typeof data.signoff === 'object'
      ? (data.signoff as Record<string, unknown>)
      : {}
  const source = archetype === 'checklist' ? schema?.items : schema?.fields ?? schema?.items
  const fields = Array.isArray(source)
    ? archetype === 'checklist'
      ? source.map((item) => ({ ...(item as object), type: 'checkbox' }))
      : source
    : []

  for (const field of fields as { id?: string; label?: string; type?: string; required?: boolean }[]) {
    if (!field.required) continue
    if (!fieldFilled(field, (values as Record<string, unknown>)[field.id || ''])) {
      errors.push(`Fill ${field.label || 'required fields'}.`)
    }
  }

  const signoffSchema = schema?.signoff as { required?: boolean; signature?: boolean } | undefined
  if (signoffSchema?.required) {
    if (!String(signoff.name || '').trim()) errors.push('Enter the sign-off name.')
    if (!signoff.date) errors.push('Enter the sign-off date.')
    if (signoffSchema.signature !== false && !fieldFilled({ type: 'signature' }, signoff.signature)) {
      errors.push('Draw the sign-off signature.')
    }
  }

  return [...new Set(errors)]
}

function buildSubmissionData(input: Record<string, unknown> | null | undefined) {
  const data = input && typeof input === 'object' ? input : {}
  const fields =
    (data.fields && typeof data.fields === 'object' ? data.fields : null) ||
    (data.values && typeof data.values === 'object' ? data.values : {})
  const rows = Array.isArray(data.hazards)
    ? data.hazards
    : Array.isArray(data.rows)
      ? data.rows
      : []
  const signoff =
    data.signoff && typeof data.signoff === 'object'
      ? (data.signoff as Record<string, unknown>)
      : {}
  const signature = String(signoff.signature || '').trim()
  if (signature.startsWith('data:image/')) {
    return { error: 'Upload the signature with the signed URL.', data: null }
  }
  return {
    error: null,
    data: {
      room: String(data.room || '').trim(),
      values: fields,
      fields,
      notes: data.notes && typeof data.notes === 'object' ? data.notes : {},
      signoff: {
        name: String(signoff.name || '').trim(),
        date: String(signoff.date || '').trim(),
        note: String(signoff.note || '').trim(),
        signature,
      },
      rows,
      hazards: rows,
    },
  }
}

function signaturePath(orgId: string, siteId: string, submissionId: string) {
  return `${orgId}/${siteId}/${submissionId}/signature.png`
}

const FIELD_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

// Same field source as validateSubmission; ids outside FIELD_ID_PATTERN never become paths.
function signatureFields(schema: Record<string, unknown> | null | undefined, archetype: string) {
  if (archetype === 'checklist') return []
  const source = schema?.fields ?? schema?.items
  if (!Array.isArray(source)) return []
  return (source as { id?: unknown; label?: unknown; type?: unknown }[])
    .filter((field) => field?.type === 'signature' && FIELD_ID_PATTERN.test(String(field.id ?? '')))
    .map((field) => ({ id: String(field.id), label: String(field.label || 'the signature') }))
}

function fieldSignaturePath(orgId: string, siteId: string, submissionId: string, fieldId: string) {
  return `${orgId}/${siteId}/${submissionId}/fields/${fieldId}.png`
}

function fieldAgainMessage(label: string) {
  return `Draw ${label} again.`
}

async function resolveToken(supabase: Supabase, rawToken: string) {
  const tokenHash = await sha256Hex(rawToken)
  const { data, error } = await supabase
    .from('site_access_tokens')
    .select(
      'id, org_id, site_id, organizations ( name, plan ), sites ( name, operating_days, archived_at, created_at )',
    )
    .eq('token_hash', tokenHash)
    .eq('status', 'active')
    .maybeSingle()

  if (error) throw error
  if (!data) return { context: null as TokenContext | null, error: json({ error: 'Invalid token.' }, 401) }

  const org = data.organizations as { name?: string; plan?: string | null } | null
  const site = data.sites as {
    name?: string
    operating_days?: number[] | null
    archived_at?: string | null
    created_at?: string | null
  } | null

  if (!orgHasForms(org?.plan) || site?.archived_at) {
    return { context: null, error: json({ error: 'Invalid token.' }, 401) }
  }

  const { error: usedError } = await supabase
    .from('site_access_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id)
    .eq('status', 'active')
  if (usedError) throw usedError

  return {
    context: {
      tokenId: data.id as string,
      orgId: data.org_id as string,
      orgName: org?.name || 'Organisation',
      siteId: data.site_id as string,
      siteName: site?.name || 'Site',
      operatingDays:
        Array.isArray(site?.operating_days) && site.operating_days.length
          ? site.operating_days.map(Number)
          : DEFAULT_OPERATING_DAYS,
      siteCreatedAt: site?.created_at ?? null,
    } satisfies TokenContext,
    error: null,
  }
}

async function loadApplicableTemplates(supabase: Supabase, orgId: string, siteId: string) {
  const [templatesResult, exclusionsResult] = await Promise.all([
    supabase
      .from('form_templates')
      .select('id, name, archetype, schema, cadence, scope, archived_at, created_at')
      .is('archived_at', null)
      .or(`org_id.eq.${orgId},org_id.is.null`),
    supabase
      .from('form_site_exclusions')
      .select('template_id')
      .eq('org_id', orgId)
      .eq('site_id', siteId),
  ])
  if (templatesResult.error) throw templatesResult.error
  if (exclusionsResult.error) throw exclusionsResult.error

  const exclusions = exclusionsResult.data ?? []
  const templates = (templatesResult.data ?? [])
    .filter((row) => isApplicableTemplate(row, exclusions))
    .map((row) => ({
      id: row.id as string,
      name: row.name as string,
      archetype: row.archetype as string,
      schema: (row.schema && typeof row.schema === 'object' ? row.schema : {}) as Record<string, unknown>,
      cadence: (row.cadence as string | null) ?? null,
      scope: (row.scope as string) || 'on_demand',
      created_at: (row.created_at as string | null) ?? null,
    }))

  return templates
}

async function handleGet(supabase: Supabase, context: TokenContext) {
  const today = todaySydney()
  const templates = await loadApplicableTemplates(supabase, context.orgId, context.siteId)
  const scheduled = templates.filter(isScheduledTemplate)

  const [closuresResult, submissionsResult] = await Promise.all([
    supabase
      .from('site_closures')
      .select('closure_date')
      .eq('site_id', context.siteId)
      .eq('closure_date', today),
    scheduled.length
      ? supabase
          .from('form_submissions')
          .select('template_id, status, for_date')
          .eq('org_id', context.orgId)
          .eq('site_id', context.siteId)
          .in('status', ['complete', 'missed'])
          .in(
            'template_id',
            scheduled.map((template) => template.id),
          )
      : Promise.resolve({ data: [], error: null }),
  ])
  if (closuresResult.error) throw closuresResult.error
  if (submissionsResult.error) throw submissionsResult.error

  const closures = (closuresResult.data ?? []).map((row) => ({
    closure_date: String(row.closure_date).slice(0, 10),
  }))
  const submissions = (submissionsResult.data ?? []).map((row) => ({
    template_id: row.template_id as string,
    status: row.status as string,
    for_date: row.for_date ? String(row.for_date).slice(0, 10) : null,
  }))

  const forms = []
  for (const template of templates) {
    if (isOnDemandTemplate(template)) {
      forms.push({
        template_id: template.id,
        name: template.name,
        archetype: template.archetype,
        cadence: null,
        schema: template.schema,
        status: 'available',
        for_date: null,
      })
      continue
    }

    if (template.cadence === 'daily' && !isSiteOpenOn(context.operatingDays, closures, today)) {
      continue
    }

    const bounds = periodBounds(template.cadence || 'once', today)
    const notBefore = notBeforeIso(context.siteCreatedAt, template.created_at)
    if (bounds?.start && notBefore && bounds.start < notBefore) continue

    const status = periodStatus(
      submissions.filter((row) => sameId(row.template_id, template.id)),
      bounds,
    )
    forms.push({
      template_id: template.id,
      name: template.name,
      archetype: template.archetype,
      cadence: template.cadence,
      schema: template.schema,
      status,
      for_date: today,
    })
  }

  return json({
    org_name: context.orgName,
    site_name: context.siteName,
    today,
    forms,
  })
}

// Only call for a row just confirmed as a draft. The old file is removed so a
// no-upsert URL can create the new one; once the submission is complete its
// signature files exist, so no outstanding URL can overwrite them.
async function signedUpload(supabase: Supabase, path: string) {
  const { error: removeError } = await supabase.storage.from(FORM_UPLOADS_BUCKET).remove([path])
  if (removeError) throw removeError
  const { data, error } = await supabase.storage
    .from(FORM_UPLOADS_BUCKET)
    .createSignedUploadUrl(path, { upsert: false })
  if (error) throw error
  return {
    path,
    signedUrl: data.signedUrl,
    token: data.token,
    expires_in: SIGNED_UPLOAD_SECONDS,
  }
}

async function objectExists(supabase: Supabase, path: string) {
  const slash = path.lastIndexOf('/')
  const folder = path.slice(0, slash)
  const name = path.slice(slash + 1)
  const { data, error } = await supabase.storage
    .from(FORM_UPLOADS_BUCKET)
    .list(folder, { search: name, limit: 10 })
  if (error) throw error
  return (data ?? []).some((entry) => entry.name === name)
}

async function findCompleteForDate(
  supabase: Supabase,
  orgId: string,
  siteId: string,
  templateId: string,
  forDate: string | null,
  excludeId?: string,
) {
  if (!forDate) return null
  let query = supabase
    .from('form_submissions')
    .select('id')
    .eq('org_id', orgId)
    .eq('site_id', siteId)
    .eq('template_id', templateId)
    .eq('status', 'complete')
    .eq('for_date', forDate)
    .limit(1)
  if (excludeId) query = query.neq('id', excludeId)
  const { data, error } = await query.maybeSingle()
  if (error) throw error
  return data
}

async function handlePost(
  supabase: Supabase,
  context: TokenContext,
  body: Record<string, unknown>,
  session: FloorSession,
) {
  const today = todaySydney()
  const templateId = String(body.template_id || '').trim()
  const status = String(body.status || 'draft')
  const submissionId = String(body.submission_id || '').trim()
  if (!templateId) return json({ error: 'Choose a form.' }, 400)
  if (status !== 'draft' && status !== 'complete') {
    return json({ error: 'Invalid status.' }, 400)
  }

  const templates = await loadApplicableTemplates(supabase, context.orgId, context.siteId)
  const template = templates.find((row) => sameId(row.id, templateId))
  if (!template) return json({ error: 'This form is not available for this site.' }, 403)

  if (isScheduledTemplate(template)) {
    if (template.cadence === 'daily') {
      const { data: closures, error: closuresError } = await supabase
        .from('site_closures')
        .select('closure_date')
        .eq('site_id', context.siteId)
        .eq('closure_date', today)
      if (closuresError) throw closuresError
      const closed = (closures ?? []).map((row) => ({
        closure_date: String(row.closure_date).slice(0, 10),
      }))
      if (!isSiteOpenOn(context.operatingDays, closed, today)) {
        return json({ error: 'This form is not available for this site.' }, 403)
      }
    }
    const notBefore = notBeforeIso(context.siteCreatedAt, template.created_at)
    const bounds = periodBounds(template.cadence || 'once', today)
    if (bounds?.start && notBefore && bounds.start < notBefore) {
      return json({ error: 'This form is not available for this site.' }, 403)
    }
  }

  const built = buildSubmissionData(
    body.data && typeof body.data === 'object' ? (body.data as Record<string, unknown>) : {},
  )
  if (built.error || !built.data) return json({ error: built.error }, 400)

  let forDate: string | null = null
  if (isScheduledTemplate(template)) {
    const requested = String(body.for_date || today).slice(0, 10)
    const bounds = periodBounds(template.cadence || 'once', today)
    if (!isIsoDate(requested) || !forDateInPeriod(requested, bounds)) {
      return json({ error: 'This form can only be completed for the current period.' }, 400)
    }
    forDate = requested
  }

  const signature = built.data.signoff.signature
  if (signature && !submissionId) {
    return json({ error: SIGNATURE_AGAIN_MESSAGE, redraw: true }, 400)
  }
  const fieldValues = built.data.values as Record<string, unknown>
  const fieldSignatures = signatureFields(template.schema, template.archetype).map((field) => ({
    ...field,
    value: String(fieldValues[field.id] ?? '').trim(),
  }))
  if (!submissionId) {
    const filled = fieldSignatures.find((field) => field.value)
    if (filled) return json({ error: fieldAgainMessage(filled.label), redraw: true }, 400)
  }

  let rowId = submissionId
  if (rowId) {
    const { data: existing, error: existingError } = await supabase
      .from('form_submissions')
      .select('id, org_id, site_id, template_id, status')
      .eq('id', rowId)
      .maybeSingle()
    if (existingError) throw existingError
    if (
      !existing ||
      !sameId(existing.org_id, context.orgId) ||
      !sameId(existing.site_id, context.siteId) ||
      !sameId(existing.template_id, template.id)
    ) {
      return json({ error: 'This form is not available for this site.' }, 403)
    }
    if (existing.status === 'complete' || existing.status === 'missed') {
      return json({ error: 'This submission is locked.' }, 409)
    }
    if (signature && signature !== signaturePath(context.orgId, context.siteId, rowId)) {
      return json({ error: SIGNATURE_AGAIN_MESSAGE, redraw: true, submission_id: rowId }, 400)
    }
    const wrongField = fieldSignatures.find(
      (field) =>
        field.value &&
        field.value !== fieldSignaturePath(context.orgId, context.siteId, rowId as string, field.id),
    )
    if (wrongField) {
      return json(
        { error: fieldAgainMessage(wrongField.label), redraw: true, submission_id: rowId },
        400,
      )
    }
  } else {
    const { data: created, error: createError } = await supabase
      .from('form_submissions')
      .insert({
        org_id: context.orgId,
        template_id: template.id,
        site_id: context.siteId,
        submitted_by: null,
        for_date: forDate,
        data: built.data,
        status: 'draft',
        evidence: [],
      })
      .select('id')
      .single()
    if (createError) throw createError
    rowId = created.id as string
  }

  if (status === 'complete') {
    const issues = validateSubmission(template.schema, template.archetype, built.data)
    if (issues.length) return json({ error: issues[0], submission_id: rowId }, 400)

    if (signature && !(await objectExists(supabase, signature))) {
      return json({ error: SIGNATURE_AGAIN_MESSAGE, redraw: true, submission_id: rowId }, 400)
    }
    for (const field of fieldSignatures) {
      if (field.value && !(await objectExists(supabase, field.value))) {
        return json(
          { error: fieldAgainMessage(field.label), redraw: true, submission_id: rowId },
          400,
        )
      }
    }

    if (forDate) {
      const existingComplete = await findCompleteForDate(
        supabase,
        context.orgId,
        context.siteId,
        template.id,
        forDate,
        rowId,
      )
      if (existingComplete) {
        return json({ error: ALREADY_COMPLETED_MESSAGE, submission_id: rowId }, 409)
      }
    }

    const now = new Date().toISOString()
    const { data: completed, error: completeError } = await supabase
      .from('form_submissions')
      .update({
        site_id: context.siteId,
        for_date: forDate,
        data: built.data,
        evidence: [],
        status: 'complete',
        submitted_by: null,
        signed_off_by: null,
        signed_by_staff_id: session.staffId,
        signed_off_at: now,
        submitted_at: now,
      })
      .eq('id', rowId)
      .eq('status', 'draft')
      .select('id')
      .maybeSingle()

    if (completeError?.code === '23505') {
      return json({ error: COMPLETED_BY_SOMEONE_ELSE_MESSAGE, submission_id: rowId }, 409)
    }
    if (completeError) throw completeError
    if (!completed) {
      return json({ error: 'This submission is locked.' }, 409)
    }

    const { error: endError } = await supabase
      .from('floor_sessions')
      .delete()
      .eq('id', session.id)
    if (endError) console.error('[site-forms] could not end floor session', endError)

    return json({ submission_id: rowId, status: 'complete', upload: null })
  }

  const { data: savedDraft, error: draftError } = await supabase
    .from('form_submissions')
    .update({
      site_id: context.siteId,
      for_date: forDate,
      data: built.data,
      evidence: [],
      status: 'draft',
      submitted_by: null,
      signed_off_by: null,
      signed_off_at: null,
      submitted_at: null,
    })
    .eq('id', rowId)
    .eq('status', 'draft')
    .select('id')
    .maybeSingle()
  if (draftError) throw draftError
  if (!savedDraft) return json({ error: 'This submission is locked.' }, 409)

  const upload = signature
    ? null
    : await signedUpload(supabase, signaturePath(context.orgId, context.siteId, rowId))
  const fieldUploads: Record<string, Awaited<ReturnType<typeof signedUpload>>> = {}
  for (const field of fieldSignatures) {
    if (field.value) continue
    fieldUploads[field.id] = await signedUpload(
      supabase,
      fieldSignaturePath(context.orgId, context.siteId, rowId, field.id),
    )
  }
  return json({ submission_id: rowId, status: 'draft', upload, field_uploads: fieldUploads })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: 'Server is not configured.' }, 500)
    }

    if (req.method !== 'GET' && req.method !== 'POST') {
      return json({ error: 'Method not allowed.' }, 405)
    }

    const rawToken = readToken(req)
    if (!rawToken) return json({ error: 'Invalid token.' }, 401)

    const supabase = createClient(supabaseUrl, serviceRoleKey)
    const ip = clientIp(req)
    if (ip && !(await allowRate(supabase, `ip:${await sha256Hex(ip)}`, IP_WINDOW_MAX))) {
      return json({ error: 'Too many requests.' }, 429)
    }

    const resolved = await resolveToken(supabase, rawToken)
    if (resolved.error || !resolved.context) return resolved.error

    const tokenKey = `token:${resolved.context.tokenId}`
    if (!(await allowRate(supabase, tokenKey, TOKEN_WINDOW_MAX))) {
      return json({ error: 'Too many requests.' }, 429)
    }

    if (req.method === 'GET') return await handleGet(supabase, resolved.context)

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body !== 'object') return json({ error: 'Invalid request.' }, 400)
    if (body.action === 'staff') return await handleStaffList(supabase, resolved.context)
    if (body.action === 'verify_pin') {
      return await handleVerifyPin(supabase, resolved.context, body)
    }

    const session = await loadSession(
      supabase,
      resolved.context,
      req.headers.get('x-floor-session')?.trim() || '',
    )
    if (!session) return json({ error: SESSION_REQUIRED_MESSAGE, session: 'required' }, 403)
    return await handlePost(supabase, resolved.context, body, session)
  } catch (error) {
    console.error('[site-forms] request failed', error)
    return json({ error: GENERIC_ERROR_MESSAGE }, 500)
  }
})
