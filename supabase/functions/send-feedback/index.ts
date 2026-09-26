import { createClient } from 'npm:@supabase/supabase-js@2'

const FEEDBACK_TYPES = ['bug', 'improvement', 'feature_request', 'other', 'feature-interest'] as const

type FeedbackType = (typeof FEEDBACK_TYPES)[number]

const TYPE_LABELS: Record<FeedbackType, string> = {
  bug: 'Bug',
  improvement: 'Improvement',
  feature_request: 'Feature request',
  other: 'Other',
  'feature-interest': 'Feature interest',
}

const FEEDBACK_MAX_PER_WINDOW = 5
const FEEDBACK_WINDOW_SECONDS = 3600
const UNAVAILABLE_MESSAGE = 'Feedback is not available right now.'
const FAILED_MESSAGE = 'Could not send feedback. Try again.'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function isFeedbackType(value: unknown): value is FeedbackType {
  return typeof value === 'string' && FEEDBACK_TYPES.includes(value as FeedbackType)
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function row(label: string, value: string) {
  return `<p style="margin:0 0 8px;"><strong>${escapeHtml(label)}:</strong> ${value}</p>`
}

async function sendResendEmail({
  apiKey,
  from,
  to,
  subject,
  html,
}: {
  apiKey: string
  from: string
  to: string
  subject: string
  html: string
}) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to, subject, html }),
  })

  const payload = await response.json()
  if (!response.ok) {
    return {
      error: new Error(payload?.message ?? `Resend request failed (${response.status})`),
    }
  }

  return { error: null }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const resendApiKey = Deno.env.get('RESEND_API_KEY')
  const fromEmail = Deno.env.get('RESEND_FROM_EMAIL')
  const toEmail = Deno.env.get('FEEDBACK_TO_EMAIL')?.trim()

  if (!supabaseUrl || !anonKey || !serviceRoleKey || !resendApiKey || !fromEmail || !toEmail) {
    const missing = Object.entries({
      SUPABASE_URL: supabaseUrl,
      SUPABASE_ANON_KEY: anonKey,
      SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
      RESEND_API_KEY: resendApiKey,
      RESEND_FROM_EMAIL: fromEmail,
      FEEDBACK_TO_EMAIL: toEmail,
    })
      .filter(([, value]) => !value)
      .map(([name]) => name)
    console.error('[send-feedback] missing configuration:', missing.join(', '))
    return json({ error: UNAVAILABLE_MESSAGE }, 500)
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return json({ error: 'Unauthorized' }, 401)
  }

  let body: {
    org_id?: unknown
    type?: unknown
    message?: unknown
    page?: unknown
  }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  const orgId = typeof body.org_id === 'string' ? body.org_id : ''
  const type = body.type
  const message = typeof body.message === 'string' ? body.message.trim() : ''
  const page = typeof body.page === 'string' ? body.page.trim() : ''

  if (!orgId) {
    return json({ error: 'Organization is required.' }, 400)
  }

  if (!isFeedbackType(type)) {
    return json({ error: 'Choose a feedback type.' }, 400)
  }

  if (!message) {
    return json({ error: 'Message is required.' }, 400)
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    if (userError) console.error('[send-feedback] auth failed', userError)
    return json({ error: 'Unauthorized' }, 401)
  }

  const { data: membership, error: membershipError } = await supabase
    .from('org_members')
    .select('org_id')
    .eq('org_id', orgId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (membershipError) {
    console.error('[send-feedback] membership lookup failed', membershipError)
    return json({ error: FAILED_MESSAGE }, 500)
  }

  if (!membership) {
    return json({ error: 'Not a member of this organization.' }, 403)
  }

  const admin = createClient(supabaseUrl, serviceRoleKey)
  const { data: hits, error: rateError } = await admin.rpc('hit_rate_limit', {
    p_bucket: `feedback:user:${user.id}`,
    p_window_seconds: FEEDBACK_WINDOW_SECONDS,
  })
  if (rateError) {
    console.error('[send-feedback] rate limit failed', rateError)
    return json({ error: FAILED_MESSAGE }, 500)
  }
  if (Number(hits) > FEEDBACK_MAX_PER_WINDOW) {
    return json({ error: "You've sent a lot of feedback — try again later." }, 429)
  }

  const { data: organization, error: orgError } = await supabase
    .from('organizations')
    .select('id, name')
    .eq('id', orgId)
    .maybeSingle()

  if (orgError) {
    console.error('[send-feedback] organization lookup failed', orgError)
    return json({ error: FAILED_MESSAGE }, 500)
  }

  const { error: insertError } = await supabase.from('feedback').insert({
    org_id: orgId,
    user_id: user.id,
    type,
    message,
    page,
  })

  if (insertError) {
    console.error('[send-feedback] insert failed', insertError)
    return json({ error: FAILED_MESSAGE }, 500)
  }

  const displayName =
    typeof user.user_metadata?.display_name === 'string'
      ? user.user_metadata.display_name.trim()
      : ''
  const submittedBy = displayName
    ? `${displayName} <${user.email ?? user.id}>`
    : (user.email ?? user.id)
  const typeLabel = TYPE_LABELS[type]
  const orgName = organization?.name ?? orgId

  const { error: sendError } = await sendResendEmail({
    apiKey: resendApiKey,
    from: fromEmail,
    to: toEmail,
    subject: `ECEC feedback: ${typeLabel}`,
    html: `
      <h1 style="font-size:18px;margin:0 0 16px;">New in-app feedback</h1>
      ${row('Type', escapeHtml(typeLabel))}
      ${row('Page', escapeHtml(page || '—'))}
      ${row('Submitted by', escapeHtml(submittedBy))}
      ${row('User id', escapeHtml(user.id))}
      ${row('Organization', escapeHtml(`${orgName} (${orgId})`))}
      <p style="margin:16px 0 8px;"><strong>Message</strong></p>
      <pre style="white-space:pre-wrap;font-family:inherit;margin:0;">${escapeHtml(message)}</pre>
    `,
  })

  if (sendError) {
    console.error('[send-feedback] email failed', sendError)
    return json({ error: FAILED_MESSAGE }, 500)
  }

  return json({ ok: true })
})
