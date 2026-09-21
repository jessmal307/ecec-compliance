import { createClient } from 'npm:@supabase/supabase-js@2'

const FEEDBACK_TYPES = ['bug', 'improvement', 'feature_request', 'other'] as const

type FeedbackType = (typeof FEEDBACK_TYPES)[number]

const TYPE_LABELS: Record<FeedbackType, string> = {
  bug: 'Bug',
  improvement: 'Improvement',
  feature_request: 'Feature request',
  other: 'Other',
}

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
  const resendApiKey = Deno.env.get('RESEND_API_KEY')
  const fromEmail =
    Deno.env.get('RESEND_FROM_EMAIL') ?? 'ECEC Alerts <onboarding@resend.dev>'
  const toEmail = Deno.env.get('FEEDBACK_TO_EMAIL')?.trim()

  if (!supabaseUrl || !anonKey) {
    return json({ error: 'Missing SUPABASE_URL or SUPABASE_ANON_KEY' }, 500)
  }

  if (!resendApiKey) {
    return json({ error: 'Missing RESEND_API_KEY' }, 500)
  }

  if (!toEmail) {
    return json({ error: 'Missing FEEDBACK_TO_EMAIL' }, 500)
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
    return json({ error: userError?.message ?? 'Unauthorized' }, 401)
  }

  const { data: membership, error: membershipError } = await supabase
    .from('org_members')
    .select('org_id')
    .eq('org_id', orgId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (membershipError) {
    return json({ error: membershipError.message }, 500)
  }

  if (!membership) {
    return json({ error: 'Not a member of this organization.' }, 403)
  }

  const { data: organization, error: orgError } = await supabase
    .from('organizations')
    .select('id, name')
    .eq('id', orgId)
    .maybeSingle()

  if (orgError) {
    return json({ error: orgError.message }, 500)
  }

  const { error: insertError } = await supabase.from('feedback').insert({
    org_id: orgId,
    user_id: user.id,
    type,
    message,
    page,
  })

  if (insertError) {
    return json({ error: insertError.message }, 500)
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
    return json({ error: sendError.message }, 500)
  }

  return json({ ok: true })
})
