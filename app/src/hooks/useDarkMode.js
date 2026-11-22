import { useEffect, useLayoutEffect, useState } from 'react'

const appearanceKey = 'tm_appearance'
const legacyKey = 'tm_dark_mode'
const mediaQuery = '(prefers-color-scheme: dark)'

function initialAppearance() {
  try {
    const saved = window.localStorage.getItem(appearanceKey)
    if (['system', 'light', 'dark'].includes(saved)) return saved
    const legacy = window.localStorage.getItem(legacyKey)
    if (legacy === 'true') return 'dark'
    if (legacy === 'false') return 'light'
  } catch {
    // Appearance still works for this session when storage is unavailable.
  }
  return 'system'
}

export function useDarkMode() {
  const [appearance, setAppearance] = useState(initialAppearance)
  const [systemDark, setSystemDark] = useState(() => window.matchMedia(mediaQuery).matches)
  const dark = appearance === 'system' ? systemDark : appearance === 'dark'

  useEffect(() => {
    const media = window.matchMedia(mediaQuery)
    const update = () => setSystemDark(media.matches)
    media.addEventListener('change', update)
    update()
    return () => media.removeEventListener('change', update)
  }, [])

  useLayoutEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#071428' : '#1A3555')
  }, [dark])

  useEffect(() => {
    try {
      window.localStorage.setItem(appearanceKey, appearance)
    } catch {
      // The in-memory selection remains active.
    }
  }, [appearance])

  return [dark, setAppearance, appearance]
}
