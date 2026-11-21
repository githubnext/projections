// The icon stories' stylesheets: the renderer kit's (with the SDK's icons.css) and the gallery's, in the document only
// while an icon story is shown, so no other story sees the kit's page-wide rules.
import {useLayoutEffect, useState} from 'react'
import type {ReactNode} from 'react'
import kitStyles from '@githubnext/projections-renderer-kit/react.css?inline'
import galleryStyles from './icon-gallery.css?inline'

/**
 * Its children, once the icon stories' stylesheets are in the document and every stylesheet has loaded; it removes them
 * when it unmounts.
 */
export function IconStyles({children}: {children: ReactNode}) {
  const [ready, setReady] = useState(false)
  useLayoutEffect(() => {
    const style = document.createElement('style')
    style.setAttribute('data-sb-icon-styles', '')
    style.textContent = `${kitStyles}\n${galleryStyles}`
    document.head.append(style)
    // The kit's SvgIcon reads the icons' computed styles once, as it mounts: WebKit leaves them out while a stylesheet
    // (such as the VS Code frame's codicons) is still loading, so the gallery waits for every one.
    const pending = [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].filter(link => !link.sheet)
    let current = true
    void Promise.all(
      pending.map(
        link =>
          new Promise(settle => {
            ;['load', 'error'].forEach(event => link.addEventListener(event, settle, {once: true}))
          }),
      ),
    ).then(() => current && setReady(true))
    return () => {
      current = false
      style.remove()
    }
  }, [])
  return ready ? children : null
}
