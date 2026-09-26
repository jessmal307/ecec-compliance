import { supabase } from './supabase'

// site-forms re-derives the hash to check a PIN: PBKDF2-SHA256 over the
// UTF-8 digits, salt = the 16 raw bytes behind `salt`, 256-bit output,
// lowercase hex. Change both sides together.
export const PIN_ITERATIONS = 100000
const SALT_BYTES = 16
const HASH_BITS = 256

const WEAK_SEQUENCES = new Set([
  '0123', '1234', '2345', '3456', '4567', '5678', '6789',
  '3210', '4321', '5432', '6543', '7654', '8765', '9876',
])

export function pinProblem(pin) {
  const value = String(pin ?? '')
  if (!/^\d{4}$/.test(value)) return 'Enter exactly 4 digits.'
  if (/^(\d)\1{3}$/.test(value)) {
    return 'That PIN is too easy to guess. Don’t use the same digit four times.'
  }
  if (WEAK_SEQUENCES.has(value)) {
    return 'That PIN is too easy to guess. Don’t use a run like 1234 or 4321.'
  }
  return ''
}

function toHex(bytes) {
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function hashPin(pin) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PIN_ITERATIONS },
    key,
    HASH_BITS,
  )
  return { salt: toHex(salt), hash: toHex(bits) }
}

export async function setStaffPin(staffId, pin) {
  const problem = pinProblem(pin)
  if (problem) return { data: null, error: { message: problem } }

  let hashed
  try {
    hashed = await hashPin(String(pin))
  } catch {
    return { data: null, error: { message: 'Could not set the PIN in this browser.' } }
  }

  const { data, error } = await supabase.rpc('set_staff_pin', {
    p_staff_id: staffId,
    p_salt: hashed.salt,
    p_hash: hashed.hash,
    p_iterations: PIN_ITERATIONS,
  })
  if (error) {
    return {
      data: null,
      error: {
        message:
          error.code === '42501'
            ? 'You can’t set PINs for this organization.'
            : 'Could not set the PIN. Try again.',
      },
    }
  }
  return { data: data ?? null, error: null }
}

export async function getStaffPinStatus(staffId) {
  const { data, error } = await supabase.rpc('staff_pin_status', {
    p_staff_id: staffId,
  })
  if (error) return { data: null, error }
  return { data: data ?? null, error: null }
}
