import {useCallback, useMemo, useState} from 'react'
import {ComparisonError, customRenderer, useComparisonPair} from '@githubnext/projections-host'
import type {
  ComparatorSource,
  ExtractionChoice,
  RendererEntry,
  RendererManifest,
  RulesRuntime,
  WithheldRenderer,
} from '@githubnext/projections-host'
import type {ExtractionDocument, ProjectionEngine} from '@githubnext/projections-schemas'
import {customComparator} from '@githubnext/projections-schemas'
import {InspectorRequestError} from '../transport.js'
import type {InspectorApi} from '../client/api.js'
import type {PartOverrides} from '../parts/model.js'
import type {InspectorDefinitionList} from '../types.js'
import {definitionPolicy} from './definitions.js'
import {errorText} from './errors.js'
import type {InspectorComparison} from './props.js'
import {workingTree} from './revisions.js'
import type {Rows} from './use-extractions.js'

const customManifest: RendererManifest = {format: 'projections.renderer', version: 0, name: 'custom', title: 'Custom', handles: []}

/**
 * Compares the presented pair in this browser: the comparator (the default one, or a comparator file the runner supplies)
 * and the renderer (built-in, or the projection's custom bundle, reloaded by `rendererVersions` when its files change).
 */
export function useComparison({
  api,
  engine,
  rules,
  renderers,
  customRendererBase,
  rows,
  definitionRevision,
  overrides,
  lists,
  authorized,
  trusted,
  choices,
  before,
  after,
}: {
  api: InspectorApi | undefined
  engine: ProjectionEngine
  rules: RulesRuntime | undefined
  renderers: readonly RendererEntry[] | undefined
  customRendererBase: string | undefined
  rows: Rows
  definitionRevision: string
  overrides: {[projection: string]: PartOverrides}
  lists: {[ref: string]: InspectorDefinitionList}
  authorized: boolean
  trusted: boolean
  choices: ExtractionChoice[]
  before: string
  after: string | undefined
}) {
  const [computed, setComputed] = useState<InspectorComparison | undefined>()
  // Each projection's custom renderer bundle is reloaded (cache-busted by this version) when its files change.
  const [rendererVersions, setRendererVersions] = useState<{[projection: string]: number}>({})
  const definitionOf = useCallback(
    (document: ExtractionDocument) => {
      for (const state of Object.values(rows[document.projection.id] ?? {}))
        if (state.document?.digest === document.digest) return state.definition ?? definitionRevision
      return definitionRevision
    },
    [rows, definitionRevision],
  )
  const loadComparator = useCallback(
    async (document: ExtractionDocument, signal: AbortSignal): Promise<ComparatorSource> => {
      const declared = document.provenance.definition.comparator
      const path = customComparator(declared)?.file
      if (!path) return {kind: 'default'}
      const what = `comparator file ${path}`
      if (!api) {
        throw new ComparisonError(
          'comparator-unavailable',
          `The ${what} is supplied only by a local runner; saved artifacts do not contain custom comparators.`,
        )
      }
      let supplied
      try {
        const chosen = overrides[document.projection.id]?.comparator
        supplied =
          chosen?.startsWith('file:') && api.rulesFile
            ? await api.rulesFile(chosen.slice('file:'.length), definitionOf(document), signal)
            : await api.comparator(document.projection.id, definitionOf(document), signal)
      } catch (failure) {
        if (failure instanceof InspectorRequestError && failure.status === 404) {
          throw new ComparisonError(
            'comparator-unavailable',
            `This local runner does not supply custom comparators (GET /api/comparator returned 404), so the ${what} cannot run here. Update the Projections CLI.`,
          )
        }
        throw new ComparisonError('comparator-unavailable', `Could not load the ${what}: ${errorText(failure)}`)
      }
      return supplied.kind === 'default' ? supplied : {kind: supplied.kind, id: path, bytes: supplied.bytes, digest: supplied.digest}
    },
    [api, definitionOf, overrides],
  )
  const custom = useCallback(
    (document: ExtractionDocument): RendererEntry | WithheldRenderer | undefined => {
      if (!customRendererBase || typeof document.projection.renderer === 'string') return undefined
      const ref = definitionOf(document)
      const chosen = overrides[document.projection.id]?.renderer
      const source = chosen?.startsWith('custom:') ? chosen.slice('custom:'.length) : document.projection.id
      if (definitionPolicy(lists[ref], source).rendererRequiresTrust && !(authorized && trusted)) {
        return {
          withheld: `The custom renderer ${document.projection.renderer.bundle} comes from a revision outside this checkout's history and differs from the renderer at its merge base, so it needs trust like a pull request's extractor. ${
            authorized ? '' : "Trust the workspace (the runner's --trust) to run it."
          }`,
        }
      }
      // While the renderer's development server runs, the working tree's renderer comes from it.
      const development = ref === workingTree ? definitionPolicy(lists[ref], source).rendererDevServer : undefined
      // A built bundle reloads when its files change; a development server updates the frame itself.
      const version = ref === workingTree ? (rendererVersions[source] ?? 0) : 0
      // The server reads a bundle at a full commit (or the working tree): a symbolic revision such as the committed
      // definition's `HEAD` is the commit its definitions were listed at.
      const revision = ref === workingTree ? ref : (lists[ref]?.commit ?? ref)
      // Named for the projection, as it was scaffolded with its renderer, rather than "Custom".
      const title =
        (source === document.projection.id
          ? document.projection.title
          : lists[ref]?.definitions.find(definition => definition.id === source)?.title) ||
        document.projection.renderer.bundle.replace(/\/+$/, '').split('/').at(-1) ||
        customManifest.title
      return customRenderer(
        {...customManifest, title},
        development ??
          `${customRendererBase}${encodeURIComponent(revision)}/${encodeURIComponent(source)}/index.html${version ? `?v=${version}` : ''}`,
      )
    },
    [customRendererBase, definitionOf, lists, authorized, trusted, rendererVersions, overrides],
  )
  const builtins = useMemo(() => renderers ?? [], [renderers])
  const onComparison = useCallback((result: InspectorComparison | undefined) => setComputed(result), [])
  const pair = useComparisonPair({
    extractions: choices,
    engine,
    renderers: builtins,
    customRenderer: custom,
    loadComparator,
    ...(rules ? {rules} : {}),
    before,
    after,
    onComparison,
  })
  const comparison = pair.outcome.status === 'compared' ? computed : undefined
  return {pair, comparison, builtins, setRendererVersions}
}
