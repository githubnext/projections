// The harness's query parameters and the synthetic saved extractions they configure.
import type {Definition, DomainSchema, Extraction, ExtractionDocument} from '@githubnext/projections-schemas'
import {isProjectionTarget} from '@githubnext/projections-host'
import type {EvidenceLink, ExtractionChoice, TargetAnnotation} from '@githubnext/projections-host'
import type {ComparisonExplorerProps} from '@githubnext/projections-host/ui'
import {demonstration, laterRevision} from './fixtures.js'

export const params = new URLSearchParams(location.search)

/** `?annotations=<JSON TargetAnnotation[]>`: markers a consumer such as a review app would supply. */
function demoAnnotations(): TargetAnnotation[] | undefined {
  const text = params.get('annotations')
  if (!text) return undefined
  try {
    const value: unknown = JSON.parse(text)
    return Array.isArray(value)
      ? value.filter(
          (item): item is TargetAnnotation =>
            typeof item === 'object' && item !== null && isProjectionTarget((item as {target?: unknown}).target),
        )
      : undefined
  } catch {
    return undefined
  }
}
export const annotations = demoAnnotations()

/** `?evidenceLinks`: where a review app would link evidence, for example a file at a commit. */
export const evidenceLink: EvidenceLink = (location, side) =>
  `https://example.test/${side}/${location.path}${location.line ? `#L${location.line}` : ''}`

export type RendererChoice = 'auto' | 'minimal' | 'none' | 'hostile'

/** Synthetic saved extractions. No extractor ran; the digests are placeholders the explorer does not verify. */
/** `?defaults=<JSON>` sets the definition's `presentation` block, as a projection definition would. */
const defaults = ((): Definition['presentation'] => {
  try {
    return params.has('defaults') ? (JSON.parse(params.get('defaults')!) as Definition['presentation']) : undefined
  } catch {
    return undefined
  }
})()

/** `?longIds` lengthens every ID and label without spaces, to check that narrow screens wrap them. */
function withLongIds(extraction: Extraction): Extraction {
  const long = (id: string) => `${id}.platform-services.internal.example.com/workloads/production/us-east-1/${id}-deployment-controller-v2`
  return {
    ...extraction,
    entities: extraction.entities.map(entity => ({
      ...entity,
      id: long(entity.id),
      label: long(entity.id),
      ...(entity.previousIds ? {previousIds: entity.previousIds.map(long)} : {}),
    })),
    relationships: extraction.relationships.map(relationship => ({
      ...relationship,
      id: long(relationship.id),
      from: long(relationship.from),
      to: long(relationship.to),
      ...(relationship.label ? {label: long(relationship.id)} : {}),
      ...(relationship.previousIds ? {previousIds: relationship.previousIds.map(long)} : {}),
    })),
  }
}

export function documents(
  schema: DomainSchema,
  presentation: string | undefined,
  comparator: 'default' | 'priority',
  renderer: Definition['renderer'],
): ExtractionChoice[] {
  const data = demonstration(schema, presentation)
  const definition = (inputs?: Record<string, string>): Definition => ({
    id: 'checkout',
    title: 'Checkout evolution',
    extractor: 'synthetic',
    renderer,
    ...(comparator === 'priority'
      ? {comparator: {file: 'comparators/priority-order.comparator.yaml', options: {priority: ['payments', 'audit']}}}
      : {}),
    ...(inputs ? {inputs} : {}),
    ...(defaults ? {presentation: defaults} : {}),
  })
  const document = (extraction: Extraction, commit: string, digest: string, revisionDefinition = definition()): ExtractionDocument => ({
    format: 'projections.extraction',
    version: 0,
    projection: {id: 'checkout', title: 'Checkout evolution', renderer},
    extraction: params.has('longIds') ? withLongIds(extraction) : extraction,
    provenance: {
      revision: {kind: 'commit', ref: commit, commit: commit.padEnd(40, '0'), dirty: false},
      extractor: {id: 'synthetic', version: '0'},
      definition: revisionDefinition,
      definitionDigest: `sha256:${digest.repeat(64)}`,
      reproducibility: 'hermetic',
      limitations: ['Synthetic demonstration; no repository extractor was executed.'],
    },
    digest: '0'.repeat(64),
  })
  return [
    {key: 'v1', label: 'v1 · base', document: document(data.before, 'a1', 'a')},
    {key: 'v2', label: 'v2 · first push', document: document(data.after, 'b2', 'a')},
    {key: 'v3', label: 'v3 · latest push', document: document(laterRevision(data.after), 'c3', 'a')},
    {key: 'v3-head', label: 'v3 · head definition', document: document(laterRevision(data.after), 'c3', 'b', definition({scope: 'head'}))},
  ]
}

/** `?width=<px>` sizes the view so its toolbar is that wide, for example to check the toolbar's planned layouts. */
export const toolbarWidth = Number(params.get('width')) || undefined
/** The explorer's padding on each side (`.demo .ph-explorer`). */
export const explorerPadding = 16

/** The explorer's initial state and options that the query parameters set (`?mode`, `?view`, `?loop` and so on). */
export function explorerOptions(): Partial<ComparisonExplorerProps> {
  const mode = (['side-by-side', 'animated', 'swipe', 'diff'] as const).find(value => value === params.get('mode'))
  const view = params.get('view')
  const holds = params.get('holds')
  return {
    ...(mode ? {initialMode: mode} : {}),
    ...(view === 'table' || view === 'text' ? {initialView: view} : {}),
    ...(params.has('connector') ? {initialConnector: params.get('connector') !== 'false'} : {}),
    ...(params.has('loop') ? {initialLoop: params.get('loop') !== 'false'} : {}),
    ...(holds === 'pause' || holds === 'timeline' ? {initialHolds: holds} : {}),
    ...(params.get('fill') === 'false' ? {fill: false} : {}),
  }
}
