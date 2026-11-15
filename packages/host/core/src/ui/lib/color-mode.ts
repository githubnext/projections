import {useSyncExternalStore} from 'react'

const query = '(prefers-color-scheme: dark)'
const media = () => (typeof matchMedia === 'function' ? matchMedia(query) : undefined)

function subscribe(onChange: () => void) {
  const list = media()
  list?.addEventListener('change', onChange)
  return () => list?.removeEventListener('change', onChange)
}

/** The color mode to show: `light` or `dark` as given, otherwise (`auto` or nothing) the person's system preference. */
export function useColorMode(preference: 'light' | 'dark' | 'auto' = 'auto'): 'light' | 'dark' {
  const dark = useSyncExternalStore(
    subscribe,
    () => media()?.matches ?? false,
    () => false,
  )
  return preference === 'auto' ? (dark ? 'dark' : 'light') : preference
}
