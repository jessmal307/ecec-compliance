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

const GUIDE_DISMISSED_KEY = 'rtc-floor-install-dismissed'

export function installGuideDismissed() {
  try {
    return window.localStorage.getItem(GUIDE_DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

export function dismissInstallGuide() {
  try {
    window.localStorage.setItem(GUIDE_DISMISSED_KEY, '1')
  } catch {
    // Hidden until the next reload.
  }
}

export function runningFromHomeScreen() {
  try {
    return (
      window.navigator.standalone === true ||
      window.matchMedia('(display-mode: standalone)').matches
    )
  } catch {
    return false
  }
}

export function floorDevicePlatform() {
  const ua = window.navigator.userAgent || ''
  // iPadOS reports itself as a Mac; touch points give it away.
  if (/iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && window.navigator.maxTouchPoints > 1)) {
    return 'ios'
  }
  if (/Android/i.test(ua)) return 'android'
  return 'other'
}

// Only the floor page is installable, so these tags live only while it's shown.
export function addFloorAppHead() {
  const tags = [
    ['link', { rel: 'manifest', href: '/floor.webmanifest' }],
    ['link', { rel: 'apple-touch-icon', href: '/floor-icon-180.png' }],
    ['meta', { name: 'apple-mobile-web-app-capable', content: 'yes' }],
    ['meta', { name: 'apple-mobile-web-app-title', content: 'RoadToComply' }],
    ['meta', { name: 'theme-color', content: '#14303f' }],
  ].map(([tag, attributes]) => {
    const element = document.createElement(tag)
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value)
    document.head.appendChild(element)
    return element
  })
  return () => tags.forEach((element) => element.remove())
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
