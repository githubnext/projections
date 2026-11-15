import {useEffect, useMemo, useState} from 'react'
import type {ColorMode} from '@githubnext/projections-renderer-sdk/protocol'
import {hostTheme} from '../theme.js'
import type {ProjectionOptions} from './types.js'

function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(false)
  useEffect(() => {
    const media = window.matchMedia(query)
    const update = () => setMatches(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [query])
  return matches
}

export function locale(): string {
  return typeof navigator === 'undefined' ? 'en' : navigator.language || 'en'
}

/** The color mode (an explicit one, else the person's preference), its theme and whether motion is reduced. */
export function useHostEnvironment(options: Pick<ProjectionOptions, 'colorMode' | 'themeTokens'>) {
  const prefersDark = useMedia('(prefers-color-scheme: dark)')
  const reducedMotion = useMedia('(prefers-reduced-motion: reduce)')
  const colorMode: ColorMode =
    options.colorMode === 'light' || options.colorMode === 'dark' ? options.colorMode : prefersDark ? 'dark' : 'light'
  const themeKey = JSON.stringify(options.themeTokens ?? {})
  const theme = useMemo(() => hostTheme(colorMode, JSON.parse(themeKey) as Record<string, string>), [colorMode, themeKey])
  return {colorMode, theme, reducedMotion}
}
