function timingSafeEqual(left: string, right: string) {
  const a = new TextEncoder().encode(left)
  const b = new TextEncoder().encode(right)
  let diff = a.length ^ b.length
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0)
  }
  return diff === 0
}

export function hasServiceRoleAuth(req: Request, serviceRoleKey: string) {
  const header = req.headers.get('authorization') ?? ''
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return Boolean(match && timingSafeEqual(match[1].trim(), serviceRoleKey))
}

// TEMP-DIAG start: remove once the 401 is explained. Never logs key values.
function base64UrlJson(part: string) {
  try {
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    return JSON.parse(atob(padded))
  } catch {
    return null
  }
}

function jwtClaims(value: string) {
  const parts = value.split('.')
  if (parts.length !== 3) return null
  const header = base64UrlJson(parts[0])
  const payload = base64UrlJson(parts[1])
  if (!header || !payload) return null
  return { alg: header.alg ?? null, role: payload.role ?? null, ref: payload.ref ?? null, iat: payload.iat ?? null }
}

async function fingerprint8(value: string) {
  if (!value) return null
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)]
    .slice(0, 4)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function secretKeyNames() {
  const raw = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (raw == null) return null
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? Object.keys(parsed) : 'not-an-object'
  } catch {
    return 'unparseable'
  }
}

export async function logAuthMismatch(req: Request, serviceRoleKey: string) {
  try {
    await writeAuthDiag(req, serviceRoleKey)
  } catch (error) {
    console.log('[auth-diag] failed', error instanceof Error ? error.message : String(error))
  }
}

async function writeAuthDiag(req: Request, serviceRoleKey: string) {
  const header = req.headers.get('authorization')
  const scheme = header ? header.trim().split(/\s+/)[0] : null
  const token = header ? header.trim().replace(/^\S+\s*/, '') : ''
  const env = serviceRoleKey ?? ''
  console.log(
    '[auth-diag]',
    JSON.stringify({
      function: new URL(req.url).pathname.split('/').filter(Boolean).pop() ?? null,
      header_present: header != null,
      starts_with_bearer: header?.startsWith('Bearer ') ?? false,
      scheme,
      token_length: token.length,
      token_prefix4: token.slice(0, 4),
      token_trim_changes: token !== token.trim(),
      env_set: Boolean(env),
      env_length: env.length,
      env_prefix4: env.slice(0, 4),
      env_trim_changes: env !== env.trim(),
      match_after_trim: Boolean(token) && token.trim() === env.trim(),
      token_claims: jwtClaims(token.trim()),
      env_claims: jwtClaims(env.trim()),
      token_fp8: await fingerprint8(token.trim()),
      env_fp8: await fingerprint8(env.trim()),
      has_SUPABASE_SECRET_KEYS: Deno.env.get('SUPABASE_SECRET_KEYS') != null,
      secret_key_names: secretKeyNames(),
      has_SUPABASE_JWKS: Deno.env.get('SUPABASE_JWKS') != null,
    }),
  )
}

// TEMP-DIAG end
