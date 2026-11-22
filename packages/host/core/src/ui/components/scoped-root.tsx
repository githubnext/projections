import {forwardRef, useState, type HTMLAttributes} from 'react'
import {cn} from '../lib/utils.js'
import {PortalContainerContext} from '../lib/portal.js'

/** The props of `ScopedRoot`: a `div`'s, and the `colorMode` that adds `pj-dark` (default `light`). */
export interface ScopedRootProps extends HTMLAttributes<HTMLDivElement> {
  colorMode?: 'light' | 'dark'
}

/**
 * The element every host UI component must render inside: it carries the `pj-root` scope (and `pj-dark` in
 * dark mode) and an in-scope container for Radix portals, so menus and tooltips keep the scoped styles.
 * Utilities only match descendants (`.pj-root .pj\:…`), so style this element with your own CSS, not `pj:` classes.
 */
export const ScopedRoot = forwardRef<HTMLDivElement, ScopedRootProps>(({colorMode = 'light', className, children, ...props}, ref) => {
  const [portal, setPortal] = useState<HTMLDivElement | null>(null)
  return (
    <div ref={ref} className={cn('pj-root', colorMode === 'dark' && 'pj-dark', className)} data-color-mode={colorMode} {...props}>
      <PortalContainerContext.Provider value={portal}>{children}</PortalContainerContext.Provider>
      {/* Out of flow, so it takes no flex gap in a root laid out as a column (the views'). Its content is fixed. */}
      <div ref={setPortal} data-pj-portal="" style={{position: 'absolute'}} />
    </div>
  )
})
