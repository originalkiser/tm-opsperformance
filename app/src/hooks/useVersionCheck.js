import { useState, useEffect, useRef } from 'react'

/* __BUILD_ID__ is replaced by Vite's define at build time */
const CURRENT = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : null
const VERSION_URL = `${import.meta.env.BASE_URL}version.json`
const FIRST_CHECK_MS  = 60_000       // wait 1 min before first check
const POLL_INTERVAL   = 5 * 60_000  // then every 5 min

export function useVersionCheck() {
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const timer = useRef(null)

  const check = async () => {
    if (!CURRENT || import.meta.env.DEV) return
    try {
      const res = await fetch(`${VERSION_URL}?_=${Date.now()}`, { cache: 'no-store' })
      if (!res.ok) return
      const { v } = await res.json()
      if (v && v !== CURRENT) setUpdateAvailable(true)
    } catch {
      // network error — ignore, try again next interval
    }
  }

  useEffect(() => {
    const initial = setTimeout(() => {
      check()
      timer.current = setInterval(check, POLL_INTERVAL)
    }, FIRST_CHECK_MS)

    return () => {
      clearTimeout(initial)
      clearInterval(timer.current)
    }
  }, [])

  return updateAvailable
}
