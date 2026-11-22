import {useState, type HTMLAttributes, type Ref} from 'react'
import {cn} from '../lib/utils.js'
import {PortalContainerContext} from '../lib/portal.js'

/** The props of `ScopedRoot`: a `div`'s, and the `colorMode` that adds `pj-dark` (default `light`). */
export interface ScopedRootProps extends HTMLAttributes<HTMLDivElement> {
  colorMode?: 'light' | 'dark'
  ref?: Ref<HTMLDivElement>
}

/**
 * The element every host UI component must render inside: it carries the `pj-root` scope (and `pj-dark` in
 * dark mode) and an in-scope container for Radix portals, so menus and tooltips keep the scoped styles.
 * Utilities only match descendants (`.pj-root .pj\:…`), so style this element with your own CSS, not `pj:` classes.
 */
export function ScopedRoot({colorMode = 'light', className, children, ref, ...props}: ScopedRootProps) {
  const [portal, setPortal] = useState<HTMLDivElement | null>(null)
  return (
    <div ref={ref} className={cn('pj-root', colorMode === 'dark' && 'pj-dark', className)} data-color-mode={colorMode} {...props}>
      <PortalContainerContext value={portal}>{children}</PortalContainerContext>
      {/* Out of flow, so it takes no flex gap in a root laid out as a column (the views'). Its content is fixed. */}
      <div ref={setPortal} data-pj-portal="" style={{position: 'absolute'}} />
    </div>
  )
}
