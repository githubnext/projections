import {useEffect, useRef, type ComponentType} from 'react'
import {createRoot} from 'react-dom/client'
import type {RendererAccepts} from '@githubnext/projections-renderer-sdk/protocol'
import {KitRenderer} from './kit-renderer.js'
import type {MountOptions, RendererProps} from './props.js'

/** The renderer mounted in a document's `#root`, kept on the element so a re-run kit module finds it too. */
const mounted = Symbol.for('projections.kit.mounted')
type MountedContainer = HTMLElement & {[mounted]?: {unmount(): void}}

/**
 * Mounts a kit renderer into the bundle's `#root`, from the renderer's entry
 * module (`rendererConfig({view})` generates one that calls it). Mounting again
 * in the same document, as a development server's hot update re-runs the
 * entry, first unmounts the earlier renderer. No StrictMode: its doubled
 * effects would connect to the host, and post `ready`, twice.
 */
export function mountRenderer<const A extends readonly RendererAccepts[] | undefined = undefined>(
  component: ComponentType<RendererProps<NoInfer<A>>>,
  options: MountOptions & {accepts?: A},
): {unmount(): void} {
  const container: MountedContainer | null = document.getElementById('root')
  if (!container) throw new Error('The renderer document has no #root element')
  container[mounted]?.unmount()
  const root = createRoot(container)
  // The shell refuses extractions outside `accepts`, so the component receives only what `A` types.
  root.render(<KitRenderer component={component as unknown as ComponentType<RendererProps>} options={options} />)
  // Unmounting disconnects from the host; a renderer mounted again in the same
  // document (a development server's hot update) is replayed the host's state.
  const renderer = {
    unmount() {
      if (container[mounted] !== renderer) return
      delete container[mounted]
      root.unmount()
    },
  }
  container[mounted] = renderer
  return renderer
}

/**
 * Runs `handlers[id]` when the host activates the declared action control
 * `id`, for as long as the component is mounted.
 */
export function useControlActions(onAction: RendererProps['onAction'], handlers: Record<string, () => void>): void {
  const latest = useRef(handlers)
  useEffect(() => {
    latest.current = handlers
  })
  useEffect(() => onAction(id => latest.current[id]?.()), [onAction])
}
