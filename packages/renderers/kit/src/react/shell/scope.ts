// The Changes scope as the shell hands it to a renderer: the host's scope with the parts the person opened, and for a
// canvas (`MountOptions.scope` `subset`) a model of only what it shows.
import {useCallback, useMemo, useState} from 'react'
import type {FilterPayload} from '@githubnext/projections-renderer-sdk/protocol'
import type {ComparisonModel} from '../../model.js'
import {changesScope, isFold, scopedModel} from '../../scope.js'
import type {ScopeView} from '../../scope.js'
import type {DocumentModel} from './document.js'
import type {MountOptions} from './props.js'

const none: ReadonlySet<string> = new Set()

/**
 * The renderer's `scope` and the document it presents: the host's Changes scope (`changesScope`) with what the person
 * opened since the host last changed it, and for a `subset` renderer the document narrowed to it (`scopedModel`), so
 * its timeline steps through only what is shown.
 */
export function useScopeView(
  resolved: ComparisonModel | undefined,
  filter: FilterPayload | undefined,
  document: DocumentModel | undefined,
  options: MountOptions['scope'],
  renderer = '',
): {scope: ScopeView | undefined; document: DocumentModel | undefined} {
  const more = options?.layout === 'subset' ? options.context : undefined
  const hostScope = useMemo(() => {
    const scope = changesScope(resolved, filter)
    if (!scope || !resolved || !more) return scope
    // What the renderer needs to place the changes, beyond their endpoints and containers: shown as context.
    const extra = [...more(resolved, scope.changes, renderer)].filter(id => !scope.shown.has(id))
    if (!extra.length) return scope
    return {changes: scope.changes, context: new Set([...scope.context, ...extra]), shown: new Set([...scope.shown, ...extra])}
  }, [resolved, filter, more, renderer])
  const key = hostScope ? [...hostScope.shown].toSorted().join('\n') : ''
  // What the person opened since the host last changed the scope: items, and folds (which keep their place).
  const [opened, setOpened] = useState<{key: string; ids: ReadonlySet<string>}>({key, ids: none})
  const openedIds = opened.key === key ? opened.ids : none
  const subset = options?.layout === 'subset' ? (options.parts ?? 'omit') : undefined
  const scoped = useMemo(() => {
    if (!hostScope || !resolved) return undefined
    const items = [...openedIds].filter(id => !isFold(id))
    const shown = items.length ? new Set([...hostScope.shown, ...items]) : hostScope.shown
    const folds = new Set([...openedIds].filter(isFold))
    const narrowed = subset ? scopedModel(resolved, shown, subset, folds) : undefined
    const open = [...folds].flatMap(id => narrowed?.folds.get(id) ?? [])
    return {shown: open.length ? new Set([...shown, ...open]) : shown, narrowed}
  }, [hostScope, resolved, openedIds, subset])
  const change = useCallback(
    (ids: Iterable<string>, add: boolean) =>
      setOpened(previous => {
        const next = new Set(previous.key === key ? previous.ids : none)
        for (const id of ids) {
          if (add) next.add(id)
          else next.delete(id)
        }
        return {key, ids: next}
      }),
    [key],
  )
  const expand = useCallback((ids: Iterable<string>) => change(ids, true), [change])
  const collapse = useCallback((ids: Iterable<string>) => change(ids, false), [change])
  const scope = useMemo<ScopeView | undefined>(
    () => (hostScope && scoped && resolved ? {...hostScope, shown: scoped.shown, all: resolved, expand, collapse} : undefined),
    [hostScope, scoped, resolved, expand, collapse],
  )
  const narrowed = scoped?.narrowed?.model
  const shownDocument = useMemo(
    () => (document && narrowed && !(document.model instanceof Error) ? {...document, model: narrowed} : document),
    [document, narrowed],
  )
  return {scope, document: shownDocument}
}
