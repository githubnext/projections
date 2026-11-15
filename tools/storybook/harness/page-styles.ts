import {useLayoutEffect} from 'react'

/**
 * Adds page-level CSS while a harness story is mounted. Harness pages style `html` and `body` as standalone
 * pages did, so their CSS is inlined and removed again rather than imported into Storybook's shared preview.
 */
export function usePageStyles(css: string) {
  useLayoutEffect(() => {
    const style = document.createElement('style')
    style.textContent = css
    document.head.append(style)
    return () => style.remove()
  }, [css])
}
