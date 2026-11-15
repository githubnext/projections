/**
 * Minimal Projections renderer: a dependency-free outline of an extraction or
 * a step-by-step list of a comparison. Copy this package to start a renderer.
 *
 * Lifecycle:
 * 1. `connectRenderer` reads the channel from the frame URL and posts `ready`.
 * 2. The host sends `init` (the documents) — build the DOM once.
 * 3. The host sends `progress` and `select` — update attributes cheaply,
 *    then acknowledge each painted progress with `rendered`.
 */
import './styles.css'
import {afterPaint, applyEnvironment, connectRenderer, RendererConnectionError} from '@githubnext/projections/renderer'
import type {RendererClient} from '@githubnext/projections/renderer'
import type {InitPayload, ProgressPayload} from '@githubnext/projections/renderer'
import type {Change, Comparison, Extraction} from '@githubnext/projections/schemas'

const extractionProgress: ProgressPayload = {progress: 1, highlighting: 0, direction: 1}

let init: InitPayload | undefined
let progress: ProgressPayload = extractionProgress
let selection: string | null = null
let main: HTMLElement | undefined
let cancelAcknowledgement: (() => void) | undefined

const container = document.getElementById('root') ?? document.body

/** Creates an element. Always set untrusted document text with `textContent`, never as HTML. */
function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: {className?: string; text?: string; role?: string; data?: Record<string, string>} = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (options.className) node.className = options.className
  if (options.role) node.setAttribute('role', options.role)
  if (options.text !== undefined) node.textContent = options.text
  for (const [key, value] of Object.entries(options.data ?? {})) node.dataset[key] = value
  node.append(...children)
  return node
}

/** A selectable item: the host's browser tests and selection rely on `data-entity-id`. */
function selectable(id: string, label: string, details: (Node | string)[], data: Record<string, string> = {}): HTMLLIElement {
  return element(
    'li',
    {className: 'item', data: {entityId: id, ...data}},
    element('button', {className: 'item-label', text: label}),
    ...details,
  )
}

/** The entities, then the relationships between them, each a selectable item. */
function outline(extraction: Extraction): Node[] {
  const labels = new Map(extraction.entities.map(entity => [entity.id, entity.label || entity.id]))
  return [
    element(
      'ul',
      {className: 'outline', data: {projectionsContent: ''}},
      ...extraction.entities.map(entity =>
        selectable(entity.id, entity.label || entity.id, [element('span', {className: 'kind', text: entity.kind})]),
      ),
      ...extraction.relationships.map(link =>
        selectable(link.id, `${labels.get(link.from) ?? link.from} → ${labels.get(link.to) ?? link.to}`, [
          element('span', {className: 'kind', text: link.kind}),
        ]),
      ),
    ),
  ]
}

function describe(change: Change): string {
  const before = change.before.join(', ') || '—'
  const after = change.after.join(', ') || '—'
  return change.before.length && change.after.length && before === after ? before : `${before} → ${after}`
}

function steps(comparison: Comparison): Node[] {
  const changes = new Map(comparison.changes.map(change => [change.id, change]))
  const count = comparison.steps.length
  return [
    element(
      'ol',
      {className: 'steps', data: {projectionsContent: ''}},
      ...comparison.steps.map((step, index) =>
        element(
          'li',
          {
            className: 'step',
            // Step i of n is reached halfway through its slot, at (i + 0.5) / n, so the holds the host
            // may make at each slot's end, (i + 1) / n, always show a settled frame.
            data: {step: String(index), stepEnd: String((index + 1) / count), reachedAt: String((index + 0.5) / count), reached: 'false'},
          },
          element('h2', {className: 'step-title', text: step.summary ?? `Step ${index + 1}${step.kind ? ` · ${step.kind}` : ''}`}),
          element(
            'ul',
            {className: 'changes'},
            ...step.changes.flatMap(id => {
              const change = changes.get(id)
              if (!change) return []
              return [
                selectable(
                  change.id,
                  change.id,
                  [
                    element('span', {className: 'status', text: change.status}),
                    element('code', {className: 'ids', text: describe(change)}),
                    ...(change.summary ? [element('span', {className: 'change-summary', text: change.summary})] : []),
                  ],
                  {status: change.status},
                ),
              ]
            }),
          ),
        ),
      ),
    ),
  ]
}

/**
 * Builds the document structure once per `init`. No header: the host shows the projection's title, schema and counts,
 * so the content starts at the top of the frame (marked `data-projections-content`).
 */
function build(payload: InitPayload) {
  main = element(
    'main',
    {data: {renderer: 'minimal', mode: payload.mode}},
    ...(payload.mode === 'comparison' ? steps(payload.comparison) : outline(payload.extraction)),
  )
  container.replaceChildren(main)
}

/** Applies progress, highlighting and selection to the existing DOM, then acknowledges the paint. */
function update(client: RendererClient) {
  if (!init || !main) return
  const comparing = init.mode === 'comparison'
  const value = comparing ? progress.progress : 1
  const highlighting = comparing ? Math.max(0, Math.min(1, progress.highlighting)) : 0
  main.dataset.progress = String(value)
  main.dataset.highlighting = String(highlighting)
  // Changed items scale their emphasis by this; at 0 (both endpoints) nothing is decorated.
  main.style.setProperty('--highlighting', String(highlighting))
  for (const step of main.querySelectorAll<HTMLElement>('[data-step-end]')) {
    step.dataset.reached = String(value >= Number(step.dataset.reachedAt) - 1e-9)
  }
  for (const item of main.querySelectorAll<HTMLElement>('[data-entity-id]')) {
    const selected = item.dataset.entityId === selection
    item.classList.toggle('selected', selected)
    const button = item.querySelector('button')
    if (selected) button?.setAttribute('aria-current', 'true')
    else button?.removeAttribute('aria-current')
  }
  cancelAcknowledgement?.()
  cancelAcknowledgement = afterPaint(() => client.rendered(value))
}

function start(): RendererClient {
  const client: RendererClient = connectRenderer(
    {
      init(payload) {
        init = payload
        applyEnvironment(payload)
        if (payload.mode === 'extraction') progress = extractionProgress
        try {
          build(payload)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          container.replaceChildren(element('p', {className: 'error', role: 'alert', text: message}))
          main = undefined
          client.error(message)
          return
        }
        if (payload.mode === 'comparison') {
          const count = payload.comparison.steps.length
          client.steps(payload.comparison.steps.map((_, index) => (index + 1) / count))
        }
        update(client)
      },
      progress(payload) {
        progress = payload
        update(client)
      },
      select({id}) {
        selection = id
        update(client)
      },
      environment: applyEnvironment,
    },
    {capabilities: {changeHighlighting: 'supported'}},
  )

  // Clicking an item selects it, and clicking the selected item again clears the selection, as a toggle does (the second
  // click of a double-click keeps it). A click anywhere else, on the background, clears it too.
  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null
    const id = target?.closest<HTMLElement>('[data-entity-id]')?.dataset.entityId ?? null
    if (id === null && target?.closest('button, a[href], input, select, textarea')) return
    if (id !== null && id === selection && event.detail > 1) return
    const next = id === selection ? null : id
    if (next === selection) return
    selection = next
    client.select(selection)
    update(client)
  })
  client.observeHeight(document.body)
  return client
}

container.replaceChildren(element('p', {className: 'waiting', role: 'status', text: 'Waiting for the host…'}))
try {
  start()
} catch (error) {
  if (!(error instanceof RendererConnectionError)) throw error
  container.replaceChildren(element('p', {className: 'error', role: 'alert', text: error.message}))
}
