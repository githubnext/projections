# Renderer kit guide

The renderer kit is the shared foundation behind Projections' built-in renderers
and the recommended way to build custom ones. You import it from
[`@githubnext/projections`](../../packages/sdk/README.md) across three entry
points:

<!-- prettier-ignore -->
| Entry | What it is |
|---|---|
| `@githubnext/projections/kit` | Framework-free: the comparison model, step timeline and staged motion, graph layout and arrow routing, diff mode, card text metrics, change status, palettes and presentation helpers. It imports no React, so any renderer can use it |
| `@githubnext/projections/kit/react` | The React half: the renderer shell (`mountRenderer`, `RendererProps`), the graph canvas, presentation and layout components, and the hooks. React and react-dom are (optional) peer dependencies |
| `@githubnext/projections/kit/base.css` and `/kit/react.css` | Plain CSS: `base.css` is the shared look (the `.pk` root's aliases of the theme tokens, change regions, badges, status lines, icons and text), usable without React; `react.css` is `base.css` plus the rules of the React components |

These entries are bundled from the internal workspace
[`packages/renderers/kit`](../../packages/renderers/kit/README.md)
(`@githubnext/projections-renderer-kit`), which exposes the same entry points
(`.`, `/react`, `/base.css`, `/react.css`). The kit layers presentation
machinery onto the [renderer SDK](../../packages/renderers/sdk/README.md) while
still producing ordinary sandboxed bundles with zero design-system, GitHub, or
network dependencies.

A React renderer pulls model utilities from the framework-free entry and the
shell and components from the React entry:

```tsx
// src/view.tsx of a renderer package, with rendererConfig({view: 'src/view.tsx', …}) in vite.config.ts
import './styles.css'
import {isChanged} from '@githubnext/projections/kit'
import type {RendererProps} from '@githubnext/projections/kit/react'

export function View(props: RendererProps) { /* … */ }
```

When you configure `rendererConfig({view})` (see the SDK's
[Build guide](../../packages/renderers/sdk/README.md#build)), Vite generates an
entry point that loads `/kit/react.css` and calls
`mountRenderer(View, {name, accepts, capabilities})` from `/kit/react` using the
capabilities from `vite.config.ts` along with your view module's `options`
export (`ViewOptions`: `nouns`, `facts`, `controls`, `steps`, `interactions`).
If you supply a custom entry (`rendererConfig({entry})`), import
`@githubnext/projections/kit/react.css` and invoke `mountRenderer` yourself.

If you prefer to skip React (see the
[minimal template](../../examples/renderers/minimal/README.md)), combine the
framework-free entry and `base.css` with `connectRenderer` from
`@githubnext/projections/renderer`, and place `class="pk"` on your root element
just as `mountRenderer` does:

```ts
// src/main.ts, with rendererConfig({entry: 'src/main.ts', …}) in vite.config.ts
import '@githubnext/projections/kit/base.css'
import {comparisonModel, describeChange, statusParts} from '@githubnext/projections/kit'
import {connectRenderer} from '@githubnext/projections/renderer'
```

The shell, timeline hooks, and graph canvas live in the React entry, while the
comparison model, timeline, staged motion, layout, diff mode helpers, colors,
and base styles work with or without React. See
[Develop a renderer](develop-a-renderer.md#with-or-without-react) for installing
the kit without React.

When your renderer declares its schema via `accepts`, both `init` and `model`
are strongly typed with the `data` the engine guarantees. Use
`RendererProps<'database/v0'>` (or `RendererProps<typeof accepts>` alongside
`accepts` in `rendererConfig` or
`mountRenderer(Component, {name, accepts, capabilities})`), then narrow entities
by kind with `isKind` from `@githubnext/projections/schemas`:

```tsx
function Columns({model}: RendererProps<'database/v0'>) {
  return model.entities.map(row => row.after && isKind(row.after, 'column') ? <li key={row.id}>{row.after.data.type}</li> : null)
}
```

This page covers the renderer shell, comparison model, timeline and staged
motion, diff mode, frame sizing, palettes, and styling. Continue to the
[graph canvas guide](renderer-kit-graphs.md) and the
[components and item rings guide](renderer-kit-components.md) for the rest of
the kit. For exhaustive signatures, see the
[renderer kit API](../reference/renderer-kit.md), the
[renderer SDK API](../reference/renderer-sdk.md), and the SDK
[README](../../packages/renderers/sdk/README.md). If you are starting a new
renderer from scratch, begin with [develop a renderer](develop-a-renderer.md).

## Renderer shell

Declare supported comparison modes with `comparisonModes` in `rendererConfig`,
which the generated entry forwards as `capabilities.comparisonModes` (if you
write your own entry, declare the same list there; see
[comparison modes](renderer-sdk.md#comparison-modes)).

Calling
`mountRenderer(Component, {name, capabilities, accepts?, steps?, interactions?})`
mounts your component and returns `{unmount}`, cleanly replacing any prior
instance in the same document during dev-server hot reloads. Under the hood it
wires up `useRenderer`, builds the comparison model once per `init`, maintains
optimistic selection (with the host's `select` always authoritative), starts the
SDK's interaction controller unless `interactions: false` (handling hover,
anchors, scroll mirroring, filtering, and annotation badges, and declaring
`interactionCapabilities`—just put `data-entity-id` on every selectable entity
and relationship), tracks content height, clears selection on Escape, background
clicks, or re-clicking the selected item, catches render errors (reporting them
via `client.error`), and passes `RendererProps` to your component:

- `init` and `model` — The host payload and its derived `ComparisonModel`.
- `comparing` — Shorthand for `init.mode === 'comparison'`.
- `diff` and `comparisonMode` — Whether the host is rendering `diff` mode (one
  static frame with `progress` 1, empty `schedule`, and `highlighting` 1 unless
  disabled by the host) plus the exact mode announced by `init`.
- `focusRequest` — Where the host wants the view to open (`InitPayload.focus`
  for changes, everything, or a specific item—honoring `fit` even below the text
  floor—or changes while the host filters to changes only). The shell scrolls
  the first focused item of a list into view automatically (about a fifth down,
  defaulting to the first change in diff mode), while spatial renderers using
  `useStageZoom` frame it as `GraphCanvas` does.
- `progress`, `highlighting`, and `direction` — Current host playback position
  (single extractions pass 1, 0, 1).
- `emphasis(row, id?)` — Change emphasis for a row (`stepEmphasis`): 0 until its
  own step begins, then the host's highlighting (or the host's highlighting
  directly inside a held pane).
- `schedule` — Comparison steps mapped onto the progress axis for the active
  direction.
- `rendererName` — `init.projection.renderer`, useful when one bundle serves
  multiple renderer names.
- `selectedId` and `onSelect(id | null)` — Current selection synced with the
  host. Call `onSelect(id)` when a user activates an item; activating the
  selected item again toggles it off (items behave as `aria-pressed` toggles,
  while the second click of a double-click preserves selection). Because the
  shell automatically clears selection on background clicks and handles clicks
  anywhere on a `data-entity-id` element outside controls, individual components
  do not need to wire up either behavior.
- `hoveredId` — Entity ID currently hovered in any pane, or `null`.
- `onOpen(path, line?)` — Asks the host to open a source location.
- `reportSteps(ends)` — Reports custom hold points when using `steps: 'manual'`.
- `controls`, `declareControls`, and `setControl(id, value)` — Current control
  values (with defaults populated), dynamic control replacement, and updating a
  control from inside the view (such as
  [a sorting heading](renderer-kit-components.md#data-tables)).
- `onAction(listener)` — Subscribes to `action` messages (or use
  `useControlActions(onAction, {id: handler})`).
- `options`, `viewport`, `reducedMotion`, and `locale` — Remaining host state.

By default (`steps: 'schedule'`), the shell reports every scheduled step's end
via `client.steps` (the midpoint of the hold after each step; see
[Timeline](#timeline)) so Previous and Next step always land on settled frames.
All built-in renderers use this default; pass `manual` only when motion is not
driven by `schedule`. The shell marks its root element as
`.pk[data-renderer][data-mode][data-progress][data-highlighting]`.

**Identifiers and prose.** Display code symbols—function, type, and package
names, paths, routes, event names, resource addresses, and IDs—in the theme's
monospace font while keeping human labels in sans. Wrap symbols in `Identifier`
(or spread the SDK's `identifier` onto any HTML or SVG element) so kit CSS
renders them in `--projections-font-family-mono` (1 px smaller in HTML). When a
name sits beside change badges, wrap both in `NameLine` so the name truncates
with an ellipsis (`<Identifier truncate>` puts the full text in its title) while
the badges stay on the same line without wrapping or clipping. For mixed labels
such as `GET /api/cart` or `Inter.woff2 (preloaded)`, `IdentifierText` renders
only the detected code spans (`identifierParts`) in monospace.

Protocol text that already marks code spans in backticks—reasons, summaries,
notices, diagnostics, and details (see
[text with inline code](../contracts.md#text-with-inline-code))—should be
rendered with `Prose`, which turns each backtick span into an identifier without
interpreting HTML. Use `plainProse(text)` for plain-text attributes like titles
and `aria-label`s. Whenever the producer marks spans explicitly, prefer `Prose`
over `IdentifierText` so nothing has to be guessed.

**Controls and interactions.** Renderers never draw their own settings UI.
Declare static controls via `controls` in view `options` (or
`mountRenderer(…, {controls})`) so they are announced in `ready`; the host
renders them, sends their values in `options` (exposed as `controls`), and
forwards button presses as `action`. Direct canvas interactions—panning, wheel
zoom, selection—stay inside the frame. Reusable control sets include
`zoomControls` (for any stage using `useStageZoom`, aliased as
`graphCanvasControls` for `GraphCanvas`) and `codeStatisticsControls` with
`codeStatisticsOptions(values)`.

The shell also runs the SDK's `useInteractions` on its root and declares
`hover`, `anchors`, and `scrollSync` unless you pass `interactions: false`. Just
put `data-entity-id="<selection ID>"` on every entity or relationship element
(matching the ID passed to `onSelect`) and
`data-projections-scroll="<stable name>"` on your main scroll container for
cross-pane scroll mirroring. Host hover applies `data-projections-hovered`,
which `base.css` styles with a subtle accent ring on HTML entities and
`react.css` styles with a light accent stroke or halo on graph cards and links.

## Comparison model

`createModel(init)` (or `comparisonModel(before, after, comparison)` and
`extractionModel(extraction)`) wraps the SDK's `presentComparison` without ever
matching or inferring identity on its own. It adds three conveniences:

- `entityRow.before/after` maps entity IDs on either side to their presented row
  ID.
- `steps` resolves change IDs to row IDs (including split parts and merged
  sources) in
  `ModelStep {index, kind, declaredKind?, summary?, entities, relationships}`.
  When a custom step is unlabeled, `kind` is inferred from its entity members
  (all added → `add`, all removed → `remove`, otherwise `restructure`;
  relationship-only steps keep their declared kind) so custom steps animate
  cleanly.
- `reverse` and `reverseSteps` reflect `order.reverse`.

In extraction mode, every row has identical `before` and `after`.

## Timeline

The comparator decides step order and grouping; the kit owns how those steps
unfold in time. Because host playback drives a single continuous `progress` from
0 to 1, the kit creates distinct steps through **holds**: elements only move
inside their step's motion window and stay completely still between windows
while progress continues advancing.

- **Hold policy.** Each step claims a slot along the progress axis, moving
  during the middle `1 - stepHoldShare` of its slot (`stepHoldShare` is 1/3) and
  holding for the rest, leaving one full `step.hold` pause between consecutive
  windows and at least as much headroom before the first step and after the
  last. Never invent phase constants in your renderer—derive all timing from the
  step helpers (`stepProgress`, `local`, `rowPresence`, `createGraphTransition`)
  so holds behave consistently everywhere.
- **Reading policy.** Every class of change follows a consistent choreography:
  - _Removed:_ A removal step begins with a reading `lead` of `readingShare`
    slots (one slot, roughly a second at 1× default pace, counted in
    `timelineSlots`). Emphasis ramps up during the first fifth of the lead and
    holds still so the viewer can see what is leaving; then the item fades out,
    and only afterward does the layout close the gap. Removed relationships
    depart with their cards.
  - _Added:_ Space opens first, the new item fades in already emphasized, and a
    reading `tail` equal to the lead holds it still and emphasized before the
    next step starts. Its emphasis remains until the host's endpoint fade.
  - _Modified, renamed, or moved:_ Emphasis ramps up early in the motion while
    the quintic move is still gentle, and stays on items that remain.

  Because lead and tail mirror each other, playing a comparison backward shows
  the exact same frames in reverse. Emphasis for each step starts at its own
  window, so pausing between steps highlights only the changes applied so far,
  and both endpoints remain neutral.

The timeline API exposes these building blocks:

- `compileTimeline(steps, {lead, tail})` computes
  `{time, radius, hold, lead, tail}` windows centered around 0.5, attaching
  reading leads and tails to the steps selected by `lead` and `tail`
  (`scheduleSteps` passes removing and adding steps). Reversing a sequence
  mirrors its timeline.
- `scheduleSteps(model, direction)` returns the forward schedule, or for
  `explicit` reverse order when `direction === -1`, places `reverseSteps` so the
  first reverse step runs first when leaving progress 1.
- `DirectionLatch` locks the schedule to the travel direction as soon as
  playback leaves an endpoint under explicit order, holding it until reaching an
  endpoint so scrubbing back mid-transition never jumps timelines. The shell
  manages this automatically.
- `stepEnds(schedule, direction)` computes hold midpoints for `client.steps` so
  Previous and Next step always land on settled frames.
- `stepHolds(schedule)` returns the stationary intervals for tests and
  diagnostics.
- `stepProgress(step, progress)` returns progress across a step's motion window
  (`motionWindow(step)`, excluding reading lead and tail), staying flat during
  holds and reading periods.
- `emphasisRise(step, progress)` computes how much of the host's highlighting a
  change in `step` should show; `stepEmphasis` applies it per row.

## Staged motion

For graph renderers,
`await createGraphTransition(model, schedule, {orientation, compound, include, junctions})`
asynchronously computes the layouts and returns a pure function
`(progress) => GraphFrame {nodes, edges, junctions, width, height}` along with
`layouts` (every layout the transition interpolates between, for framing).

A graph comparison computes three ELK layouts: the union of both revisions, plus
Before and After laid out individually while inheriting the union's layers and
in-layer order. The first step moves from Before to the union to open room for
arrivals; intermediate steps hold the union while items fade in and out in
place; the final step settles onto After (a single-step comparison moves
directly from Before to After). Sharing layers and ordering keeps cards from
passing through each other and lets every settled frame use its exact ELK
routes.

Edges are cubic Bézier chains (`Spline`) that morph by interpolating control
points (subdividing the simpler chain first), while edges present on only one
side track their cards. Removals pause to be read, fade out, and close their
gap; additions open space, fade in, and pause to be read; restructures move
continuously while crossfading rewired edges. Relationships never outlive their
endpoints. Each node and edge carries `local`, the progress through its own
step's motion (0 for unchanged rows), which you can use for label crossfades and
before/after selection.

Renderers with custom layouts get the same choreography from
`createStagedTimeline(model, schedule, {include})`. It exposes `stages` (active
and settled rows after each step), `at(progress) → {from, to, mix}`,
`presence(id, progress)`, `local(id, progress)`,
`rowPresence(id, progress) → {size, opacity}` (fading out before collapsing on
removal, opening before fading in on addition), `version(row, stage)`, and
`relationships(stage)`.

For easing and sub-window timing, the kit exports `stepWindows`, `moveEasing`,
`ease`, `easeWithin`, `smootherstep`, `smoothstep`, `settle`, `fadeIn`,
`fadeOut`, `easeIn`, `easeOut`, `ramp`, `within`, and `unitProgress`. Layout
moves use quintic smootherstep across 65% of an add or remove step while fades
take the rest; fade-ins ease out and fade-outs ease in so reverse playback
mirrors forward playback. Use `ease` for any other continuous value (bar widths,
counts, slice angles) and `easeWithin(local, start, end)` for a phase within a
step—always ease first, then round for display.

## Graphs and components

Two companion pages cover the rest of the kit:

- [Renderer kit: graph canvas and geometry](renderer-kit-graphs.md) covers
  `GraphCanvas`, ELK layout, edge routing, splines, and arrowheads.
- [Renderer kit components](renderer-kit-components.md) covers presentation
  helpers, item rings, layout primitives, and data tables.

## Diff mode

In diff mode (`props.diff`), your renderer draws a single static comparison: one
layout of the _union_ of both revisions in your renderer's own visual form (a
graph stays a graph, cards stay cards, file packing stays file packing), with
every addition, removal, and edit marked in place. Think of it as the animation
collapsed in time so reviewers can see the entire change at once.

Building a solid diff mode takes seven steps:

1. **Declare it.** Add `'diff'` to `comparisonModes` in `rendererConfig` (and in
   `capabilities.comparisonModes` if you maintain a custom entry).
2. **Build the union.** Call `diffModel(model)` to get every entity
   (`DiffEntity`, with its `change`, the version to display—After, or Before for
   removals—and `fields` that differ) and every relationship
   (`DiffRelationship`, with entity row IDs at both ends; rewired relationships
   split into `<id>:before` removed and `<id>:after` added), plus per-change
   `counts`. Nothing is guessed or matched—identity and status come straight
   from the comparison.
3. **Lay out the union once.** Reuse the same layout as your other modes. Keep
   added and removed items from overlapping, stay close to After's geometry so
   diff and side-by-side feel visually connected, and make the layout
   deterministic. `GraphCanvas` reuses its animation's union layout
   (`GraphTransition.diff`, or `createGraphTransition(…, {diffOnly})` for just
   the union), and file packing packs the union at After sizes.
4. **Mark every changed item.** Spread `changeMark(change)` onto each item's
   `data-entity-id` element to set
   `data-change="added|removed|modified|renamed"` (omitted when unchanged). Kit
   CSS paints HTML `pk-region` elements and SVG `pk-diff-shape` cards/circles
   with a soft fill and matching border (dashed when removed), and strikes
   through muted `pk-diff-text` on removed items. Every `[data-change]` element
   sets `--pk-region-fill`, `--pk-region-edge`, and `--pk-change-ink` for
   descendants and scales with `--emphasis` so turning highlighting off renders
   the union plain. Always pair color with words (an accessible name, status
   footer, or `sr-only` text). Style removed relationships as dashed in the
   removed hue and added ones in the added hue (`edgePaint`).
5. **Show inline field diffs verbatim.**
   - `ValueChange({before, after, layout})` renders the old value struck through
     in a removed pill above (`stacked`, default) or beside (`inline`, with an
     arrow) the new value in an added pill, read to assistive tech as "was …,
     now …". `SvgValueChange` provides the SVG single-line equivalent
     (`pk-svg-was`, `pk-svg-arrow`, `pk-svg-now`).
   - `ChangePills({items, label, onSelect?, selectedId?})` renders added and
     removed list items as `+` / `−` pills with worded changes alongside plain
     unchanged items for context. Pills with an `entityId` are selectable parts.
   - `fieldChanges(before, after, {fields})` and
     `fieldLines(row, {fields, exclude, object})` extract differing fields
     (`formatValue` formats values as extracted; `sameValue` compares
     structurally). With `object`, diffs drill down to changed leaves
     (`leafChanges`: `properties.hardwareProfile.vmSize`,
     `ingress[0].from_port`) instead of printing whole objects twice.
   - Wrap long values instead of truncating them: `wrapText(text, chars)` breaks
     after `_ . / - , :` first before falling back to the character limit and
     never drops characters. `diffCardText` uses it to measure a graph card's
     width (its longest line or the graph's shared `width`) and height.
6. **Avoid nested change colors.** Color only the innermost changed elements so
   containers displaying internal changes stay neutral. Kit CSS handles this
   automatically (see
   [no nested change colors](renderer-kit-components.md#no-nested-change-colors)).
7. **Skip drawing a summary line.** Let the host's summary bar report kind
   counts (using your `nouns`) and domain-specific findings (API compatibility,
   policy coverage, plan actions) via `facts` derived strictly from the
   comparison and documents (see
   [Presentation helpers and components](renderer-kit-components.md#presentation-helpers-and-components)).

Selection, hover, anchors, filtering, and annotations all work in diff mode—keep
`data-entity-id` on every item and make sure the union layout stays responsive
down to 390 px. Automated checks (`diff-changes`, `diff-neutral`,
`diff-clipping`, `stable-layout`, and `nested-accents`) verify all of these.

## Filling the frame

Hosts size renderer frames in two ways: either sizing the frame to the height
your renderer reports, or sizing the frame themselves (for example, filling a
tall tab). These hooks let spatial renderers handle both cleanly:

- `useFrameFill(preferredHeight)` makes the root fill the frame height while
  mounted (`.pk[data-fill]`, a flex column whose child stretches to fill
  remaining space) and reports `preferredHeight` as the preferred content height
  for content-sized hosts.
- `useFrameSizing()` returns the host's `sizing` mode: `content` when the host
  adopts your reported height, `fill` when the host sizes the frame itself, or
  undefined when unspecified.
- `useFitScale(stage, size, {padding, maxScale, minHeight, floor})` returns
  `{scale, width, height}`, centering content of `size` inside the stage element
  with `padding` (16 by default, or `{x, y}` with optional `top`) and scaling
  down to fit both dimensions without exceeding `maxScale` (1). It applies no
  floor of its own (that belongs to `useStageZoom`). In a `content` frame
  (`useFrameSizing()`), it fits width only so the first paint's scale matches
  the final frame height, and calls `useFrameFill` with the width-fitted (or
  `floor` / `useOpeningFloor`) height plus chrome, at least `minHeight` (200)
  unless scaled down to width—so a content-sized view at the floor only pans
  sideways. When a host embeds a content-sized frame inside a scrolling page and
  sends `stage-max-height` (`px` or `vh` from `viewport`), `useStageHeightCap()`
  and `contentHeightCap` cap the requested height so taller content fits the
  capped stage or opens at the floor and pans. It also reports `aspect` to the
  host via `useContentAspect` (which custom-fitted renderers can call directly)
  so side-by-side mode can stack wide content vertically.
  `fitScale(size, stage, options)` exposes the pure math.
- `useStageInset()` reads the host's `stage-inset` token in CSS px (or undefined
  when absent) so renderer content aligns with the host's page column. Kit stage
  padding (`--pk-stage-padding`, used by `ContentView` and `pk-stage`) defaults
  to 12 px when unset; outside the kit, read
  `var(--projections-stage-inset, 12px)`. `GraphCanvas` uses it for horizontal
  padding and for its opening left offset (`contentStart`'s `clear`).
- `useStageInsetTop()` reads `stage-inset-top` in CSS px when a host overlays
  the top of the frame (for example with a pane label chip). Kit stage top
  padding (`--pk-stage-padding-top`) takes the larger of the two tokens so
  content begins below the overlay while the stage background extends behind it;
  outside the kit, use
  `max(var(--projections-stage-inset, 12px), var(--projections-stage-inset-top, 0px))`.
  When fitted, `GraphCanvas` clears a `stage-cover` only where it overlaps
  ([`useCoveredPadding`](../design/utility-area.md)), falling back to this band
  otherwise.
- `useStageZoom(scroller, onAction, fit, {floor, start})` returns
  `{zoom, scale}` where zoom is a multiplier on `fit` (`zoomLimits`), with 1 as
  the minimum so zooming out always stops cleanly at "everything in view." A
  view opens fitted unless that would shrink its smallest text below
  `openingFloorPx` (8 CSS px); in that case it opens at `floor`
  (`useOpeningFloor(root, key)`, measured across all SVG and HTML text in
  `root`, including faded-in items, whenever `key` changes, never while
  scrubbing; pure helper `openingZoom(fit, floor)`), scrolled to `start` (a
  `ScrollStart` like `{x: 0.5, y: 0}` or `contentStart(boxes, bounds, inset)`),
  and lets the user scroll and pan. Passing `opening: {zoom, start}` overrides
  that initial framing (for instance to center on a `focusRequest`; a `start`
  function receives the view size). Until the user zooms or pans, resizes
  recompute the opening view from the new fit; once they interact, resizes
  preserve their zoom multiplier. Transition framing covers both endpoints so
  nothing zooms while scrubbing.

  Fit-to-view returns to 1× fit; zoom in and out scale by 1.5× (clamped without
  skipping fit) up to the larger of 4× fit or 2 CSS px per unit so even tiny
  fits can be read. The hook wires up host `zoomControls` actions (`zoom-in`,
  `zoom-out`, `zoom-fit`), Ctrl/⌘-wheel, and pinch, and preserves the viewport
  center across scale changes via `useScrollAnchor` (which also pins
  not-yet-fitted content to top-left until interaction). Put `data-zoom` on the
  scroll container and draw at `scale`. Inside a content-sized frame with
  `stage-max-height`, the stage avoids hijacking page scroll: it switches to
  drag panning (mouse, pen, horizontal touch drag, or focused arrow keys;
  `data-pan="drag"` hides overflow and `data-pannable` marks oversized content)
  so vertical wheel and touch swipes scroll the page while Ctrl/⌘-wheel and
  pinch still zoom.

  Opening fitted with an 8 px floor is a deliberate product choice. Before
  2026-11-10, any stage whose fit shrank text below 11 CSS px opened zoomed to
  that floor, scrolled to the first row or centered on changes. On 2026-11-10 we
  changed that because opening cropped hides part of the change and forces an
  immediate scroll—every zoomable view moved to opening fully fitted while
  denser layouts kept text legible. Measurements that same day showed that
  always-fit still shrank the largest graphs to 1.6–7 px in a 1000×650 tab and
  2–9 px on a 390×700 phone, so we kept always-fit with an 8 px floor: graphs
  that are legible when fitted open fitted, and only extreme graphs open at the
  floor on their top-left (or top-center) and scroll.

- `usePaintGate(ready)` holds the `rendered` acknowledgement until an async or
  measured layout finishes, ensuring the host only reveals completed frames.

The graph, DAG, architecture, infrastructure, dependencies, dependency
injection, and database schema renderers all fit content to the stage and
declare `zoomControls`; file packing lays out directly at the stage size
(scaling down only when the stage is smaller than its minimum packed area).

## Language and category colors

`categoryPalette(categories, colorMode)` assigns consistent colors across all
built-in renderers, ranking categories across the full document (both revisions)
so a category never changes color between Before and After:

- **Programming and markup languages** use their theme-calibrated GitHub
  Linguist hue from the SDK's languages module
  (`@githubnext/projections/renderer`), so TypeScript is the same muted blue in
  both file packing and code statistics.
- **Other categories** (data, config, prose, assets like JSON, YAML, TOML,
  Markdown, and images) take slots from the categorical palette (`chart-1` …
  `chart-16`)—using their preferred slot when available (so JSON, YAML, and
  Markdown usually stay put) or the first free slot that avoids clashing with an
  active language color.
- **Overflow categories** share the neutral `color-border-emphasis`
  (`otherToken`), reserved exclusively for "other."

Build categories with `fileCategory(path)` (Linguist language grouped by parent,
falling back to `.ext` or "No extension"), `languageCategory(name)` (for
tool-reported language names), or `plainCategory(key)`. Each entry provides
`paint` for CSS and `swatch` for the host legend (`{color}` for languages,
`{token}` otherwise), and `paletteLegend(palette, title)` formats the legend for
the host. Your renderer receives `colorMode` in `RendererProps`.

## Styles

Every visual property comes from the host's theme tokens (token set 0,
`--projections-<name>`, guaranteed by the SDK): colors, categorical palette,
type scale, spacing, radii, borders, shadows, and control/label metrics. Neither
the kit nor renderers built on it should hard-code colors, type sizes, or
shadows—keep only layout geometry (box sizes, coordinates, breakpoints) in code.

`base.css` (included by `react.css`) aliases these tokens under `.pk`:
`--surface`, `--canvas`, `--recessed`, `--overlay`, `--text`, `--muted`,
`--subtle`, `--on-emphasis`, `--border`, `--border-strong`, `--border-emphasis`,
`--accent`, `--focus`, `--hover`, change colors `--green`, `--red`, `--amber`,
and `--violet` (added, removed, modified, moved) with `-soft`, `-border`, and
`-strong` variants, `--highlight` and
`--green-highlight`/`--red-highlight`/`--amber-highlight`/`--violet-highlight`
(fills behind plain text for hover, find matches, and word diffs), `--edge`,
`--graph-bg`, `--dot`, `--chart-1…16` (used in order; tag painted elements with
`data-projections-category="<key>"` and keep a key's color across the whole
transition), `--font-mono`, and `--stroke`/`--stroke-strong` for SVG line
weights (`edgePaint` scales relative to `--stroke`).

Hover and selection rings are drawn once per visual unit and match its shape: a
unit is any top-level entity element or element marked `data-projections-unit`,
receiving a ring inside its border radius. Nested entities (a table column, a
card member) are parts that take a tint rather than an outline, and units clip
their contents to their radius (`overflow: hidden`, `clip-path` as on `Group`,
or SVG clip paths). The harness verifies this on every renderer via
`affordanceFailures` in `packages/renderers/kit/browser/invariants.ts`.
`base.css` also styles change regions (`pk-region` with `data-change`), badges,
status lines and icons, names, identifiers, empty and error states, notices,
legends, content buttons (`.pk-button`), and `[data-projections-hovered]` hover
marks; `react.css` adds generated fields, the graph canvas, diff mode marks, and
the layout components.

Cards, panels, and tables sit evenly inset from all four frame edges in every
host via `--pk-stage-padding` (backed by the host's `stage-inset` token, or 12
px by default). `ContentView` applies this padding automatically; custom roots
should add `pk-stage` (which also paints `--stage`) and keep outer cards
margin-free. When a host overlays the top or foot of the frame
(`stage-inset-top`, `-bottom`), that edge takes the larger of the two values
(`--pk-stage-padding-top`, `-bottom`). Fitted drawings read these insets in
script with `useStageInset()`, `useStageInsetTop()`, and `useCoveredPadding`,
and the `stage-insets` check enforces them across document-style renderers.
