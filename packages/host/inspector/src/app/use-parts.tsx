import {useCallback, useMemo} from 'react'
import type {Dispatch, SetStateAction} from 'react'
import type {ComparisonPair, RendererEntry} from '@githubnext/projections-host'
import {CircleAlert, CircleCheck, Radio} from 'lucide-react'
import type {InspectorApi} from '../client/api.js'
import {DefaultOrder} from '../parts/default-order.js'
import type {DefinitionWriter, PartName, PartOverrides, PartRow} from '../parts/model.js'
import type {InspectorDefinitionList, InspectorPolicy} from '../types.js'
import {partPath} from './definitions.js'
import {comparatorOptions, dataFields, extractorOptions, rendererOptions} from './part-options.js'
import type {Marks} from './pairs.js'
import {workingTree} from './revisions.js'
import type {Rows} from './use-extractions.js'

/**
 * The selected projection's three parts (extractor, comparator, renderer), each a selector of the definition's own
 * and the alternatives, overridden for the session; and saving the overrides to the definition file.
 */
export function useParts({
  api,
  projection,
  definitions,
  definitionRevision,
  authorized,
  overrides,
  setOverrides,
  setRows,
  refreshDefinitions,
  builtins,
  pair,
  policy,
  statusOf,
  rows,
  marks,
  usesOwnRenderer,
  rendererPolicy,
}: {
  api: InspectorApi | undefined
  projection: string
  definitions: InspectorDefinitionList | null
  definitionRevision: string
  authorized: boolean
  overrides: Record<string, PartOverrides>
  setOverrides: Dispatch<SetStateAction<Record<string, PartOverrides>>>
  setRows: Dispatch<SetStateAction<Rows>>
  refreshDefinitions: (ref: string, quiet?: boolean) => Promise<void>
  builtins: readonly RendererEntry[]
  pair: ComparisonPair
  policy: InspectorPolicy
  statusOf: (id: string) => PartRow['status']
  rows: Rows
  marks: Record<string, Marks>
  usesOwnRenderer: boolean
  rendererPolicy: InspectorPolicy
}) {
  // The selected projection's three parts, each a selector of the definition's own and the alternatives.
  const allDefinitions = useMemo(() => definitions?.definitions ?? [], [definitions])
  const ownDefinition = allDefinitions.find(item => item.id === projection)
  const setPart = useCallback(
    (part: PartName, value: string) => {
      setOverrides(current => {
        const own: PartOverrides = {...current[projection]}
        const {[part]: _dropped, ...others} = own
        const next: PartOverrides = value === 'own' ? others : {...own, [part]: value}
        if (part === 'comparator' && value !== 'default') delete next.order
        return {...current, [projection]: next}
      })
      // A different extractor makes the extractions stale: both sides are extracted again.
      if (part === 'extractor') setRows(current => ({...current, [projection]: {}}))
    },
    [projection, setOverrides, setRows],
  )
  const resetParts = useCallback(() => {
    if (overrides[projection]?.extractor) setRows(current => ({...current, [projection]: {}}))
    setOverrides(current => ({...current, [projection]: {}}))
  }, [overrides, projection, setOverrides, setRows])
  // Save to definition writes the working tree's definition file through the runner, with the runner's own --trust.
  const writer = useMemo<DefinitionWriter | undefined>(() => {
    if (!api || !projection || definitionRevision !== workingTree) return undefined
    return {
      preview: parts => api.saveDefinition({projectionId: projection, parts, dryRun: true}),
      save: async (parts, digest) => {
        await api.saveDefinition({projectionId: projection, parts, digest})
      },
      disabled: authorized
        ? undefined
        : "Saving writes repository files, so it needs the runner's --trust (in VS Code, a trusted workspace).",
      onSaved: () => {
        resetParts()
        void refreshDefinitions(workingTree, true)
      },
    }
  }, [api, projection, definitionRevision, authorized, resetParts, refreshDefinitions])
  const partRows = useMemo<PartRow[]>(() => {
    if (!ownDefinition) return []
    const others = allDefinitions.filter(item => item.id !== ownDefinition.id)
    const extractors = extractorOptions(ownDefinition, others)
    const ownRules = partPath(ownDefinition, 'comparator')
    const comparators = comparatorOptions(ownDefinition, others, definitions?.rules)
    const renderers = rendererOptions(ownDefinition, others, builtins, pair.document, policy)
    const parts = overrides[projection] ?? {}
    const comparatorValue = parts.comparator ?? 'own'
    const defaultComparator = comparatorValue === 'default' || (comparatorValue === 'own' && !ownRules)
    const comparisonStatus =
      pair.outcome.status === 'compared'
        ? {kind: 'ok', text: 'OK', icon: <CircleCheck className="pj:text-added" />}
        : pair.outcome.status === 'failed'
          ? {kind: 'failed', text: 'Failed', icon: <CircleAlert className="pj:text-destructive" />}
          : undefined
    return [
      {
        part: 'extractor',
        label: 'Extractor',
        value: parts.extractor ?? 'own',
        options: extractors,
        changed: Boolean(parts.extractor),
        status: statusOf(projection),
        onChange: value => setPart('extractor', value),
        onReset: () => setPart('extractor', 'own'),
      },
      {
        part: 'comparator',
        label: 'Comparator',
        value: comparatorValue,
        options: comparators,
        changed: Boolean(parts.comparator),
        status: comparisonStatus,
        onChange: value => setPart('comparator', value),
        onReset: () => setPart('comparator', 'own'),
        extra: defaultComparator ? (
          <DefaultOrder
            dataFields={dataFields(pair.document)}
            order={
              parts.order ??
              (comparatorValue === 'own' && typeof ownDefinition.comparator === 'object' && !('file' in ownDefinition.comparator)
                ? ownDefinition.comparator.options?.order
                : undefined)
            }
            onOrder={order =>
              setOverrides(current => {
                const next: PartOverrides = {...current[projection], comparator: 'default', order}
                if (!order && !ownRules && !ownDefinition.comparator) {
                  delete next.comparator
                  delete next.order
                }
                return {...current, [projection]: next}
              })
            }
          />
        ) : undefined,
      },
      {
        part: 'renderer',
        label: 'Renderer',
        value: parts.renderer ?? 'own',
        options: renderers,
        changed: Boolean(parts.renderer),
        status:
          usesOwnRenderer && rendererPolicy.rendererDevServer
            ? {kind: 'dev-server', text: 'Dev server live', icon: <Radio className="pj:text-added" />}
            : undefined,
        onChange: value => setPart('renderer', value),
        onReset: () => setPart('renderer', 'own'),
      },
    ]
    // statusOf reads rows and marks, which change with every extraction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    ownDefinition,
    allDefinitions,
    definitions?.rules,
    builtins,
    pair.document,
    pair.outcome.status,
    overrides,
    projection,
    policy,
    rows,
    marks,
    setPart,
    usesOwnRenderer,
    rendererPolicy,
  ])
  return {allDefinitions, ownDefinition, resetParts, writer, partRows}
}
