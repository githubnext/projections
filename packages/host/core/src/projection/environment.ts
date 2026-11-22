import type {ColorMode} from '@githubnext/projections-renderer-sdk/protocol'
import {hostTheme} from '../theme.js'
import type {Memos} from './memo.js'
import type {ProjectionOptions} from './types.js'

const noop = () => undefined

export function locale(): string {
  return typeof navigator === 'undefined' ? 'en' : navigator.language || 'en'
}

/** The person's preferences the host follows: a dark color scheme, and reduced motion. */
export interface Media {
  readonly prefersDark: boolean
  readonly reducedMotion: boolean
}

/** Before they are read, and where they can't be (no `matchMedia`). */
export const noMedia: Media = {prefersDark: false, reducedMotion: false}

/**
 * Watches the person's color scheme and motion preferences: tells `onChange` them now and on each change, and returns
 * the function that stops watching. Without `matchMedia` it tells nothing.
 */
export function watchMedia(onChange: (media: Media) => void): () => void {
  if (typeof window === 'undefined' || typeof globalThis.window.matchMedia !== 'function') return noop
  const dark = globalThis.window.matchMedia('(prefers-color-scheme: dark)')
  const motion = globalThis.window.matchMedia('(prefers-reduced-motion: reduce)')
  const update = () => onChange({prefersDark: dark.matches, reducedMotion: motion.matches})
  update()
  dark.addEventListener('change', update)
  motion.addEventListener('change', update)
  return () => {
    dark.removeEventListener('change', update)
    motion.removeEventListener('change', update)
  }
}

/** The color mode (an explicit one, else the person's preference), its theme and whether motion is reduced. */
export function createHostEnvironment({memo, byValue}: Memos) {
  const tokensOf = byValue<Record<string, string>>()
  const themeOf = memo((colorMode: ColorMode, tokens: Record<string, string>) => hostTheme(colorMode, tokens))
  return (options: Pick<ProjectionOptions, 'colorMode' | 'themeTokens'>, media: Media) => {
    const colorMode: ColorMode =
      options.colorMode === 'light' || options.colorMode === 'dark' ? options.colorMode : media.prefersDark ? 'dark' : 'light'
    return {colorMode, theme: themeOf(colorMode, tokensOf(options.themeTokens ?? {})), reducedMotion: media.reducedMotion}
  }
}
