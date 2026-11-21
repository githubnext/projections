// The host browser suites' harness (packages/host/core/browser/*.spec.ts): the default UI on synthetic data, configured by query parameters.
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {customComparator, domainSchemas} from '@githubnext/projections-schemas'
import type {DomainSchema, ExtractionDocument, ProjectionEngine} from '@githubnext/projections-schemas'
import {createWasmEngine} from '@githubnext/projections-engine/browser'
import {createRulesRuntime} from '@githubnext/projections-comparator-runtime/browser'
import engineWasm from '@githubnext/projections-engine/engine.wasm?url'
import defaultComparatorWasm from '@githubnext/projections-engine/default-comparator.wasm?url'
import {builtinRendererDocuments, customRenderer, loadRendererCatalog} from '@githubnext/projections-host'
import {ComparisonExplorer, LoadingStatus, ScopedRoot, useColorMode} from '@githubnext/projections-host/ui'
import type {ComparatorSource, ProjectionController, ProjectionSelection, RendererEntry} from '@githubnext/projections-host'
import '@githubnext/projections-host/ui.css'
import {usePageStyles} from '../page-styles.js'
import styles from './explorer.css?inline'
import {annotations, documents, evidenceLink, explorerOptions, explorerPadding, params, toolbarWidth} from './params.js'
import type {RendererChoice} from './params.js'
import {DetailsSlot, TargetsPanel} from './targets.js'
import {TourControls, useTour} from './tour.js'

/** Checks and runs comparator files in the same-origin Worker, as a host does. */
const rules = createRulesRuntime({
  deadlineMs: 10_000,
  workerUrl: new URL('./comparator/worker-entry.js', location.href),
  rulesInterpreterUrl: new URL('./comparator/rules.wasm', location.href),
})

let engine: Promise<ProjectionEngine> | undefined

/** The default UI explorer with the controls and evidence outputs the suites drive and read. */
/**
 * `?caption`: a host's own content in the stage's utility area (`ProjectionViewProps.utility`), two lines of text;
 * `?caption=stateful` adds a text field, whose value and focus show whether the content stays mounted.
 */
const caption = (
  <div className="demo-caption" style={{padding: '6px 12px', lineHeight: '20px'}}>
    <strong style={{display: 'block', fontSize: 14}}>Checkout gains a payments queue</strong>
    <span style={{display: 'block', fontSize: 12, opacity: 0.75}}>A host’s caption over the stage</span>
    {params.get('caption') === 'stateful' ? <input aria-label="Caption note" className="demo-caption-note" /> : null}
  </div>
)

/** `?edgeCaption`: a host's own content on the stage's bottom edge (`ProjectionViewProps.edge`), 52px tall. */
const edgeCaption = (
  <div
    className="demo-edge-caption"
    style={{padding: '6px 16px', lineHeight: '20px', borderRadius: 26, background: 'CanvasText', color: 'Canvas', textAlign: 'center'}}
  >
    <strong style={{display: 'block', fontSize: 14}}>Checkout gains a payments queue</strong>
    <span style={{display: 'block', fontSize: 12, opacity: 0.75}}>A host’s caption on the stage’s edge</span>
  </div>
)

export function HostHarness() {
  usePageStyles(styles)
  const [schema, setSchema] = useState<DomainSchema>(domainSchemas.find(value => value === params.get('schema')) ?? 'graph/v0')
  const presentation = params.get('presentation') ?? undefined
  const [rendererChoice, setRendererChoice] = useState<RendererChoice>(
    (['auto', 'minimal', 'none', 'hostile'] as const).find(value => value === params.get('renderer')) ?? 'auto',
  )
  const [comparator, setComparator] = useState<'default' | 'priority'>(params.get('comparator') === 'priority' ? 'priority' : 'default')
  const [colorMode, setColorMode] = useState<'auto' | 'light' | 'dark'>('auto')
  const loadingColorMode = useColorMode(colorMode)
  const [catalog, setCatalog] = useState<RendererEntry[]>()
  const [ready, setReady] = useState<ProjectionEngine>()
  const [error, setError] = useState('')
  const [opened, setOpened] = useState('')
  const [selection, setSelection] = useState<string | null>(null)
  const [targets, setTargets] = useState<ProjectionSelection | null>(null)
  const [activations, setActivations] = useState<string[]>([])
  const controller = useRef<ProjectionController | null>(null)
  const changeSelection = useCallback((id: string | null, next: ProjectionSelection | null) => {
    setSelection(id)
    setTargets(next)
  }, [])
  const activate = useCallback(({rowId}: {rowId: string}) => setActivations(list => [...list, rowId]), [])
  const renderDetails = useCallback(
    (next: ProjectionSelection, projection: ProjectionController) => <DetailsSlot selection={next} projection={projection} />,
    [],
  )
  // `?controlled` lets the page own progress and playback, as a guided tour would.
  const controlled = params.has('controlled')
  const {tour, setTour, props: tourProps} = useTour()
  useEffect(() => {
    engine ??= createWasmEngine({url: new URL(engineWasm, location.href)}, {url: new URL(defaultComparatorWasm, location.href)})
    Promise.all([engine, loadRendererCatalog({base: new URL('./renderers/', location.href)})])
      .then(([value, renderers]) => {
        setReady(value)
        setCatalog(renderers)
      })
      .catch((failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)))
  }, [])
  const rendererName = rendererChoice === 'minimal' ? 'minimal' : rendererChoice === 'none' ? 'unavailable-renderer' : schema.split('/')[0]!
  const extractions = useMemo(
    () => documents(schema, presentation, comparator, rendererChoice === 'hostile' ? {bundle: 'test-renderers/hostile'} : rendererName),
    [schema, presentation, comparator, rendererChoice, rendererName],
  )
  const loadComparator = useCallback(async (document: ExtractionDocument): Promise<ComparatorSource> => {
    const declared = document.provenance.definition.comparator
    const file = customComparator(declared)?.file
    if (!file) return {kind: 'default'}
    const response = await fetch(new URL(`./${file}`, location.href))
    if (!response.ok) throw new Error(`Comparator file request failed (${response.status})`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    return {kind: 'rules', id: file, bytes, digest: (await rules.check(bytes)).digest}
  }, [])
  const custom = useCallback(
    (): RendererEntry | undefined =>
      rendererChoice !== 'hostile'
        ? undefined
        : customRenderer(
            {format: 'projections.renderer', version: 0, name: 'hostile', title: 'Hostile probe', handles: []},
            `./test-renderers/hostile/index.html?probe=${encodeURIComponent(params.get('probe') ?? 'network')}`,
          ),
    [rendererChoice],
  )
  const renderers = useMemo(() => (rendererChoice === 'hostile' ? [] : (catalog ?? [])), [catalog, rendererChoice])
  // The hostile probe is offered alone, but may still ask for the catalog's documents; asking for itself is refused.
  const rendererDocuments = useMemo(() => {
    const hostile = custom()
    return builtinRendererDocuments([...(catalog ?? []), ...(hostile ? [hostile] : [])])
  }, [catalog, custom])
  return (
    <div className="demo" style={toolbarWidth ? {maxWidth: 'none'} : undefined}>
      <header className="demo-header" id="top">
        <div>
          <h1>Projections host</h1>
          <p>Sandboxed renderers, in-browser comparison and built-in table and text views · synthetic data</p>
        </div>
        <div className="demo-controls">
          <label>
            Domain schema
            <select
              aria-label="Domain schema"
              value={schema}
              onChange={event => {
                const next = domainSchemas.find(value => value === event.target.value)
                if (next) setSchema(next)
              }}
            >
              {domainSchemas.map(value => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label>
            Renderer
            <select
              aria-label="Renderer"
              value={rendererChoice}
              onChange={event => setRendererChoice(event.target.value as RendererChoice)}
            >
              <option value="auto">Built-in for the schema</option>
              <option value="minimal">Minimal outline (example)</option>
              <option value="none">Unavailable renderer</option>
            </select>
          </label>
          <label>
            Comparator
            <select
              aria-label="Comparator"
              value={comparator}
              onChange={event => setComparator(event.target.value === 'priority' ? 'priority' : 'default')}
            >
              <option value="default">Default</option>
              <option value="priority">Priority order (custom Wasm)</option>
            </select>
          </label>
          <label>
            Theme
            <select aria-label="Theme" value={colorMode} onChange={event => setColorMode(event.target.value as typeof colorMode)}>
              <option value="auto">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
        </div>
      </header>
      {controlled && <TourControls tour={tour} setTour={setTour} />}
      {/* A reference consumer of the target hooks; above the view so the page tab order still ends with the renderer frame. */}
      <TargetsPanel targets={targets} activations={activations} controller={controller} />
      {error ? (
        <p role="alert">Could not start the harness: {error}</p>
      ) : !ready || (!catalog && !params.has('lateCatalog')) ? (
        <ScopedRoot colorMode={loadingColorMode} className={params.get('fill') === 'false' ? 'demo-sized' : 'demo-view demo-sized'}>
          <LoadingStatus label="Starting the engine…" fill={params.get('fill') !== 'false'} />
        </ScopedRoot>
      ) : (
        <div
          className={params.get('fill') === 'false' ? 'demo-sized' : 'demo-view demo-sized'}
          style={toolbarWidth ? {width: toolbarWidth + 2 * explorerPadding} : undefined}
        >
          <ComparisonExplorer
            key={`${schema}-${comparator}-${rendererChoice}`}
            extractions={extractions}
            engine={ready}
            initialBefore={params.has('single') ? '' : (params.get('before') ?? 'v1')}
            initialAfter={params.get('after') ?? 'v2'}
            loadComparator={loadComparator}
            rules={rules}
            renderers={renderers}
            rendererDocuments={rendererDocuments}
            customRenderer={custom}
            colorMode={colorMode}
            {...explorerOptions()}
            {...(params.has('caption') ? {utility: caption} : {})}
            {...(params.has('edgeCaption') ? {edge: edgeCaption} : {})}
            onOpen={(path, line) => setOpened(`${path}${line ? `:${line}` : ''}`)}
            {...(params.get('details') === 'none' ? {details: 'none' as const} : {})}
            {...(params.has('evidenceLinks') ? {evidenceLink} : {})}
            onSelectionChange={changeSelection}
            controllerRef={controller}
            renderDetails={renderDetails}
            onAnnotationActivate={activate}
            {...(annotations ? {annotations} : {})}
            {...(controlled ? tourProps : {})}
          />
        </div>
      )}
      <p className="demo-evidence" role="status">
        Host selection: <output aria-label="Host selection">{selection ?? 'None'}</output>
        {' · '}Open request: <output aria-label="Open request">{opened || 'None'}</output>
      </p>
      <p className="demo-evidence">
        <a href="#top">Back to top</a>
      </p>
    </div>
  )
}
