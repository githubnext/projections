import {createContext, use, useSyncExternalStore} from 'react'
import type {ReactNode} from 'react'

/**
 * The embedding host's theme: its light or dark mode and, where it has them, its accent color (any CSS color) and the
 * renderer theme token overrides that match it (for example `copilotCanvasThemeTokens`), sent to renderer frames
 * while the page shows the host's color mode.
 */
export interface InspectorHostTheme {
  colorMode: 'light' | 'dark'
  accent?: string
  tokens?: Readonly<Record<string, string>>
  /**
   * Token overrides for a color mode other than the host's, sent while the person's theme choice shows that mode (the
   * other mode of a theme seed, which has its own colors for both).
   */
  modes?: Readonly<Partial<Record<'light' | 'dark', Readonly<Record<string, string>>>>>
}

/**
 * What the surface embedding the Inspector can do for it. Every capability is optional; without one the Inspector
 * keeps its web behavior (for example, paths stay text and copying uses the browser clipboard).
 */
export interface InspectorHost {
  /** Opens a repository file, at a 1-based line and column, in the host's editor. Evidence and part source paths use it. */
  openFile?(path: string, line?: number, column?: number): void
  /** Shows a revision (a commit, branch, tag or `working-tree`) in the host's source control view. */
  revealInScm?(ref: string): void
  /** Writes text to the clipboard where the page's own clipboard is unavailable, as in some webviews. */
  copyText?(text: string): Promise<void>
  /** Opens an external `https:` or `http:` URL outside the Inspector. */
  openExternal?(url: string): void
  /**
   * Hands adding Projections to the repository's CI to the host's coding agent, with the Add to CI prompt. Without it
   * the Explore view offers the prompt to copy, and the guide.
   */
  addToCi?(): void
  /** Follows the host's theme instead of the system's when the person's theme choice is System. */
  theme?: {
    get(): InspectorHostTheme
    subscribe(listener: () => void): () => void
  }
  /**
   * Revisions named for people by the host, by ref (`main · "Add auth package" · 2 days ago`), so the panes, slider
   * and pickers read as the host's own pickers do. Refs it doesn't name get the Inspector's own label.
   */
  revisionLabels?: {
    get(): Record<string, string> | undefined
    subscribe(listener: () => void): () => void
  }
  /**
   * The host's own surface already says exactly what is compared (a pull request page names its base and head), so the
   * viewer doesn't say it again: its header draws no revision pills. The CLI viewer and the Copilot canvas say nothing
   * of the sort, and keep them.
   */
  revisionsNamed?: boolean
}

/** The web's: no embedding host. */
const webHost: InspectorHost = {}
const HostContext = createContext<InspectorHost>(webHost)

/** Supplies the embedding host's capabilities to the Inspector beneath it; `undefined` keeps its web behavior. */
export function InspectorHostProvider({host, children}: {host: InspectorHost | undefined; children: ReactNode}) {
  return <HostContext value={host ?? webHost}>{children}</HostContext>
}

export function useInspectorHost(): InspectorHost {
  return use(HostContext)
}

const noTheme = {get: () => undefined, subscribe: () => () => {}}
/** The host's names for revisions, following its changes; `undefined` without any. */
export function useHostRevisionLabels(): Record<string, string> | undefined {
  const labels = useInspectorHost().revisionLabels ?? noTheme
  return useSyncExternalStore(labels.subscribe, labels.get, labels.get)
}

/** The host's theme, following its changes; `undefined` without one. */
export function useHostTheme(): InspectorHostTheme | undefined {
  const theme = useInspectorHost().theme ?? noTheme
  return useSyncExternalStore(theme.subscribe, theme.get, theme.get)
}

/** Copies text with the host's clipboard, else the browser's. */
export function copyText(host: InspectorHost, text: string): Promise<void> {
  if (host.copyText) return host.copyText(text)
  return navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject(new Error('The clipboard is unavailable'))
}

/** Whether a link is an external `http:` or `https:` URL, which a host's `openExternal` should open. */
export function externalUrl(href: string | null | undefined, base: string): string | undefined {
  if (!href) return undefined
  try {
    const url = new URL(href, base)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined
    if (url.origin === new URL(base).origin) return undefined
    return url.href
  } catch {
    return undefined
  }
}
