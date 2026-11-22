import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {customComparator, type ExtractionDocument, type ProjectionEngine} from '@githubnext/projections-schemas'
import {ComparisonError, computeComparison, type ComparatorSource, type ComputedComparison, type RulesRuntime} from './compare.js'
import {
  builtinRendererDocuments,
  compatibleRenderers,
  resolveRenderer,
  type RendererDocuments,
  type RendererEntry,
  type RendererResolution,
  type WithheldRenderer,
} from './registry.js'
import type {ViewSubject} from './model.js'
import type {PresentationDefaults} from './projection.js'

/** One extraction the user can choose, for example a revision or a push. */
export interface ExtractionChoice {
  /** Stable key, for example a commit SHA or `working-tree`. */
  key: string
  /** Label shown in the pair picker, for example `main · "Add auth" · 2 days ago` (`formatRevisionLabel`); pickers and pane chips read its parts back (`parseRevisionLabel`). */
  label: string
  document: ExtractionDocument
}

/** The options of `useComparisonPair`: the extractions to pair, the engine, the comparators and the renderers. */
export interface ComparisonPairOptions {
  /** Extractions of one projection, typically one per revision, oldest first. */
  extractions: readonly ExtractionChoice[]
  engine: ProjectionEngine
  /** Supplies the comparator file a definition declares. Called only for custom comparators. */
  loadComparator?: (document: ExtractionDocument, signal: AbortSignal) => Promise<ComparatorSource>
  /** Checks and runs custom comparators (comparator files) in a sandbox. */
  rules?: RulesRuntime
  /** Built-in renderer bundles. */
  renderers: readonly RendererEntry[]
  /**
   * Built-in renderer documents for renderers that nest them (`document-request`). Defaults to the built-in entries of
   * `renderers`; a host that offers fewer bundles than it has passes its whole catalog's.
   */
  rendererDocuments?: RendererDocuments
  /**
   * Supplies a custom renderer bundle for a definition that declares one, or
   * says why it is withheld. Without a bundle the built-in renderer for the
   * extraction's schema, or the table and text views, is shown with a notice.
   */
  customRenderer?: (document: ExtractionDocument) => RendererEntry | WithheldRenderer | undefined
  /** Initially selected keys. `before` may be omitted (or empty) to show one extraction. */
  initialBefore?: string | undefined
  initialAfter?: string | undefined
  /**
   * Controlled keys, for example to show the pair a deep link names. Pass
   * them with `onBeforeChange`/`onAfterChange`; an empty `before` shows one
   * extraction.
   */
  before?: string | undefined
  after?: string | undefined
  onBeforeChange?: (key: string) => void
  onAfterChange?: (key: string) => void
  /** Called with each successfully computed comparison, or `undefined` when showing one extraction. */
  onComparison?: (result: (ComputedComparison & {before: ExtractionDocument; after: ExtractionDocument}) | undefined) => void
}

/**
 * Where the chosen pair stands: one extraction presented alone (`single`), its comparison being computed, the
 * comparison computed, or the error it `failed` with (a `ComparisonError` for a comparison the host can't make).
 */
export type PairOutcome =
  | {status: 'single'; document: ExtractionDocument}
  | {status: 'computing'}
  | {status: 'compared'; before: ExtractionDocument; after: ExtractionDocument; result: ComputedComparison}
  | {status: 'failed'; error: ComparisonError | Error}

/** What `useComparisonPair` returns: the chosen pair, its outcome and subject, and the actions that change them. */
export interface ComparisonPair {
  extractions: readonly ExtractionChoice[]
  before: ExtractionChoice | undefined
  after: ExtractionChoice | undefined
  /** Whether two different extractions are chosen. */
  comparing: boolean
  outcome: PairOutcome
  /**
   * What to present: the comparison, or the one extraction. While another
   * pair is computing, the previous subject stays, so its renderer frames
   * stay loaded and receive the new documents instead of reloading.
   */
  subject: ViewSubject | undefined
  /** Labels of the extractions `subject` presents. */
  subjectLabels: {before?: string; after?: string}
  /** The extraction document whose projection and definition apply. */
  document: ExtractionDocument | undefined
  /** The comparator that produced the comparison. */
  comparator: {id: string; digest: string} | undefined
  /** The renderer to use, or why none (or another) is used. */
  resolution: RendererResolution
  /** The resolved renderer first, then every other bundle that can present this projection. */
  renderers: readonly RendererEntry[]
  /** The built-in renderers' documents, from every bundle of `ComparisonPairOptions.renderers`, for renderers that nest them. */
  rendererDocuments: RendererDocuments
  /** Definition defaults for host and renderer settings (`definition.presentation`). */
  presentation: PresentationDefaults | undefined
  /** Chooses the base; an empty key shows one extraction. */
  setBefore(key: string): void
  setAfter(key: string): void
  swap(): void
  retry(): void
}

function failure(error: unknown): ComparisonError | Error {
  return error instanceof Error ? error : new Error(String(error))
}

/**
 * Headless pair picker: chooses any two extractions of one projection and
 * computes their comparison in the browser with the projection's comparator.
 * Choosing no base presents one extraction. Failures are reported in
 * `outcome`, never replaced by another comparison.
 */
export function useComparisonPair(options: ComparisonPairOptions): ComparisonPair {
  const {extractions, engine, renderers, customRenderer} = options
  // Callbacks are read at call time so that new function identities don't recompute the comparison.
  const callbacks = useRef(options)
  callbacks.current = options
  const last = extractions.at(-1)?.key ?? ''
  const [afterState, setAfterState] = useState(options.initialAfter ?? last)
  const [beforeState, setBeforeState] = useState(options.initialBefore ?? (extractions.length > 1 ? extractions.at(-2)!.key : ''))
  const afterKey = options.after ?? afterState
  const beforeKey = options.before ?? beforeState
  const setAfterKey = useCallback((key: string) => {
    if (callbacks.current.after === undefined) setAfterState(key)
    callbacks.current.onAfterChange?.(key)
  }, [])
  const setBeforeKey = useCallback((key: string) => {
    if (callbacks.current.before === undefined) setBeforeState(key)
    callbacks.current.onBeforeChange?.(key)
  }, [])
  const before = extractions.find(item => item.key === beforeKey)
  const after = extractions.find(item => item.key === afterKey) ?? extractions.at(-1)
  const [outcome, setOutcome] = useState<PairOutcome>({status: 'computing'})
  const [attempt, setAttempt] = useState(0)
  // The comparison depends on the documents alone: a choice relabelled (a new object with the same document, for
  // example as a host names its revisions again) keeps the comparison and the subject, so playback isn't reset
  // and the view isn't presented again.
  const beforeDocument = before && after && before.key !== after.key ? before.document : undefined
  const afterDocument = after?.document
  useEffect(() => {
    if (!afterDocument) return
    if (!beforeDocument) {
      setOutcome({status: 'single', document: afterDocument})
      callbacks.current.onComparison?.(undefined)
      return
    }
    const abort = new AbortController()
    setOutcome({status: 'computing'})
    const run = async () => {
      const declared = afterDocument.provenance.definition.comparator
      let comparator: ComparatorSource = {kind: 'default'}
      const custom = customComparator(declared)?.file
      // Only a comparable pair needs its comparator; computeComparison reports any other.
      if (custom && (await engine.pair(beforeDocument, afterDocument)).pairing === 'same') {
        const {loadComparator} = callbacks.current
        if (!loadComparator) throw new ComparisonError('comparator-unavailable', `The comparator ${custom} is not available here.`)
        comparator = await loadComparator(afterDocument, abort.signal)
      }
      const {rules} = callbacks.current
      const result = await computeComparison({
        engine,
        before: beforeDocument,
        after: afterDocument,
        comparator,
        ...(rules ? {rules} : {}),
      })
      if (abort.signal.aborted) return
      setOutcome({status: 'compared', before: beforeDocument, after: afterDocument, result})
      callbacks.current.onComparison?.({...result, before: beforeDocument, after: afterDocument})
    }
    run().catch((error: unknown) => {
      if (abort.signal.aborted) return
      setOutcome({status: 'failed', error: failure(error)})
      callbacks.current.onComparison?.(undefined)
    })
    return () => abort.abort()
  }, [beforeDocument, afterDocument, engine, attempt])

  const document = after?.document
  const resolution = useMemo<RendererResolution>(
    () => (document ? resolveRenderer(document.projection.renderer, renderers, customRenderer?.(document), document.extraction) : {}),
    [document, renderers, customRenderer],
  )
  const supplied = options.rendererDocuments
  const rendererDocuments = useMemo(() => supplied ?? builtinRendererDocuments(renderers), [supplied, renderers])
  const compatible = useMemo(
    () => (document ? compatibleRenderers(document, renderers, resolution.renderer) : []),
    [document, renderers, resolution.renderer],
  )
  const settled = useMemo<ViewSubject | undefined>(
    () =>
      outcome.status === 'single'
        ? {mode: 'extraction', extraction: outcome.document.extraction}
        : outcome.status === 'compared'
          ? {mode: 'comparison', before: outcome.before.extraction, after: outcome.after.extraction, comparison: outcome.result.comparison}
          : undefined,
    [outcome],
  )
  const [shown, setShown] = useState<{outcome: PairOutcome; subject: ViewSubject | undefined; labels: {before?: string; after?: string}}>()
  if (shown?.outcome !== outcome && outcome.status !== 'computing') {
    setShown({
      outcome,
      subject: settled,
      labels: {...(before && outcome.status === 'compared' ? {before: before.label} : {}), ...(after ? {after: after.label} : {})},
    })
  }
  const subject = outcome.status === 'computing' ? shown?.subject : settled
  const subjectLabels = (outcome.status === 'computing' ? shown?.labels : undefined) ?? {
    ...(before && outcome.status === 'compared' ? {before: before.label} : {}),
    ...(after ? {after: after.label} : {}),
  }
  return {
    extractions,
    before,
    after,
    comparing: Boolean(before && after && before.key !== after.key),
    outcome,
    subject,
    subjectLabels,
    document,
    comparator: outcome.status === 'compared' ? outcome.result.comparator : undefined,
    resolution,
    renderers: compatible,
    rendererDocuments,
    presentation: document?.provenance.definition.presentation,
    setBefore: setBeforeKey,
    setAfter: setAfterKey,
    swap: () => {
      if (!before || !after) return
      setBeforeKey(after.key)
      setAfterKey(before.key)
    },
    retry: () => setAttempt(value => value + 1),
  }
}
