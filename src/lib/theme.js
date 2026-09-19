const STORAGE_KEY = 'ecec-theme'

export function readStoredTheme() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    // localStorage can throw in private mode.
  }
  return null
}

export function systemTheme() {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

export function resolveTheme() {
  return readStoredTheme() ?? systemTheme()
}

export function applyTheme(theme) {
  const next = theme === 'dark' ? 'dark' : 'light'
  const root = document.documentElement
  root.setAttribute('data-theme', next)
  root.style.colorScheme = next
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // Ignore quota / private-mode failures.
  }
  return next
}
