# Renderer kit guide

The renderer kit is the shared kit for the built-in Projections renderers, and
the default way to write a custom one. Renderer authors import it from
[`@githubnext/projections`](../../packages/sdk/README.md), in three entries:

<!-- prettier-ignore -->
| Entry | What it is |
|---|---|
| `@githubnext/projections/kit` | Framework-free: the comparison model, step timeline and staged motion, graph layout and arrow routing, diff mode, card text metrics, change status, palettes and presentation helpers. It imports no React, so any renderer can use it |
| `@githubnext/projections/kit/react` | The React half: the renderer shell (`mountRenderer`, `RendererProps`), the graph canvas, presentation and layout components, and the hooks. React and react-dom are (optional) peer dependencies |
| `@githubnext/projections/kit/base.css` and `/kit/react.css` | Plain CSS: `base.css` is the shared look (the `.pk` root's aliases of the theme tokens, change regions, badges, status lines, icons and text), usable without React; `react.css` is `base.css` plus the rules of the React components |

They are bundled from the internal workspace
[`packages/renderers/kit`](../../packages/renderers/kit/README.md),
`@githubnext/projections-renderer-kit`, which has the same entries (`.`,
`/react`, `/base.css`, `/react.css`). The kit adds presentation machinery on top
of the [renderer SDK](../../packages/renderers/sdk/README.md); renderers built
with it are ordinary sandboxed bundles. It has no design-system, GitHub or
network dependency.

A React renderer imports from both entries, the framework-free one for the model
and the React one for the shell and components:

```tsx
// src/view.tsx of a renderer package, with rendererConfig({view: 'src/view.tsx', …}) in vite.config.ts
import './styles.css'
import {isChanged} from '@githubnext/projections/kit'
import type {RendererProps} from '@githubnext/projections/kit/react'

export function View(props: RendererProps) { /* … */ }
```

The renderer's build (`rendererConfig({view})`, see the SDK's
[Build](../../packages/renderers/sdk/README.md#build)) generates its entry: the
kit's styles (`/kit/react.css`), then
`mountRenderer(View, {name, accepts, capabilities})` from `/kit/react` with the
capabilities `vite.config.ts` declares, and the view module's `options` export
(`ViewOptions`: `nouns`, `facts`, `controls`, `steps`, `interactions`). A
renderer with an entry of its own (`rendererConfig({entry})`) imports
`@githubnext/projections/kit/react.css` and calls `mountRenderer` itself.

A renderer without React (see the
[minimal template](../../examples/renderers/minimal/README.md)) uses the
framework-free entry and `base.css` with the SDK's client (`connectRenderer`
from `@githubnext/projections/renderer`), and puts `class="pk"` on its root
element, where `mountRenderer` would have:

```ts
// src/main.ts, with rendererConfig({entry: 'src/main.ts', …}) in vite.config.ts
import '@githubnext/projections/kit/base.css'
import {comparisonModel, describeChange, statusParts} from '@githubnext/projections/kit'
import {connectRenderer} from '@githubnext/projections/renderer'
```

The shell, timeline hooks and graph canvas below are the React entry's; the
comparison model, timeline, staged motion, layout, diff mode helpers, colors and
styles work either way.
[Develop a renderer](develop-a-renderer.md#with-or-without-react) covers
installing the kit without React.

A renderer that declares what it accepts (the SDK's `accepts`) receives typed
extractions: `RendererProps<'database/v0'>`, or `RendererProps<typeof accepts>`
with `accepts` in `rendererConfig` (or
`mountRenderer(Component, {name, accepts, capabilities})`), types `init` and
`model` with the `data` the engine guarantees, narrowed by kind with `isKind`
from `@githubnext/projections/schemas`:

```tsx
function Columns({model}: RendererProps<'database/v0'>) {
  return model.entities.map(row => row.after && isKind(row.after, 'column') ? <li key={row.id}>{row.after.data.type}</li> : null)
}
```

This guide explains how the kit presents a comparison: the shell, the comparison
model, timing and staged motion, diff mode, colors and styles; the
[graph canvas](renderer-kit-graphs.md) and the
[components and item rings](renderer-kit-components.md) have their own pages.
The [renderer kit API](../reference/renderer-kit.md) lists every export with its
signature and documentation; the
[renderer SDK API](../reference/renderer-sdk.md) and the SDK's
[README](../../packages/renderers/sdk/README.md) cover the protocol underneath.
To start a renderer, see [develop a renderer](develop-a-renderer.md).

## Renderer shell

Declare the comparison modes a renderer supports as `comparisonModes` in
`rendererConfig`, which a generated entry passes on as
`capabilities.comparisonModes` (an entry of your own declares the same list
there); see the SDK's [comparison modes](renderer-sdk.md#comparison-modes).

`mountRenderer(Component, {name, capabilities, accepts?, steps?, interactions?})`
returns `{unmount}`, replacing a renderer it mounted before in the same document
(a development server's hot update runs the entry again), and connects through
`useRenderer`, builds the comparison model once per `init`, keeps optimistic
selection (the host's `select` always wins), runs the SDK's interaction
controller unless `interactions: false` (hover, anchors, scroll mirroring, the
host's filter and annotation badges, declaring `interactionCapabilities`; put
`data-entity-id` on every selectable entity and relationship element), observes
height, clears selection on Escape, on a click on the background and on a second
click on the selected item, contains render failures (reported with
`client.error`) and passes `RendererProps`:

- `init`, `model`: Host payload and its `ComparisonModel`
- `comparing`: `init.mode === 'comparison'`
- `diff`, `comparisonMode`: Whether the host presents the comparison in `diff`
  mode (one static frame, no progress: `progress` 1, empty `schedule`,
  `highlighting` 1 unless the host turned it off), and the mode `init` announced
- `focusRequest`: Where the host wants the opening view (`InitPayload.focus`:
  the changes, everything or one item, fitted whatever its text size when it
  says `fit`), or the changes while the host shows changes only. The shell
  scrolls the first focused item of a list into view itself (a fifth of the way
  down, in diff mode the first change by default); a renderer that places its
  own view (`useStageZoom`) frames it, as the graph canvas does
- `progress`, `highlighting`, `direction`: Host position; extractions use 1, 0,
  1
- `emphasis(row, id?)`: A change's emphasis: 0 until its own step begins, then
  the host's highlighting; in a held pane, the host's highlighting
  (`stepEmphasis`)
- `schedule`: Comparison steps placed on the progress axis for the presented
  direction
- `rendererName`: `init.projection.renderer`, for bundles that handle several
  names
- `selectedId`, `onSelect(id | null)`: Selection, reported to the host. Call
  `onSelect(id)` when the person activates an item: activating the selected item
  again clears it (items are `aria-pressed` toggles; the second click of a
  double-click keeps it). The shell clears the selection on a click on the
  renderer's background, and selects or clears an item on a click anywhere on
  its `data-entity-id` element outside a control, so components don't handle
  either
- `hoveredId`: The entity the host says is hovered in any pane, or `null`
- `onOpen(path, line?)`: Source navigation request (the host decides)
- `reportSteps(ends)`: Hold points, for components that use `steps: 'manual'`
- `controls`: Values of the declared controls, defaults filled in
- `declareControls(controls)`: Replaces the declared controls, for ones that
  depend on the document
- `onAction(listener)`: Subscribes to `action` messages (or
  `useControlActions(onAction, {id: handler})`)
- `options`, `viewport`, `reducedMotion`, `locale`: Host state

By default (`steps: 'schedule'`) the shell reports the end of every scheduled
step with `client.steps` (the middle of the hold that follows it, see
[Timeline](#timeline)), so a host's Previous and Next step land on settled
frames, never mid-fade. Every built-in renderer uses the default; `manual` is
for a component whose motion is not driven by `schedule`. The root element is
`.pk[data-renderer][data-mode][data-progress][data-highlighting]`.

Code identifiers and symbols (function, type and package names, paths, routes,
event names, resource addresses, IDs) draw in the theme's monospace font;
human-language labels stay sans. Wrap them in `Identifier` (or spread the SDK's
`identifier` onto any element, SVG text included); kit CSS draws marked elements
in `--projections-font-family-mono`, a pixel smaller in HTML. A name with change
badges goes in `NameLine`: the name truncates with an ellipsis
(`<Identifier truncate>` sets its full text as the title) and the badges stay on
its line, never wrapping or clipping. A human label with identifiers inside it
(`GET /api/cart`, `Inter.woff2 (preloaded)`) goes in `IdentifierText`, which
draws only the identifiers (`identifierParts`) in mono.

Human-readable protocol text marks its code explicitly: reasons, summaries,
notices, diagnostics and details put identifiers, types, members, signatures,
versions and paths in backtick spans
([text with inline code](../contracts.md#text-with-inline-code)). Draw such text
with `Prose`, which renders each span as a marked identifier and the rest in the
text font, never as HTML; use `plainProse(text)` (the same text without markers)
for titles, `aria-label`s and other plain-text attributes. Prefer `Prose` to
`IdentifierText` whenever the producer marks its spans: it never guesses.

Renderers draw no settings controls. `controls` in the view's `options` (or
`mountRenderer(…, {controls})`) declares static ones in `ready`; the host draws
them and sends values in `options` (read them from `controls`) and actions as
`action`. Canvas gestures such as panning, wheel zoom and selection stay in the
frame. Shared declarations: `zoomControls` (zoom actions for any stage scaled
with `useStageZoom`; `graphCanvasControls` is the same set, for `GraphCanvas`)
and `codeStatisticsControls` with `codeStatisticsOptions(values)`.

The shell also runs the SDK's `useInteractions` on its root and declares
`hover`, `anchors` and `scrollSync` (pass `interactions: false` to opt out).
Components only need to put `data-entity-id="<selection ID>"` on every element
that presents an entity or relationship, using the same ID they pass to
`onSelect`, and `data-projections-scroll="<stable name>"` on their main scroll
container so two panes mirror it. Host hover marks those elements with
`data-projections-hovered`; `base.css` gives HTML entities a light accent ring,
and `react.css` gives graph cards and links an accent stroke or halo, lighter
than selection.

## Comparison model

`createModel(init)` (or `comparisonModel(before, after, comparison)` /
`extractionModel(extraction)`) presents rows through the SDK's
`presentComparison`; it never matches or infers identity. It adds:

- `entityRow.before/after`: entity ID on either side → presented row ID.
- `steps`:
  `ModelStep {index, kind, declaredKind?, summary?, entities, relationships}`
  with change IDs resolved to row IDs (split parts and merged sources included).
  `kind` is inferred from the entity members (all added: `add`, all removed:
  `remove`, otherwise `restructure`; a step of relationships alone keeps its
  declared kind) so unlabeled custom steps still animate.
- `reverse` and `reverseSteps` from `order.reverse`.

In extraction mode every row has identical `before` and `after`.

## Timeline

The comparison decides order and grouping; timing is presentation and lives
here. Host playback is continuous (one progress value moving from 0 to 1), so
the kit makes steps visible by **holding**: shapes move only inside their step's
window and stay still between windows while progress keeps moving.

- **Hold policy.** Each step owns a slot of the progress axis; it moves in the
  middle `1 - stepHoldShare` of the slot (`stepHoldShare` is 1/3) and holds for
  the rest, so consecutive windows are separated by one hold of `step.hold`. The
  headroom before the first and after the last step (while the host's
  highlighting is at full strength) is at least as long. Renderers never add
  their own phase constants: they time every change by its own step
  (`stepProgress`, `local`, `rowPresence`, `createGraphTransition`), so the
  holds apply everywhere.
- **Reading policy.** Each class of change has its own choreography, and the
  timeline gives every renderer the same one:
  - _Removed_: a step that removes something starts with a reading `lead` of
    `readingShare` slots (one slot: about a second at 1× speed with the host's
    default pace, which counts it, `timelineSlots`). Its changes' emphasis rises
    over the first fifth of the lead and holds while nothing moves, so the
    viewer can read what is about to go; then it fades out, and only then does
    the layout close its gap. Removed relationships leave with their cards.
  - _Added_: room opens, the arrival fades in already emphasized, then a reading
    `tail` as long as the lead keeps it still and emphasized before the next
    step moves. Its emphasis lingers until the host's endpoint fade.
  - _Modified, renamed or moved_: emphasis rises over the start of the motion,
    while the quintic move is still slow, and stays on an item that stays.

  Lead and tail mirror each other, so a reversed comparison draws the same
  frames backward. Every step's emphasis starts at its own window, so a stop
  between steps shows only the changes made so far, and the end state carries no
  highlighting.

- `compileTimeline(steps, {lead, tail})`: windows
  `{time, radius, hold, lead, tail}` centred on 0.5, with a reading lead for
  each step `lead` accepts and a reading tail for each step `tail` accepts
  (`scheduleSteps` passes steps that remove and steps that add); reversing a
  sequence mirrors its timeline.
- `scheduleSteps(model, direction)`: forward steps, or for `explicit` reverse
  order and `direction === -1`, `reverseSteps` placed so that the first one
  happens first when leaving progress 1.
- `DirectionLatch`: under explicit order, the schedule latches to the direction
  of travel when leaving an endpoint and keeps it until an endpoint is reached,
  so reversing mid-transition never jumps timelines. The shell applies it.
- `stepEnds(schedule, direction)`: hold points for `client.steps`, the middle of
  the hold after each step in the direction of travel, so a host's Previous and
  Next step always land on a settled frame.
- `stepHolds(schedule)`: the still intervals, for tests and diagnostics.
- `stepProgress(step, progress)`: progress through one step's motion
  (`motionWindow(step)`, its window without the reading lead and tail), constant
  in every hold and while reading.
- `emphasisRise(step, progress)`: the share of the host's highlighting a change
  in `step` shows; `stepEmphasis` applies it per row.

## Staged motion

- `await createGraphTransition(model, schedule, {orientation, compound, include, junctions})`
  → `(progress) => GraphFrame {nodes, edges, junctions, width, height}`, with
  `layouts` (every layout frames interpolate between; frame from them). Layout
  is asynchronous; the returned transition is a pure function of progress. A
  comparison has three ELK layouts: the union of every entity and relationship
  of either revision, and Before and After, each laid out on its own but keeping
  the union's layers and in-layer order. The first step's move window goes from
  Before to the union (room for everything that arrives), steps in between hold
  the union while entities fade in and out where they belong, and the last
  step's move window settles on After (a single step moves straight from Before
  to After). Sharing layers and order, consecutive layouts interpolate without
  passing one card through another, and every settled frame draws the routes ELK
  made for it. Routes are cubic Bézier chains (`Spline`) that morph by
  interpolating control points (the simpler chain is subdivided first); a route
  only one of the two layouts has follows its cards. Removals are read, fade,
  then the layout closes the gap; additions make room, then fade in and are
  read; restructures move for the whole motion and crossfade rewired
  relationships. Relationships never outlive their endpoints. Nodes and edges
  carry `local`, the progress through their own step's motion (use it for label
  crossfades and before/after choice; 0 for rows no step changes).
- `createStagedTimeline(model, schedule, {include})` is the same staging for
  renderers with their own layouts: `stages` (active rows and settled rows after
  each step), `at(progress) → {from, to, mix}`, `presence(id, progress)`,
  `local(id, progress)`, `rowPresence(id, progress) → {size, opacity}` (list
  rows: removals fade then collapse, additions open then fade in),
  `version(row, stage)` and `relationships(stage)`.
- `stepWindows`, `moveEasing`, `ease`, `easeWithin`, `smootherstep`,
  `smoothstep`, `settle`, `fadeIn`, `fadeOut`, `easeIn`, `easeOut`, `ramp`,
  `within`, `unitProgress`. Layout moves use quintic smootherstep and span most
  of their step (65% of an add or remove step, around fades that take the rest);
  fade-ins ease out and fade-outs ease in, mirrors of each other, so a reversed
  comparison draws the same frames. `ease` is that same quintic curve for
  anything else a renderer interpolates from progress (bar widths, counts, slice
  angles), and `easeWithin(local, start, end)` eases one phase of a step; ease
  the value, then round it for display.

## Graphs and components

Two pages continue this guide:

- [Renderer kit: graph canvas and geometry](renderer-kit-graphs.md): the graph
  canvas, layout and geometry.
- [Renderer kit components](renderer-kit-components.md): presentation helpers
  and components, item rings and layout components.

## Diff mode

In diff mode (`props.diff`) a renderer draws one static comparison: a single
layout of the _union_ of both revisions, in the renderer's own form (a graph
stays a graph, cards stay cards, a packing stays a packing), with every change
overlaid in place. It is the animation collapsed in time: everything that
arrives, leaves or changes is visible at once.

1. Declare it: `'diff'` in `rendererConfig`'s `comparisonModes` (and, with an
   entry of your own, in `capabilities.comparisonModes`).
2. Take the union from the comparison: `diffModel(model)` returns every entity
   (`DiffEntity`: its `change`, the version to draw — After, or Before for a
   removed one — and the `fields` that differ between its versions) and every
   relationship (`DiffRelationship`, with entity row IDs at both ends; a
   relationship rewired between other endpoints is two parts, `<id>:before`
   removed and `<id>:after` added), plus `counts` per change. Nothing is matched
   or inferred: identity and status are the comparison's.
3. Lay the union out once, with the layout your other modes use. Removed and
   added items must not overlap, and the layout should stay close to After's so
   the diff and side by side feel related, and be deterministic. The graph
   canvas uses the union layout its animation already passes through
   (`GraphTransition.diff`, or `createGraphTransition(…, {diffOnly})` for that
   layout alone); the file packing packs the union at its After sizes.
4. Mark each item where it is drawn with `changeMark(change)`, which spreads
   `data-change="added|removed|modified|renamed"` (nothing when unchanged) on
   the element that carries `data-entity-id`. The kit styles draw an HTML
   `pk-region` with that attribute as a fill and a same-hue edge, and an SVG
   item's `pk-diff-shape` (its card or circle) the same way, dashed when
   removed; a removed item's `pk-diff-text` is struck through and muted. Every
   `[data-change]` element sets `--pk-region-fill`, `--pk-region-edge` and
   `--pk-change-ink` for what is inside it. Marks follow `--emphasis`, so the
   host's highlighting off draws the union plain. Say each change in words too
   (an accessible name, a status footer or `sr-only` text), never color alone.
   Removed relationships are dashed in the removed hue, added ones drawn in the
   added hue (`edgePaint`).
5. Show what changed inside a modified item inline, values verbatim:
   - `ValueChange({before, after, layout})`: the old value struck through in a
     removed pill above (`stacked`, the default) or before (`inline`, with an
     arrow) the new one in an added pill; assistive technology reads "was …, now
     …". `SvgValueChange` is the same on one SVG text line (`pk-svg-was`,
     `pk-svg-arrow`, `pk-svg-now`).
   - `ChangePills({items, label, onSelect?, selectedId?})`: a list whose items
     arrive and leave, as pills with `+` or `−` and their change in words;
     unchanged ones stay plain, for context. Pills with an `entityId` are
     selectable parts.
   - `fieldChanges(before, after, {fields})` and
     `fieldLines(row, {fields, exclude, object})` list what differs
     (`formatValue` writes values as extracted; `sameValue` compares them
     structurally); with `object`, down to the leaves that changed
     (`leafChanges`: `properties.hardwareProfile.vmSize`,
     `ingress[0].from_port`), not the whole object twice.
   - Show data whole: wrap long values rather than cutting them off.
     `wrapText(text, chars)` breaks after `_ . / - , :` first, then at the
     limit, and never drops a character; `diffCardText` lays out a graph card's
     text that way and gives its width (what its longest line needs, or the
     graph's shared `width`) and height.
6. Draw no summary line: the host's summary bar counts each kind and its changes
   (name your kinds with `nouns`), and states the findings the counts can't say
   (an API's compatibility, a policy's coverage, a plan's actions) as `facts`
   (see the summary bar under
   [Presentation helpers and components](renderer-kit-components.md#presentation-helpers-and-components)),
   in the domain's words, derived from the comparison and the documents only.

Selection, hover, anchors, the host's filter and annotations work in diff mode
as in every other: keep `data-entity-id` on every item, and keep the union
responsive down to 390 px. The renderer checks' `diff-changes`, `diff-neutral`,
`diff-clipping` and `stable-layout` cover it.

## Filling the frame

A host may size the renderer frame to the content (the frame follows the
renderer's reported height) or size it itself, for example to fill a tall stage.
Spatial renderers use the whole frame either way:

- `useFrameFill(preferredHeight)`: while mounted, the root fills the frame's
  height (`.pk[data-fill]`, a flex column whose child takes the remaining
  height) and reports `preferredHeight` as the content height, the height a
  content-sized host should give the frame.
- `useFrameSizing()`: how the host sizes the frame (the environment's `sizing`):
  `content` when it gives the frame the reported height, `fill` when it sizes it
  itself, undefined when the host doesn't say.
- `useFitScale(stage, size, {padding, maxScale, minHeight, floor})` →
  `{scale, width, height}`: fits content of `size` to the stage element (the
  flexible child): centred, scaled down to fit both dimensions with `padding`
  (16) around it, however small that makes it, never above `maxScale` (1). The
  fit has no floor of its own (`useStageZoom` applies the opening floor). In a
  frame sized to its content (`useFrameSizing()` is `content`) it fits only the
  width, so the scale of the first paint is the one the frame keeps once the
  host gives it its height. It calls `useFrameFill` with the stage at the
  width-fitted scale (or at `floor`, the `useOpeningFloor` scale, when the view
  opens there) plus everything around it, at least `minHeight` (200) unless the
  content is scaled down to the width, so a content-sized host's view at the
  floor pans only sideways. A host that lays a content-sized frame in its
  scrolling page sends the optional `stage-max-height` token (`px`, or `vh` of
  its window, from its `viewport`): the stage then asks for at most that
  (`useStageHeightCap()`, `contentHeightCap`), and content taller than that is
  fitted to the capped stage in both dimensions, or opens at the floor and pans.
  `padding` may be `{x, y}`, across and down, with `top` above the content when
  it differs from `y`. It also reports the content's shape to the host
  (`aspect`, via `useContentAspect`, which renderers that fit content another
  way call themselves), so side by side can stack wide content (`aspect` reports
  another shape, such as that of a focused area the view opens on).
  `fitScale(size, stage, options)` is the pure calculation.
- `useStageInset()`: the host's `stage-inset` theme token in CSS px, or
  undefined when it sends none. A host that lines renderer content up with its
  page's column sends it; CSS reads it with the renderer's own inset as the
  fallback (`var(--projections-stage-inset, <own>)`). The graph canvas pads its
  fitted drawing by it across, reaching exactly to its outermost cards, and
  opens with its leftmost card that far from the edge (`contentStart`'s
  `clear`).
- `useStageInsetTop()`: the host's `stage-inset-top` theme token in CSS px, or
  undefined when it sends none. A host that overlays the frame's top (a pane's
  label chip) sends it; CSS reads it in place of the renderer's own top padding
  (`var(--projections-stage-inset-top, <own>)`), so content starts below the
  overlay while the stage's background reaches under it. The graph canvas keeps
  it above its fitted drawing (`padding`'s `top`, beside `x` and `y`).
- `useStageZoom(scroller, onAction, fit, {floor, start})` → `{zoom, scale}`:
  zoom for content fitted at `fit`, as a multiple of it (`zoomLimits`): 1 is
  fitted and the minimum, so zooming out always reaches "everything in view" and
  stops there. The view opens fitted, with all of the content in view, unless
  that draws its smallest text below `openingFloorPx` (8 CSS px): then it opens
  at `floor` (`useOpeningFloor(root, key)`: the scale at which the smallest text
  in `root`, SVG or HTML, including text that fades in later, is 8 px, measured
  when `key` changes, never while scrubbing; `openingZoom(fit, floor)` is the
  pure calculation), scrolled to `start` (a `ScrollStart`: fractions of the
  scroll range, such as `{x: 0.5, y: 0}` for the top centre of a centred layout,
  or `contentStart(boxes, bounds, inset)`, the top row's leftmost box at the top
  left), and the person scrolls and pans the rest. `opening: {zoom, start}`
  replaces that opening view, for example with one on a focus (see
  `focusRequest` below); a `start` function also receives the view's size, to
  centre something. Until the person zooms or pans, a resize recomputes that
  opening from the new fit. A transition's floor and framing cover both
  endpoints, so it never zooms while scrubbing. Fit to view returns to
  everything in view, however small; Zoom in and out multiply and divide by 1.5
  (clamped, never skipping the fit), up to 4× the fit or 2 CSS px per unit,
  whichever is larger, so a tiny fit can still be read. It handles the
  host-drawn `zoomControls` actions (`zoom-in`, `zoom-out`, `zoom-fit`),
  Ctrl/⌘-wheel and pinch, and keeps the scroll position's centre across later
  scale changes (`useScrollAnchor`, which also places content that can't be
  fitted yet, such as a stage laid out before its pane has a height, at its top
  left until the person scrolls or zooms). Once zoomed or panned, a resize keeps
  the multiple of the new fit. Put `data-zoom` on the scroll container and draw
  at `scale`. In a content-sized frame whose host sends `stage-max-height`
  (laying it in its scrolling page), the stage never takes the page's wheel or
  touch scrolling: it pans by dragging (a mouse or pen, a sideways touch drag,
  or the arrow keys while it has focus; `data-pan="drag"` hides its overflow,
  `data-pannable` marks content larger than it), so the wheel and an upward or
  downward swipe scroll the page, while Ctrl/⌘-wheel and pinch still zoom.

  Opening fitted, with an 8 px floor, is a product decision. Until 2026-11-10 a
  stage whose fit drew its smallest text under 11 CSS px opened at that readable
  floor instead, scrolled to its first row of cards or, in VS Code tabs, centred
  on its changes. The user superseded that rule on 2026-11-10: a projection that
  opens cropped hides part of the change and makes the first thing a reader does
  a scroll, so every zoomable view opened with all of its content in the
  viewport, and denser graph layouts (content-sized cards, tighter spacing) keep
  its text readable wherever the content allows. The same day, measurements
  showed that always fitting drew the largest graphs' text at 1.6-7 px in a
  1000×650 tab and at 2-9 px in a 390×700 phone frame, too small to read, so the
  user kept always-fit and added a minimum: a view never opens with text below 8
  px; content that would opens at that floor, on its top left (or top centre),
  and scrolls. 8 px, rather than the old 11, keeps every graph that is legible
  fitted opening fitted.

- `usePaintGate(ready)` holds the `rendered` acknowledgement until a measured or
  asynchronous layout is ready, so the host reveals a finished frame.

Graph, DAG, architecture, infrastructure, dependencies, dependency injection and
the database schema fit their content to the stage and declare `zoomControls`;
the file packing lays out at the stage's size (scaled down when the stage is
smaller than the smallest area it packs).

## Language and category colors

`categoryPalette(categories, colorMode)` colors weighted categories the same way
in every built-in renderer, ranked over the whole document (both revisions) so a
category keeps its color from Before to After:

- Programming and markup languages take their GitHub Linguist hue, calibrated to
  the theme (the SDK's languages, in `@githubnext/projections/renderer`):
  TypeScript is the same muted blue in file packing and code statistics.
- Everything else (data, configuration, prose, assets: JSON, YAML, TOML,
  Markdown, images) takes a slot of the categorical palette (`chart-1` …
  `chart-16`): its preferred slot (JSON, YAML and Markdown usually keep theirs),
  else the first free slot in palette order, skipping slots too close to a
  language color in use.
- Past the palette, the rest share the neutral `color-border-emphasis`
  (`otherToken`), which nothing else uses.

Categories come from `fileCategory(path)` (the Linguist language, with variants
under their group, else `.ext` or "No extension"), `languageCategory(name)` (a
language another tool names) or `plainCategory(key)`. Each entry has a `paint`
for CSS and a `swatch` for the legend (`{color}` for a language, `{token}`
otherwise); `paletteLegend(palette, title)` builds the host legend. Renderers
receive the theme's `colorMode` in `RendererProps`.

## Styles

Every visual value comes from the host's theme tokens (token set 0,
`--projections-<name>`, always defined by the SDK): colors, the categorical
palette, type scale, spacing, radii, borders, shadows, control and label
metrics. The kit hard-codes no color, size or shadow, and neither should
renderers built on it; only layout geometry (box sizes, coordinates,
breakpoints) stays in code.

`base.css` (which `react.css` includes) aliases the tokens under `.pk`:
`--surface`, `--canvas`, `--recessed`, `--overlay`, `--text`, `--muted`,
`--subtle`, `--on-emphasis`, `--border`, `--border-strong`, `--border-emphasis`,
`--accent`, `--focus`, `--hover`, the change colors `--green`, `--red`,
`--amber`, `--violet` (added, removed, modified, moved) with `-soft` (muted
fill), `-border` and `-strong` (emphasis fill) variants, `--highlight` and
`--green-highlight`/`--red-highlight`/`--amber-highlight`/`--violet-highlight`
(highlights behind plain text, for hover, find matches and word-level changes),
`--edge`, `--graph-bg`, `--dot`, `--chart-1…16` (categorical colours, used in
order; mark the painted part `data-projections-category="<key>"` and keep a
key's colour for the whole transition), `--font-mono`, and
`--stroke`/`--stroke-strong` for SVG line weights (`edgePaint` weights are
relative to `--stroke`). Hover and selection affordances are drawn once per
visual unit and follow its shape: a unit is an entity element not inside another
one, or one marked `data-projections-unit`, and gets a ring inside its own
border radius. An entity nested in a unit (a column in a table, a member in a
card) is a part: it is tinted, never outlined, and units clip their contents to
their own radius (`overflow: hidden`, or a clip path in SVG). The harness checks
this for every renderer (`affordanceFailures` in
`packages/renderers/kit/browser/invariants.ts`). `base.css` also styles change
regions (`pk-region` with `data-change`), badges (the label tokens), status
lines and icons, names, identifiers, empty and error states, notices, legends,
content buttons (`.pk-button`) and `[data-projections-hovered]` hover marks;
`react.css` adds generated fields, the graph canvas, diff mode's marks and the
layout components.
