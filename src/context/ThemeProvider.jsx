import { useMemo, useState } from 'react'
import { ThemeContext } from './theme-context'
import { applyTheme, resolveTheme } from '../lib/theme'

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    if (typeof document === 'undefined') return 'light'
    return document.documentElement.getAttribute('data-theme') || resolveTheme()
  })

  const value = useMemo(
    () => ({
      theme,
      setTheme: (next) => {
        setTheme(applyTheme(next))
      },
      toggleTheme: () => {
        setTheme(applyTheme(theme === 'dark' ? 'light' : 'dark'))
      },
    }),
    [theme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
