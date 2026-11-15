import {createContext, useContext} from 'react'

/**
 * The element Radix portals (select menus, tooltips) render into. It must be inside the `.pj-root` element:
 * content portalled to `document.body` would lose every scoped style. Provided by `ScopedRoot`.
 */
export const PortalContainerContext = createContext<HTMLElement | null>(null)

/** The current portal container, or `undefined` (Radix's `document.body` default) outside a `ScopedRoot`. */
export function usePortalContainer(): HTMLElement | undefined {
  return useContext(PortalContainerContext) ?? undefined
}
