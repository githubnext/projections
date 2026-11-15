import {rendererFragment, rendererSandbox} from '@githubnext/projections-renderer-sdk/protocol'
import type {RendererFrameOptions} from './types.js'

/** A fresh channel nonce: 24 random bytes, base64url without padding. */
export function nonce(view: Window): string {
  const bytes = new Uint8Array(24)
  view.crypto.getRandomValues(bytes)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return view.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** The size styles of a frame that fills its container's height, or follows the renderer's requested `height`. */
export const fillStyle = (fill: boolean, height: string) => ({
  height: fill ? '' : height,
  flex: fill ? '1 1 0' : '',
  minHeight: fill ? '0' : '',
})

/**
 * The sandboxed frame for a renderer bundle, transparent until revealed, its URL fragment carrying the channel. Not
 * yet attached.
 */
export function frameElement(options: RendererFrameOptions, view: Window, channel: string, fill: boolean): HTMLIFrameElement {
  const iframe = options.container.ownerDocument.createElement('iframe')
  iframe.setAttribute('sandbox', rendererSandbox)
  iframe.setAttribute('allow', '')
  iframe.setAttribute('referrerpolicy', 'no-referrer')
  iframe.setAttribute('loading', 'eager')
  // An accessible name without `title`, which browsers also show as a tooltip over the whole frame.
  iframe.setAttribute('aria-label', options.title)
  iframe.className = 'ph-frame'
  // Structure only; host UIs may restyle `.ph-frame` (for example a border). The frame is transparent until the
  // renderer has painted with the host theme, so its unthemed first paint never shows. Its `color-scheme` matches the
  // renderer document's root, so browsers never paint an opaque backdrop behind it.
  Object.assign(iframe.style, {
    display: 'block',
    width: '100%',
    ...fillStyle(fill, '480px'),
    border: '0',
    background: 'transparent',
    colorScheme: 'light dark',
    opacity: '0',
  })
  iframe.dataset.revealed = 'false'
  const url = new URL(options.url, view.location.href)
  url.hash = rendererFragment(channel, view.location.origin, options.init.theme.colorMode)
  iframe.src = url.href
  return iframe
}

/** The renderer's viewport: the frame's width and the window's height, in whole CSS pixels. */
export const viewportOf = (iframe: HTMLIFrameElement, view: Window) => ({
  width: Math.round(iframe.clientWidth),
  height: Math.round(view.innerHeight),
})

/** Reports the viewport whenever the frame resizes and it changed; nothing where ResizeObserver doesn't exist. */
export function observeViewport(
  iframe: HTMLIFrameElement,
  view: Window,
  report: (viewport: {width: number; height: number}) => void,
): ResizeObserver | undefined {
  if (typeof ResizeObserver === 'undefined') return undefined
  let last = ''
  const observer = new ResizeObserver(() => {
    const viewport = viewportOf(iframe, view)
    const key = `${viewport.width}x${viewport.height}`
    if (key === last) return
    last = key
    report(viewport)
  })
  observer.observe(iframe)
  return observer
}
