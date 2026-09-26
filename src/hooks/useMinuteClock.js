import { useEffect, useState } from 'react'

// The current time, refreshed just after each minute boundary.
export function useMinuteClock() {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    let timer = null
    function schedule() {
      const wait = 60_000 - (Date.now() % 60_000) + 250
      timer = setTimeout(() => {
        setNow(new Date())
        schedule()
      }, wait)
    }
    schedule()
    return () => clearTimeout(timer)
  }, [])

  return now
}
