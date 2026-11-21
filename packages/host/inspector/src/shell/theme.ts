import {useCallback, useState} from 'react'
import {useColorMode} from '@githubnext/projections-host/ui/components'
import type {Command} from './palette.js'
import {useHostTheme} from '../host.js'

export type ThemePreference = 'auto' | 'light' | 'dark'
const storageKey = 'projections-inspector-theme'

/**
 * The person's theme choice, remembered in this browser, and the color mode it resolves to. System follows the
 * embedding host's theme when it has one (an editor's color theme), else the operating system's. `themeTokens` are the
 * host's renderer token overrides while the page shows the host's color mode (they are that mode's colors), or the
 * host's overrides for the other mode when it has them (`InspectorHostTheme.modes`).
 */
export function useTheme(): {
  preference: ThemePreference
  setPreference: (value: ThemePreference) => void
  colorMode: 'light' | 'dark'
  themeTokens: Record<string, string> | undefined
  commands: Command[]
} {
  const [preference, set] = useState<ThemePreference>(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      return saved === 'light' || saved === 'dark' ? saved : 'auto'
    } catch {
      return 'auto'
    }
  })
  const setPreference = useCallback((value: ThemePreference) => {
    set(value)
    try {
      localStorage.setItem(storageKey, value)
    } catch {
      /* storage may be unavailable */
    }
  }, [])
  const host = useHostTheme()
  const system = useColorMode(preference)
  const colorMode = preference === 'auto' && host ? host.colorMode : system
  const themeTokens = host?.colorMode === colorMode ? host.tokens : host?.modes?.[colorMode]
  const commands: Command[] = (
    [
      ['auto', 'System'],
      ['light', 'Light'],
      ['dark', 'Dark'],
    ] as const
  ).map(([value, label]) => ({
    id: `theme.${value}`,
    group: 'Theme',
    label: `Theme: ${label}${preference === value ? ' (current)' : ''}`,
    keywords: 'color mode appearance',
    run: () => setPreference(value),
  }))
  return {preference, setPreference, colorMode, themeTokens, commands}
}
