// The kit's renderer shell: what a renderer component receives (`RendererProps`), the hooks its components reach the
// shell through, and `mountRenderer`, which connects it to its host.

import type {DomainSchema, Extraction, ExtractionOf} from '@githubnext/projections-schemas'
import type {
  AcceptedExtraction,
  RendererAccepts,
  ColorMode,
  ComparisonMode,
  ControlValue,
  InitPayload,
  RendererCapabilities,
  RendererFocus,
  RendererControl,
  RendererEnvironment,
  RendererLegend,
  RendererOptions,
} from '@githubnext/projections-renderer-sdk/protocol'
import type {SummaryNouns} from '@githubnext/projections-renderer-sdk/presentation'
import type {SummaryFacts} from '../../summary.js'
import type {EmphasisOf} from '../../emphasis.js'
import type {ComparisonModel} from '../../model.js'
import type {ChangesScope} from '../../scope.js'
import type {ScheduledStep} from '../../timeline.js'

/**
 * The extraction type a renderer receives: `RendererProps<'database/v0'>` types a renderer of one domain
 * schema, `RendererProps<typeof accepts>` one that accepts several or a vocabulary, and `RendererProps` one
 * of any extraction.
 */
export type RendererExtraction<T extends DomainSchema | readonly RendererAccepts[] | undefined> = T extends DomainSchema
  ? ExtractionOf<T>
  : T extends readonly RendererAccepts[]
    ? AcceptedExtraction<T>
    : Extraction

/** Everything a kit renderer component receives for one host state. */
export interface RendererProps<T extends DomainSchema | readonly RendererAccepts[] | undefined = undefined> {
  /** The host's `init` message as received: the extraction, or both revisions and their comparison. */
  init: InitPayload<RendererExtraction<T>>
  /** `init` resolved for presentation (see `createModel`): rows keyed by identity, built once per document. */
  model: ComparisonModel<RendererExtraction<T>>
  /** Whether this is a comparison (`init.mode === 'comparison'`). */
  comparing: boolean
  /**
   * Whether the host presents this comparison in `diff` mode: one static
   * frame showing both subjects, with no progress (`progress` stays 1 and
   * `schedule` is empty). Draw the renderer's own static comparison;
   * `highlighting` is the host's change emphasis for it (1 unless the host
   * turned highlighting off).
   */
  diff: boolean
  /** The comparison mode the host announced in `init`, if any. */
  comparisonMode: ComparisonMode | undefined
  /**
   * Set while this frame is one held pane of side by side or swipe (`RendererEnvironment.pane`): it shows only that
   * revision, which the host labels, so leave out narration of the transition such as step captions.
   */
  pane: 'before' | 'after' | undefined
  /**
   * Where the host wants the opening view (`InitPayload.focus`), or a comparison's changes while the host shows
   * changes only; undefined for the renderer's own choice. The shell scrolls the first focused item of a list into
   * view itself; a renderer that places its own view (`useStageZoom`) frames what it names.
   */
  focusRequest: RendererFocus | undefined
  /**
   * The Changes scope, while the host shows a comparison's changes and their context (`changesScope`): its `shown`
   * items at full strength, the rest folded (lists: `useFolds`, `Fold`) or receded (canvases, which keep their layout
   * and frame what is shown). Undefined while every item is shown. The shell already marks items outside it filtered.
   */
  scope: ChangesScope | undefined
  /** 0 (before) to 1 (after); always 1 for an extraction. */
  progress: number
  /**
   * Host-chosen change emphasis, exactly 0 at both endpoints and for
   * extractions. Use `emphasis(row)` for a change's own emphasis: it is scoped
   * to the change's step.
   */
  highlighting: number
  /**
   * A change's emphasis now: 0 until its comparison step begins, then the
   * host's highlighting; in a held pane, the host's highlighting (see
   * `stepEmphasis`). Pass the row ID as the second argument when the object
   * passed has none.
   */
  emphasis: EmphasisOf
  /**
   * The host's playback direction (`ProgressPayload.direction`): 1 toward After, -1 back toward Before. Always 1 for
   * an extraction and in diff mode. `schedule` is already ordered for the direction the transition presents.
   */
  direction: 1 | -1
  /**
   * The comparison's steps on the progress axis for the direction this
   * transition presents (see `DirectionLatch`). Empty for extractions.
   */
  schedule: ScheduledStep[]
  /** Definition renderer name the host matched, for example `graph-horizontal`. */
  rendererName: string
  /** The selected item's ID (an entity row ID, or a part's `data-entity-id`), or `null` when nothing is selected. */
  selectedId: string | null
  /**
   * The entity the host says is hovered, in this frame or another pane, or
   * `null`. The shell already marks its elements with
   * `data-projections-hovered`; use this only for richer hover presentation.
   */
  hoveredId: string | null
  /**
   * Selects an item, as the person activating it: activating the selected item again clears the selection, as an
   * `aria-pressed` toggle does, and `null` clears it. The shell also clears the selection when the person clicks the
   * renderer's background, and toggles an item when they click its element anywhere outside a control.
   */
  onSelect: (id: string | null) => void
  /** Ask the host to navigate to source evidence; the host decides. */
  onOpen: (path: string, line?: number) => void
  /**
   * Report step boundaries where a host may hold, for renderers with their own timing, and optionally how many step
   * slots the presentation spans (`timelineSlots`).
   */
  reportSteps: (ends: readonly number[], slots?: number) => void
  /**
   * The value of every declared control (from `MountOptions.controls` or
   * `declareControls`), defaults filled in. The host draws the controls and
   * sends their values; renderers draw no settings controls of their own.
   */
  controls: {[id: string]: ControlValue}
  /**
   * Replaces the declared controls, for controls that depend on the document
   * (for example a filter listing its kinds). Repeated identical declarations
   * are ignored.
   */
  declareControls: (controls: readonly RendererControl[]) => void
  /** Subscribes to the host's `action` messages for declared action controls; returns an unsubscribe function. */
  onAction: (listener: (id: string) => void) => () => void
  /**
   * Reports the legend the host draws once beside every pane (an empty one
   * clears it). Renderers draw no legend of their own; repeated identical
   * legends are ignored.
   */
  reportLegend: (legend: RendererLegend) => void
  /**
   * Names the document's kinds in the host's summary bar, replacing `MountOptions.nouns` (see `useSummaryNouns`). The
   * shell counts every kind and posts the summary itself; without nouns, the host words kinds from their names.
   */
  declareNouns: (nouns: SummaryNouns | undefined) => void
  /** The host's latest `options`, such as `showRelationships`; empty until it sends any. */
  options: RendererOptions
  /** The frame's width and the host window's height, CSS px, as the host last reported them; undefined until then. */
  viewport: {width: number; height: number} | undefined
  /** Whether the person prefers reduced motion: present each frame without decorative movement. */
  reducedMotion: boolean
  /** BCP 47 locale for formatting numbers and dates, for example `en-US`. */
  locale: string
  /** The host theme's color mode, for colors a renderer computes itself (see `categoryPalette`). */
  colorMode: ColorMode
  /** The host's current theme, motion preference, locale and pane: `init`'s, or a later `environment`'s. */
  environment: RendererEnvironment
  /**
   * Asks the host for a built-in renderer's document, to run nested (`embedRenderer`); rejects with the host's reason
   * when it supplies none (see `RendererClient.requestDocument`).
   */
  requestDocument: (name: string) => Promise<string>
}

/** How `mountRenderer` connects a renderer component to its host. */
export interface MountOptions {
  /** Bundle name, used for `data-renderer` on the root element. */
  name: string
  /**
   * What the renderer supports, declared to the host in `ready` (see `RendererCapabilities`); the shell adds the
   * interaction capabilities unless `interactions` is `false`.
   */
  capabilities: RendererCapabilities
  /**
   * The extractions the renderer presents, the same list its `vite.config.ts` passes to `rendererConfig`.
   * An extraction outside it shows a failure naming what the renderer accepts. Omit it to accept any.
   */
  accepts?: readonly RendererAccepts[]
  /**
   * `schedule` (default) reports the end of each scheduled step to the host;
   * `manual` leaves it to the component through `reportSteps`.
   */
  steps?: 'schedule' | 'manual'
  /** Controls the host draws for this renderer, declared in `ready` (see `declareControls` for document-dependent ones). */
  controls?: readonly RendererControl[]
  /**
   * The renderer's words for extraction kinds in the host's summary bar (`SummaryNouns`), for every document; see
   * `declareNouns` for words that depend on the document.
   */
  nouns?: SummaryNouns
  /**
   * The renderer's domain facts for the host's summary bar (`SummaryFacts`), computed from the document and the
   * control values whenever either changes, and posted after the kind counts. A renderer draws no summary line of its
   * own: what it would count goes here.
   */
  facts?: SummaryFacts
  /**
   * Hover, anchors, scroll mirroring, the host's filter and annotation badges through `connectInteractions` over
   * elements carrying `data-entity-id` (default on). `false` opts out and
   * declares none of the interaction capabilities.
   */
  interactions?: false
}

/**
 * What a view module may export as `options` beside its `View`, for the entry `rendererConfig({view})` generates: the
 * mount options other than the name, capabilities and accepted extractions, which `rendererConfig` declares.
 *
 * ```tsx
 * export const options: ViewOptions = {nouns: {service: {singular: 'service', plural: 'services'}}}
 * ```
 */
export type ViewOptions = Omit<MountOptions, 'name' | 'capabilities' | 'accepts'>
