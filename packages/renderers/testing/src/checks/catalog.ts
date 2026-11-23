// The built-in checks, their titles and descriptions, and the driver they run through.
import type {Comparison, Extraction} from '@githubnext/projections-schemas'
import {openingFloorPx} from '@githubnext/projections-renderer-sdk/presentation'
import type {ComparisonMode, RendererOptions} from '@githubnext/projections-renderer-sdk/protocol'
import type {CheckId, CheckResult, ProbeCall, StageHighlighting, StageSeek, StageState, StageSubject} from '../types.js'

/**
 * How `runChecks` presents and measures a renderer: the stage's operations, so the same checks run in the Inspector's
 * fixtures mode and in Playwright. `load` and `seek` resolve once the renderer has painted.
 */
export interface CheckDriver {
  /** Presents a subject with the scenario's renderer and resolves once it has painted `progress`. */
  /** Presents a subject; `comparisonMode: 'diff'` presents a comparison as one static diff, without progress. */
  load: (
    subject: StageSubject,
    options: {
      progress: number
      width?: number
      /** A fixed frame height, as a host that sizes its frames gives one; by default the frame follows the renderer. */
      height?: number
      highlighting?: StageHighlighting
      comparisonMode?: ComparisonMode
      /** The host's color mode; light unless a check asks for dark. */
      colorMode?: 'light' | 'dark'
      /** Present in the open frame when it can (see `StageLoad.reuse`). */
      reuse?: boolean
    },
  ) => Promise<StageState>
  seek: (progress: number, options?: StageSeek) => Promise<StageState>
  select: (id: string | null) => void | Promise<void>
  hover: (id: string | null) => void | Promise<void>
  state: () => StageState | Promise<StageState>
  measure: <T = unknown>(call: ProbeCall, args?: unknown) => Promise<T>
  /** The default comparison with no options. */
  compare: (before: Extraction, after: Extraction) => Promise<Comparison>
  sleep: (ms: number) => Promise<void>
}

/** The options of `runChecks`: which checks to run, their limits, and a callback for each result as it arrives. */
export interface CheckOptions {
  /** Which checks to run; all by default. */
  checks?: readonly CheckId[]
  /** Most entities hovered and selected by the affordance check. */
  maxEntities?: number
  /** Width of the phone viewport, in CSS pixels. */
  phoneWidth?: number
  /**
   * The renderer options the driver presents the subject with (a definition's `presentation.rendererOptions`), for
   * checks that depend on what they ask the renderer to draw: a `relationships` option naming one relationship kind
   * (the built-in graph renderers' **Relationships**), or `showRelationships: false`, limits which relationships the
   * relationships check expects.
   */
  rendererOptions?: RendererOptions
  /** Called as each check finishes. */
  onResult?: (result: CheckResult) => void
}

/** Each built-in check's short title, as the Inspector and test reports name it. */
export const checkTitles: Record<CheckId, string> = {
  'neutral-endpoints': 'Neutral endpoints',
  'step-holds': 'No motion inside step holds',
  'highlight-scope': 'Per-step highlighting scope',
  'diff-changes': 'Every change shown in diff mode',
  'diff-neutral': 'Unchanged items neutral in diff mode',
  'diff-clipping': 'Nothing clipped in diff mode',
  affordances: 'Affordances inside their unit',
  rings: "Rings on the item's own edge",
  legend: 'Legend drawn by the host',
  summary: 'Summary counts and facts match the documents',
  'phone-overflow': 'No horizontal overflow at phone width',
  selection: 'Selection round trip',
  identifiers: 'Identifiers in a monospace font',
  'stable-layout': 'No layout shift from change status',
  'status-text': 'Change status as text',
  'quiet-endpoints': 'No status text at the endpoints',
  'content-top': 'Content starts at the top of the frame',
  'stage-insets': 'Cards inset equally on all four sides',
  'opens-fitted': 'Opens fitted, or at the readable text floor',
  relationships: 'Relationships drawn',
  palette: 'Colors from the theme',
  'stage-surface': 'Content on the stage surface',
  'type-scale': 'Text on the type scale',
  spacing: 'Spacing, radii and borders on the scale',
  'nested-accents': 'No change colors inside change colors',
  'frame-edges': 'Rounded edges drawn over what fills their corners',
  'label-centring': 'Labels centred on their capitals',
  'centred-pixels': 'Centred on whole pixels',
  'link-routes': 'Links routed around cards',
}

/** Each built-in check's contract: what a renderer must do to pass it, in a sentence or two. */
export const checkDescriptions: Record<CheckId, string> = {
  'neutral-endpoints':
    'At progress 0 and 1 every entity is painted exactly as in an unchanged comparison of that revision: no change emphasis, status colors or badges. Categorical colours (`data-projections-category`) may be ranked over both revisions, but each category keeps one colour from Before to After.',
  'step-holds': 'Around every hold the renderer reports, and while progress stays at it, nothing moves, fades or repaints.',
  'highlight-scope':
    'After each step, only entities that step or an earlier one changed are emphasized; no step pre-tints later changes, and items that varied only within tolerance are never emphasized.',
  'diff-changes':
    'In diff mode every changed entity is drawn, and drawn differently from how an unchanged comparison of its revision draws it.',
  'diff-neutral':
    'In diff mode, entities no change touches, including those that varied only within tolerance, are painted exactly as in an unchanged comparison of the after revision.',
  'diff-clipping':
    'In diff mode, at full and phone width, no element cuts off its own content (overflow hidden or clip with more content than fits).',
  affordances:
    'Hover, selection and keyboard focus draw inside their unit; nested parts are tinted, never outlined; an SVG element never takes an outline, and keyboard focus always changes what is painted.',
  rings:
    "Hover, selection and keyboard focus ring each unit as styling on its own element (an outline inside an HTML unit, the stroke of an SVG unit's data-projections-edge shape), and the unit owns the item's visible edge: no wrapper around it, no edge outside its box, no positioned descendant over its ring, no second edge, no ring of the renderer's own. Each failure names the fix. Checked in the default mode and the diff.",
  legend:
    'The renderer draws no legend in its frame; the legend it sends the host describes the whole document, so it is the same at every progress.',
  summary:
    "When the renderer sends a summary for the host's summary bar, each count figure's count (and, in a comparison, its added, removed and modified counts) is the documents' own for its kind: the extraction's items, or the after revision's and the comparison's changes. A fact figure's count is the renderer's, but every item ID it filters to exists, one extraction's facts have no changes, and what a fact counts as added or modified is part of its count. The summary describes the whole document, so it is the same at every progress.",
  'phone-overflow': 'At phone width the renderer document never scrolls sideways.',
  selection:
    "Clicking an entity reports it to the host; clicking it again, or the renderer's background, clears the selection; and the host's selection (and clearing it) is shown.",
  'stable-layout':
    'Change status appears in reserved space: at every sampled progress, and in the diff, each entity has the same box with highlighting on and off.',
  'status-text':
    'While a change is emphasized, its entity states its status as text (Added, Removed, Modified, Renamed or Moved), visibly or for assistive technology, never by color alone.',
  'quiet-endpoints': "At both endpoints, with the host's default highlighting, no entity shows status text.",
  'content-top':
    "The renderer draws no header of its own (the host shows the title, schema and counts): its first entity, canvas or marked content region (data-projections-content) starts within the stage padding of the frame top (the host's stage-inset, else 12 px, or its stage-inset-top where that is more), at full and phone width. A zoomable canvas (a scroll container marked data-zoom) counts as a whole, since it opens fitted (or at the text floor) and centres what it draws.",
  'stage-insets':
    "The cards, panels and tables a renderer stands on its stage sit evenly in the frame: the space between their union and the frame's top, left and right, and the end of the content (where a host that sizes the frame to the content ends it), is the same, within 1 px, at full and phone width, except that where the host overlays the frame's top (stage-inset-top) the top is the larger of that and the other sides' inset. Pad the content root by the stage padding on all four sides (the kit's ContentView or class pk-stage: the host's stage-inset, else 12 px) and give the outer cards no margins. Skipped for a renderer that centres a fitted drawing (a zoomable canvas, data-zoom, or a kit renderer that fills its frame) and for one that stands no cards on its stage.",
  'opens-fitted':
    `A renderer whose canvas zooms (a scroll container marked data-zoom) opens fitted in a frame of fixed size, as a tab or pane shows it: at full and phone width, in the diff and a progress mode when it declares them and for one revision, every entity it draws lies inside the visible canvas at zoom 1, so nothing needs scrolling to be seen. When fitting would draw its smallest text below ${openingFloorPx}px, it opens at that floor instead: zoomed until the smallest text is ${openingFloorPx}px, never further, with the start of its content (the top row's leftmost entity) in view and no entity cut off at the visible canvas's left or top edge. ` +
    `A diff may open on its changes (marked data-change) instead: one at least in view, zoomed past the floor only when every change is wholly in view. Opening text below ${openingFloorPx}px fails unless all of the content fits; the smallest text is reported. Document-style renderers (lists, tables, text), with no zoomable canvas, scroll naturally and are skipped.`,
  relationships:
    'When the extraction has relationships the presentation draws between entities the renderer draws, it draws at least one of them, marked with its ID in data-entity-id, unless it declares drawsRelationships: false because it deliberately draws none. A presentation that asks for one relationship kind (the renderer option relationships) expects only that kind; one with showRelationships: false expects none.',
  identifiers:
    'Code identifiers and symbols the renderer marks with data-projections-identifier (names, paths, routes, event names, IDs) compute a monospace font; human-language labels stay sans.',
  palette:
    "Every painted color (text, backgrounds, borders, outlines, shadows, SVG fills and strokes) is a theme color token in both light and dark mode: the token itself, the token faded toward transparent, or one mix of two tokens in the same proportion in both modes. Parts marked data-projections-category follow the category palette instead. A hard-coded color can't match the theme in both modes.",
  'stage-surface':
    "The field the renderer paints behind its content, sampled just inside the frame's edges at full width in light and dark mode (beneath any entity drawn there, as a canvas opened zoomed reaches the edges), is the stage (`color-surface-canvas`, the kit's `--stage`), or left transparent so the host frame's stage shows: never a lighter page such as `color-bg`. Cards and panels stand on it in `color-surface-raised`.",
  'type-scale':
    "Text uses the theme's type: a font-size token (or the 11px floor, never smaller), the text or monospace font family, and a font-weight token.",
  spacing:
    'Padding, margins and gaps are on the space scale (or a 1–2px hairline); corner radii are radius tokens (or a token less a 1–2px border, or fully rounded); border widths are border-width tokens.',
  'nested-accents':
    "Change and accent colors never nest: an element that contains changed elements stays neutral, and only the innermost changed elements are drawn in a change color (added, removed, modified, moved) or the accent. No element whose background (its color or a gradient's), border or box shadow, its own or its ::before's or ::after's (an SVG shape's fill or outline), is one of those hues contains, or has drawn over it inside its box, another element painted in one, including text and lines. Checked in the diff and after the animation's steps, with the host's highlighting on.",
  'frame-edges':
    "A box with rounded corners and an edge (a border, or an outline inside it) whose painted contents reach a corner draws its edge over them: as the kit's frame (`pk-frame`, or a `Group`, which draws its border again above its contents), or as an outline its contents sit under. Where a fill's curve meets the edge's, whichever is painted last dilutes the other's antialiased pixels, so an edge painted first comes out thinner around the curve than along its sides, even where the fill follows the inner radius. A kit frame's `::after` is that edge: a renderer's rule may recolor it, but one that draws there (content, a fill, a size) fails, as its drawing loses to the kit's or moves the edge.",
  'label-centring':
    "A chip, bar or button's text is centred on its capitals: a capital E has as much room above it as below it, within half a pixel. A line of text centred by its line height sits a little high or low, by how its font's ascent, descent and cap height compare; the kit's `pk-label` trims the text's box to its capitals and baseline and pads it back to its line height, so whatever centres the box centres the capitals. Measured from the font's metrics on every HTML element up to 48px tall that paints a background (or edges above and below) under one line of its own text, by its main text (its largest font size); text in SVG is not checked. Checked at full width in the light theme.",
  'centred-pixels':
    "A painted box centred in a bar, chip or button (an icon, a pill, a mark) sits at equal, whole-pixel gaps either side: a half pixel either side, or a pixel more on one side, is drawn unevenly once snapped to device pixels. A box centres on whole pixels in whole, even room: the kit's `pk-label` gives a label a whole line box, and icons are even squares. Measured on every painted HTML box centred, within a pixel, in its nearest painted ancestor at most 48px across that way, with at most 16px either side; a collapsed table rule counts half to each cell. Checked at full width in the diff (or the extraction).",
  'link-routes':
    'Every link a renderer routes between cards (marked data-projections-route) goes around the cards in its way. When no route around them exists, the renderer draws the one that overlaps them least and marks it data-projections-route="crossing", naming the cards in data-projections-route-crosses, and this check reports it. Checked at full width in the diff and at the end of the animation; skipped for a renderer that routes no links.',
}

/** Every built-in check's ID, in the order `runChecks` runs them by default. */
export const allChecks = Object.keys(checkTitles) as CheckId[]
