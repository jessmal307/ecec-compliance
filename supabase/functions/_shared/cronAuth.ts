const CRON_KEY_NAME = 'cron'

function timingSafeEqual(left: string, right: string) {
  const a = new TextEncoder().encode(left)
  const b = new TextEncoder().encode(right)
  let diff = a.length ^ b.length
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0)
  }
  return diff === 0
}

function cronSecretKey(): string | null {
  const raw = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (!raw) return null
  try {
    const keys = JSON.parse(raw)
    const key = keys && typeof keys === 'object' ? keys[CRON_KEY_NAME] : null
    return typeof key === 'string' && key !== '' ? key : null
  } catch {
    return null
  }
}

// Scheduled callers send the "cron" secret key on the apikey header.
export function hasCronSecretKey(req: Request) {
  const expected = cronSecretKey()
  const received = req.headers.get('apikey')
  if (!expected || !received) return false
  return timingSafeEqual(received, expected)
}
