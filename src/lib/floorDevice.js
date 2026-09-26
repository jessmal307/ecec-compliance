// The floor link token remembered on this device. Storage can be blocked
// (private browsing, locked-down tablets), so every call tolerates failure.
const STORAGE_KEY = 'rtc-floor-token'

export function readStoredFloorToken() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) || ''
  } catch {
    return ''
  }
}

export function storeFloorToken(token) {
  try {
    window.localStorage.setItem(STORAGE_KEY, token)
  } catch {
    // Still works from the link in the address bar.
  }
}

export function clearStoredFloorToken() {
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing stored to clear.
  }
}

function decode(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

// Old links carry the token in the path (/s/<token>); new ones in the
// fragment (/floor#<token>), which browsers never send to a server.
export function resolveFloorToken(pathToken) {
  if (pathToken) return decode(pathToken).trim()
  const fragment = decode(window.location.hash.replace(/^#/, '')).trim()
  if (fragment) return fragment
  return readStoredFloorToken()
}
