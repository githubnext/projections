// The brief pulse on an item selected in another pane or view.
import {pulseAttribute} from './attributes.js'

const pulseMs = 900
const pulseStyle = `@keyframes projections-pulse {
  0% { filter: drop-shadow(0 0 0 var(--projections-color-focus, #0969da)); }
  35% { filter: drop-shadow(0 0 6px var(--projections-color-focus, #0969da)); }
  100% { filter: none; }
}
[${pulseAttribute}] { animation: projections-pulse ${pulseMs}ms ease-out 1; }
@media (prefers-reduced-motion: reduce) { [${pulseAttribute}] { animation: none; } }
[data-reduced-motion="true"] [${pulseAttribute}] { animation: none; }
`

export interface Pulse {
  /** Briefly emphasizes an item selected elsewhere, after the renderer has drawn the selection. */
  pulse(id: string): void
  dispose(): void
}

/** Pulses the elements `elementsOf` finds for an item in `root`, never under reduced motion. */
export function createPulse(view: Window, root: HTMLElement, elementsOf: (id: string) => Element[]): Pulse {
  const document = root.ownerDocument
  let sheet: HTMLStyleElement | null = null
  let frame = 0
  let timer = 0
  const reducedMotion = () =>
    document.documentElement.dataset.reducedMotion === 'true' || view.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const stop = () => {
    view.cancelAnimationFrame(frame)
    view.clearTimeout(timer)
  }
  const clear = () => {
    for (const element of root.querySelectorAll(`[${pulseAttribute}]`)) element.removeAttribute(pulseAttribute)
  }
  return {
    pulse(id) {
      stop()
      clear()
      if (reducedMotion()) return
      if (!sheet) {
        sheet = document.createElement('style')
        sheet.textContent = pulseStyle
        document.head.append(sheet)
      }
      frame = view.requestAnimationFrame(() => {
        const elements = elementsOf(id)
        for (const element of elements) element.setAttribute(pulseAttribute, '')
        timer = view.setTimeout(() => {
          for (const element of elements) element.removeAttribute(pulseAttribute)
        }, pulseMs)
      })
    },
    dispose() {
      stop()
      sheet?.remove()
      clear()
    },
  }
}
