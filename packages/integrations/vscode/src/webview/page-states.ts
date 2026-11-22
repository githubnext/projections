// What a projection tab's page shows before, and instead of, its projection: the skeleton the static page draws until
// the projection view draws its own parts, and an invalid definition's diagnostics.
import {hostTag, type ProjectionFailure} from '../protocol.js'
import {post} from './host.js'

/**
 * A projection tab's skeleton (see `skeletonMarkup`) gives way in place: its toolbar strip once the view's toolbar is
 * drawn, its summary bar strip once the view's bar is, its loading status once the Inspector shows its own (the same
 * spinner, with what it's doing), and the whole of it once the
 * projection has loaded (the view is drawn and its renderer is no longer loading), or failed.
 */
export function replaceSkeleton() {
  const skeleton = document.querySelector<HTMLElement>('[data-skeleton]')
  if (!skeleton) return
  const settle = () => {
    if (document.querySelector('.phv-toolbar')) skeleton.dataset.toolbar = ''
    if (document.querySelector('[data-summary-bar]')) skeleton.dataset.bar = ''
    // The Inspector's own status (what it's doing, such as extracting, with Cancel) takes over the skeleton's.
    if (document.querySelector('#root .phv-loading-content')) skeleton.dataset.status = ''
    const view = document.querySelector('.phv-root')
    const loading = view?.getAttribute('data-renderer-status') === 'loading' || Boolean(document.querySelector('#root .phv-loading'))
    const failed = document.querySelector('.projection-failure, #root [role="alert"]')
    if (failed || (view && !loading)) {
      observer.disconnect()
      skeleton.remove()
    }
  }
  const observer = new MutationObserver(settle)
  observer.observe(document.body, {subtree: true, childList: true, attributes: true, attributeFilter: ['data-renderer-status']})
  settle()
}

/** A diagnostic's location, linking to where it is in its file. */
function diagnosticLink(diagnostic: ProjectionFailure['diagnostics'][number] & {path: string}): HTMLAnchorElement {
  const link = document.createElement('a')
  link.href = '#'
  link.textContent = diagnostic.line ? `${diagnostic.path}:${diagnostic.line}` : diagnostic.path
  link.addEventListener('click', event => {
    event.preventDefault()
    post({
      tag: hostTag,
      op: 'openFile',
      path: diagnostic.path,
      ...(diagnostic.line ? {line: diagnostic.line} : {}),
      ...(diagnostic.column ? {column: diagnostic.column} : {}),
    })
  })
  return link
}

/** A projection whose definition can't load: its diagnostics, each linking to where it is. */
export function showFailure(root: HTMLElement, failure: ProjectionFailure) {
  const page = document.createElement('section')
  page.className = 'projection-failure'
  page.setAttribute('role', 'alert')
  const heading = document.createElement('h2')
  const icon = document.createElement('span')
  icon.className = 'codicon codicon-error'
  icon.setAttribute('aria-hidden', 'true')
  heading.append(icon, ` ${failure.title}`)
  const list = document.createElement('ul')
  for (const diagnostic of failure.diagnostics) {
    const item = document.createElement('li')
    if (diagnostic.path) item.append(diagnosticLink({...diagnostic, path: diagnostic.path}), ': ')
    item.append(diagnostic.message)
    list.append(item)
  }
  const hint = document.createElement('p')
  hint.textContent = 'Fix the definition and save; the other projections are unaffected.'
  page.append(heading, list, hint)
  root.replaceChildren(page)
}
