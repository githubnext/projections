export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent)
/** How a shortcut is written on this platform: `⌘K` or `Ctrl+K`; with `alt`, `⌥⌘B` or `Ctrl+Alt+B`. */
export function shortcutLabel(key: string, {alt = false}: {alt?: boolean} = {}): string {
  return isMac ? `${alt ? '⌥' : ''}⌘${key.toUpperCase()}` : `Ctrl+${alt ? 'Alt+' : ''}${key.toUpperCase()}`
}

export const iconButton =
  'pj:inline-flex pj:h-7 pj:w-7 pj:shrink-0 pj:items-center pj:justify-center pj:rounded-md pj:text-muted-foreground pj:transition-colors pj:hover:bg-muted pj:hover:text-foreground pj:focus-visible:outline-hidden pj:focus-visible:ring-1 pj:focus-visible:ring-ring pj:disabled:pointer-events-none pj:disabled:opacity-50 pj:aria-pressed:text-foreground'
