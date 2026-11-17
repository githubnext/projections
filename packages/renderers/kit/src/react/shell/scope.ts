// The Changes scope as the shell hands it to a renderer: the host's scope with the parts the person opened, and for a
// canvas (`MountOptions.scope` `subset`) a model of only what it shows.
import {useCallback, useMemo, useState} from 'react'
import type {FilterPayload} from '@githubnext/projections-renderer-sdk/protocol'
import type {ComparisonModel} from '../../model.js'
import {changesScope, scopedModel} from '../../scope.js'
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
): {scope: ScopeView | undefined; document: DocumentModel | undefined} {
  const hostScope = useMemo(() => changesScope(resolved, filter), [resolved, filter])
  const key = hostScope ? [...hostScope.shown].sort().join('\n') : ''
  const [opened, setOpened] = useState<{key: string; ids: ReadonlySet<string>}>({key, ids: none})
  const openedIds = opened.key === key ? opened.ids : none
  const subset = options?.layout === 'subset' ? (options.parts ?? 'omit') : undefined
  const scoped = useMemo(() => {
    if (!hostScope || !resolved) return undefined
    const shown = openedIds.size ? new Set([...hostScope.shown, ...openedIds]) : hostScope.shown
    return {shown, narrowed: subset ? scopedModel(resolved, shown, subset) : undefined}
  }, [hostScope, resolved, openedIds, subset])
  const folds = scoped?.narrowed?.folds
  const expand = useCallback(
    (ids: Iterable<string>) =>
      setOpened(previous => {
        const next = new Set(previous.key === key ? previous.ids : none)
        for (const id of ids) for (const part of folds?.get(id) ?? [id]) next.add(part)
        return {key, ids: next}
      }),
    [key, folds],
  )
  const scope = useMemo<ScopeView | undefined>(
    () => (hostScope && scoped && resolved ? {...hostScope, shown: scoped.shown, all: resolved, expand} : undefined),
    [hostScope, scoped, resolved, expand],
  )
  const narrowed = scoped?.narrowed?.model
  const shownDocument = useMemo(
    () => (document && narrowed && !(document.model instanceof Error) ? {...document, model: narrowed} : document),
    [document, narrowed],
  )
  return {scope, document: shownDocument}
}
