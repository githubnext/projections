---
description: "The renderer SDK: frame protocol, React binding and build"
---

# Renderer SDK

The renderer SDK is everything a renderer needs, and the protocol definitions
the host shares. Renderer authors import it from
[`@githubnext/projections`](../../sdk/README.md): `/renderer` exports every
module below except `/react`, `/vite` and `/notices`, and imports no React;
`/renderer/react` is the React hooks, `/vite` the build, and
`/renderer/icons.css` the icon stylesheet. This directory is the internal
workspace it is bundled from, `@githubnext/projections-renderer-sdk`, by module.
It has no dependency on the host, a design system, GitHub or a bundler at run
time. React and Vite are optional peers.

<!-- prettier-ignore -->
| Entry | Contents |
|---|---|
| `/protocol` | Message types, strict validators, limits, the renderer CSP, `renderer.json` manifest |
| `/client` | `connectRenderer`, `applyEnvironment`, `afterPaint` (framework-agnostic) |
| `/interactions` | `connectInteractions`, `interactionCapabilities`, `hoveredAttribute`, `filteredAttribute`, `annotatedAttribute`, `annotationAttribute`, `pulseAttribute`, `scrollAttribute`, `annotationName` (DOM, framework-agnostic) |
| `/rings` | `connectRings`, `documentRings`, `ringStylesheet`, `unitSelector`, `ringEdgeAttribute`, `ringHoverAttribute`, `ringSelectedAttribute`, `ringFocusAttribute`, `ringWithAttribute`, `ringItemAttribute` (DOM, framework-agnostic) |
| `/react` | `useRenderer` and `useInteractions` hooks |
| `/vite` | `rendererConfig`, `rendererBundlePlugin`, `rendererStyleLintPlugin`, `lintRendererStyles` (Node, build time) |
| `/notices` | Third-party notices from a bundle's module graph, including data vendored under `vendor/<name>/` (Node, build time) |
| `/languages` | GitHub Linguist languages and colors: `languageOfPath`, `languageNamed`, `languageColor`, `linguistRelease` |
| `/presentation` | Deterministic presentation helpers: `presentComparison`, `createFrame`, `filterFrame`, `presence`, `diffEmphasis`, quantities, `viewerReducer`, the summary bar's counts and words (`summaryItems`, `summaryCounts`, `humanizeKind`, `summarySentence`) |
| `.` | `/protocol`, `/client`, `/interactions`, `/rings` and `/presentation` together |

See [packages/renderers/README.md](../README.md) for the package layout and a
walkthrough. Most renderers use the
[renderer kit](../../../docs/guides/renderer-kit.md) on top of the SDK; start
with [develop a renderer](../../../docs/guides/develop-a-renderer.md). The
[renderer SDK guide](../../../docs/guides/renderer-sdk.md) explains the protocol
and the theme, this README each module; the
[renderer SDK API](../../../docs/reference/renderer-sdk.md) lists every export
with its signature.

## Languages

The SDK's languages module (in `@githubnext/projections/renderer`) names files
and languages the way GitHub does, from GitHub Linguist's `languages.yml` at a
pinned release (`linguistRelease`), vendored in `vendor/linguist/` with its MIT
license, which `/notices` adds to every bundle that includes the table.

- `languageOfPath(path)`: by file name (`Dockerfile`, `Cargo.lock`), then by the
  longest known extension (`.d.ts` before `.ts`), with Linguist's choice for
  shared extensions (`.h` is C, `.md` is Markdown).
- `languageNamed(name)`: a name or alias, ignoring case (`ts`, `bash`, and other
  tools' names such as tokei's `C Header`).
- `languageColor(language, colorMode)`: Linguist's color for programming and
  markup languages (a variant takes its group's: TSX is TypeScript), or
  `undefined` for data and prose (JSON, YAML, Markdown), which renderers give
  categorical colors. Each theme's color keeps Linguist's hue, calibrated to the
  Projector theme (`scripts/calibration.mjs`): chroma capped at 0.09 (light) and
  0.092 (dark), lightness in one band per theme (0.56–0.64 and 0.68–0.78 OKLCH),
  then darkened or lightened only as far as 3:1 against the default `color-bg`
  needs. So every category reads as one muted family on the warm canvas and
  stays at most 80% as saturated as the change colors, which always stand out.
  The sixteen most common languages stay at least 0.05 (OKLab ΔE) apart from
  each other and from the neutral "other", the next forty 0.03, by moving
  lightness or hue a little. A light yellow (JavaScript) turns up to 11° toward
  gold in a light theme so it doesn't read as olive. The categorical palette
  uses the same calibration.

`node scripts/linguist.mjs` regenerates the table and `node scripts/palette.mjs`
the `chart-n` tokens (after building the SDK, whose token defaults they read);
`--source <linguist checkout>` reads a local copy of Linguist, and
`--profile softer|stronger` writes a step softer or stronger calibration for
comparison. The kit's `categoryPalette` combines language colors with the
categorical palette.

## Controls

Renderers don't draw their own settings controls. They declare them, and the
host draws them with its design system, sending values back in `options` (keyed
by control `id`) and one-shot actions as `action {id}`. Declare controls in
`capabilities.controls`. When they depend on the document, replace them later
with `client.declareOptions(controls)` (the `controls` message) or the React
`useDeclaredOptions(client, controls, options)`. When the renderer's own content
sets a control too, such as a column heading that sorts, post the new value with
`client.setControl(id, value)` (the `control` message): the host applies it as
if the person had changed it in its settings and sends the new `options`, so the
setting, its menu and an agent reading the controls always agree.

```ts
const controls = defineControls([
  {id: 'measure', label: 'Measure', type: 'choice', default: 'code',
    choices: [{value: 'code', label: 'Code'}, {value: 'files', label: 'Files'}]},
  {id: 'showRelationships', label: 'Relationships', type: 'toggle', default: true},
  {id: 'zoom', label: 'Zoom', type: 'range', min: 25, max: 400, step: 25, default: 100, unit: '%', group: 'zoom'},
  {id: 'fit', label: 'Fit to view', type: 'action', icon: 'fit', group: 'zoom'},
])
const {controlValues} = useRenderer({capabilities: {changeHighlighting: 'supported', controls}, onAction: id => {/* fit */}})
```

Each control has an `id`, a `label`, an optional `description` and an optional
`group` (controls sharing a group are drawn together), named by an optional
`groupLabel` (for example "Packages"): hosts' Settings menus show each group as
a submenu by that name (else the lone control's label, else the group ID), so
give every group a distinct, meaningful one. The host draws the `zoom` group in
its toolbar. A renderer that scales its content should open with all of it
fitted to the stage (never cropped), unless that draws its smallest text below
`openingFloorPx` (8 CSS px, from `presentation`): then it opens zoomed until
that text is 8 px, at the start of its content, and scrolls. Fit returns to all
of it however small, and zooming out reaches it and stops there; the kit's
`zoomControls` and `useStageZoom` do this. (The user replaced an 11 px opening
floor with always fitting on 2026-11-10, then added the 8 px floor the same day,
when always fitting drew large graphs' text at 2-7 px.) Content that reads as a
document (lists, tables, text) keeps its natural size and scrolls instead. The
types are:

- `choice`, with `choices` and a `default`;
- `toggle`, with a `default` boolean;
- `range`, with `min`, `max`, `step`, `default` and an optional `unit`;
- `action`, with an optional `icon` from `controlIcons`.

Declarations are validated strictly: unique IDs, at most 32 controls and 50
choices each, and defaults that are valid values. An invalid declaration is
dropped as a whole. `controlValues(controls, options)` returns each control's
value, falling back to its default.

## Legend

Draw no legend in the frame. Send it to the host, which draws it once beside
every pane (also in side by side and swipe) with its own design system:

```ts
client.legend({title: 'Changes', items: [
  {label: 'Added', token: 'color-added'},
  {label: 'Calls', token: 'color-fg-muted', shape: 'line'},
  {label: 'Inferred', token: 'color-fg-muted', shape: 'dashed'},
  {label: 'Alias', token: 'color-fg-muted', shape: 'dotted'},
]})
```

Prefer theme `token`s, so swatches follow the host theme; `color` accepts
`#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb(…)` and `hsl(…)`. Shapes are `square`
(default), `circle`, `line`, `dashed` and `dotted` (which a host that can't draw
it draws `dashed`). Send it again when it changes, and with no items to clear
it.

## Client

```ts
const client = connectRenderer(handlers, {capabilities})
```

`handlers`: `init(payload)`, `progress({progress, highlighting, direction})`,
`select({id, path?})`, `annotations(items)`, `options(options)`,
`viewport({width, height})`, `environment({theme, reducedMotion, locale})`,
`hover({id})`, `scroll({x, y, key?})`, `action({id})`,
`filter({query, changesOnly, ids})`, all optional. `select` has a `path` key
only when the host selected a property. Messages from anywhere but the parent
window, from another origin or channel, or that fail validation never reach
them. Throws `RendererConnectionError` outside a host frame.

`client`: `rendered(progress)`, `select(id | null, path?)`, `annotation(id)`,
`height(px)`, `steps(ends)`, `open(path, line?)`, `error(message)`,
`hover(id | null)`, `anchor(id, rect | null)`, `viewport({x, y, key?})`,
`declareOptions(controls)`, `subscribe(listener)` (sees every valid host message
after the handlers; returns a stop function), `observeHeight(element)` (returns
a stop function), `dispose()`, `channel`. `select` posts `path` only when given
with an ID, and throws `RendererConnectionError` if it isn't a JSON pointer.
`annotation(id)` reports an activated marker; call `select(id)` first.

`applyEnvironment(environment, element = document.documentElement)` sets
`--projections-<token>` properties for the theme tokens (`themeTokenNames`),
`color-scheme`, `data-color-mode`, `data-reduced-motion` and `lang`.
`afterPaint(callback)` runs after the next painted frame, falling back to a 200
ms timer where browsers pause frames for hidden or offscreen documents.

## Rings

`connectRenderer` draws hover, keyboard focus and selection rings for every
entity (`data-entity-id`) in the frame, as styling on each unit's own element:
one ring per unit (an entity element not inside another, or one marked
`data-projections-unit`). An HTML unit takes an `outline` at a negative offset
equal to its width (it follows the unit's radii, covers its border and isn't
clipped by its `overflow`); an SVG unit restyles the stroke of its shape marked
`data-projections-edge`. The ring is the item's own paint, so it follows any
transform, scroll, zoom or animation on the same frame. Selection comes from
`client.select` and the host's `select`, hover from the pointer and the host's
`hover`, focus from `:focus-visible` inside the unit (whose own outline the ring
replaces). A selected or hovered part rings its unit. Renderers draw no ring,
outline or selection border of their own; the `rings` check fails one that does.
`rings: false` in `connectRenderer`'s options opts out.

The unit (or its marked edge) must be the element that draws the item's visible
edge; the `rings` check names the element to mark when it isn't.

- `data-projections-edge` marks an SVG unit's edge shape;
  `data-projections-edge="line"` a line (a relationship, an arrow), which is
  highlighted as itself, never outlined; `data-projections-edge="fill"` an
  arrowhead or marker path, which takes the color as fill and stroke.
- `data-projections-ring-with="<id>"` adds an SVG piece drawn in another layer
  (an arrowhead over the cards) to its entity's ring.
- `data-projections-ring-item` makes an interactive element that isn't an entity
  (a synthetic aggregate) a unit for hover and focus.
- The SDK sets `ringHoverAttribute` (`data-projections-ring-hover`) and
  `ringSelectedAttribute` (`data-projections-ring-selected`) on the units of the
  hovered and selected entities, and `ringStylesheet(attribute)` is the CSS it
  adds (`style[data-projections-rings]`).

The kit README's
[Item rings](../../../docs/guides/renderer-kit-components.md#item-rings) records
the contract and why rings are styling on the element.

## Interactions

```ts
import {connectInteractions, interactionCapabilities} from '@githubnext/projections/renderer'
const client = connectRenderer(handlers, {capabilities: {changeHighlighting: 'supported', ...interactionCapabilities}})
const interactions = connectInteractions(client, document.getElementById('root')!)
interactions.setSelected(id) // whenever the renderer's selection changes
```

`connectInteractions(client, root, {attribute?, select?})` implements `hover`,
`anchors`, `scrollSync`, `filter` and `annotations` for any renderer whose
entity and relationship elements carry their selection ID in `data-entity-id`
(or `attribute`), the same ID passed to `client.select`:

- Pointer and keyboard focus on an entity report `hover`. The host's `hover`
  sets `hoveredAttribute` (`data-projections-hovered`) on every element of that
  entity inside `root`. The SDK's rings (below) show it on the entity's unit;
  mark the unit with `unitAttribute` (`data-projections-unit`) when its entity
  elements nest, and tint nested parts rather than outlining them.
- A selection that arrives from the host (the person chose the item in the other
  pane of side by side, or in a host view) scrolls that item into view, centred,
  in each scrolling container that hides it (recorded as applied, so scroll sync
  doesn't move the pane the person chose in), and briefly pulses its elements:
  they get `pulseAttribute` (`data-projections-pulse`) for about 900 ms, which
  the controller's own stylesheet draws as a focus-colored drop shadow, so the
  counterpart of a selection is easy to find. A selection made in this frame
  doesn't pulse, and nothing pulses under reduced motion (the media query or the
  host's `reducedMotion`). Hosts draw no connector between panes unless they opt
  in; shared selection styling and the pulse link them.
- The selected (`setSelected`, and the host's `select`) and hovered entities'
  visible rectangles, clipped by scrolling ancestors and the viewport, are
  reported as `anchor` after scrolling, resizing and DOM changes, and only when
  they move.
- Scrolling any container reports `viewport`; the host's `scroll` scrolls the
  matching container without echoing it back. Put `scrollAttribute`
  (`data-projections-scroll="<stable name>"`) on the scroll containers that
  matter so panes with slightly different DOMs still match; others fall back to
  a structural path.
- The host's `filter`: every entity element whose ID isn't in `filter.ids` gets
  `filteredAttribute` (`data-projections-filtered`). Style it to de-emphasize or
  hide those items; kit renderers dim them.
- The host's `annotations`: every element of an annotated entity gets
  `annotatedAttribute` (`data-projections-annotated`) for optional styling, and
  the controller draws a badge for each annotated entity whose element is
  visible (the first one with a visible rectangle). Badges are
  `<button type="button">` elements carrying `annotationAttribute`
  (`data-projections-annotation="<id>"`) in one overlay appended to
  `document.body`, outside `root`, so a framework rendering `root` never touches
  them and they are never counted as entities. Each straddles the top-left
  corner of the entity's visible rectangle, clear of change markers at the top
  right. A renderer can choose another corner per item, or for a container of
  items, with `annotationAnchorAttribute`
  (`data-projections-annotation-anchor="top-left|top-right|bottom-left|bottom-right"`).
  Badges stay inside the item's clipping containers and the viewport, and follow
  the item on the same scroll, resize and DOM-change schedule as anchors; it is
  hidden while the entity isn't visible or is filtered out. It shows the `count`
  (`99+` above 99) or a dot, its accessible name is
  `annotationName(mark, itemName)` (the `label`, or `2 annotations`, or
  `Annotation`, then `on <item>`), and it takes its colors from `tone`, never
  from change tokens: `neutral` is `--projections-color-fg-muted` on
  `--projections-color-bg-subtle` with a `--projections-color-border` outline;
  `attention` is `--projections-color-fg-on-emphasis` on
  `--projections-color-accent-emphasis`; `done` is muted without an outline;
  `subtle` has a dashed outline on `--projections-color-bg`. Focus shows a
  `--projections-color-focus` ring. Clicking it, or Enter or Space while it has
  focus, selects the entity (through `select`, default `client.select`) and
  reports `annotation`.
- Anchors also cover annotated entities while they are visible (at most 200, in
  document order), at a bounded rate (40 per second, bursts of 80) that stays
  within the host's message budget; one that scrolls out of view or loses its
  annotation is reported once as `null`. The selected and hovered entities are
  still reported every frame.

The controller also has `selection` (`{id, path?}`, the latest selection from
`setSelected`, the host's `select` or a badge), `refresh()` (re-measure after
layout it can't observe) and `dispose()` (removes the overlay and its marks).
Declare `interactionCapabilities` (`hover`, `anchors`, `scrollSync`, `filter`
and `annotations`) in `ready` when using it.

## React

```tsx
const {init, progress, selection, options, viewport, environment, client, failure} =
  useRenderer({capabilities: {changeHighlighting: 'supported'}})
```

Connects once, applies the environment (`applyTheme: false` to opt out) and
acknowledges each committed progress after paint (`acknowledge: false` to do it
yourself). Don't wrap the root in `StrictMode`; a renderer connects once.
`selectionVersion` increments for every host `select` message, so a renderer
that selects optimistically can tell when the host repeats a value;
`selectionPath` is the selected property's JSON pointer, when the host sent one.
`hovered` is the host's latest `hover` id and `annotations` the host's latest
`annotations` items (empty until it sends any).

```tsx
const root = useRef<HTMLDivElement>(null)
const renderer = useRenderer({capabilities: {changeHighlighting: 'supported', ...interactionCapabilities}})
useInteractions(renderer.client, root, selectedId)
```

`useInteractions(client, rootRef, selectedId, {attribute?, select?})` runs
`connectInteractions` on the rendered root while `client` is connected and keeps
its selection current. Pass the renderer's own select handler as `select` so
activating an annotation badge also updates the renderer's selection; it must
call `client.select`.

## Build

```ts
// vite.config.ts
import {defineConfig} from 'vite'
import {rendererConfig} from '@githubnext/projections/vite'
export default defineConfig(
  rendererConfig({view: 'src/view.tsx', name: 'flags', title: 'Feature flags', comparisonModes: ['diff', 'side-by-side']}),
)
```

`view` names the module whose `View` export (or default export) is the
renderer's React component; the renderer writes no entry of its own. The build
generates it as a Vite virtual module (`rendererEntryId`, source
`rendererEntrySource`): it imports the kit's React styles (`/react.css`), mounts
`View` with the kit's `mountRenderer` (`/react`) and remounts it in place on a
hot update. Capabilities are declared once, here: `comparisonModes`,
`changeHighlighting` (default `supported`) and `capabilities` (the rest, such as
`drawsRelationships: false`) go into both the generated entry and
`renderer.json`, so the two can't disagree. The view module may also export
`options` (the kit's `ViewOptions`: `nouns`, `facts`, `controls`, `steps`,
`interactions`) for what only code can say.

```tsx
// src/view.tsx
import type {RendererProps, ViewOptions} from '@githubnext/projections/kit/react'
export const options: ViewOptions = {nouns: {flag: {singular: 'flag', plural: 'flags'}}}
export function View(props: RendererProps) {
  // …
}
```

For setups a view can't express (providers around the kit, several components
chosen at run time, a renderer without the kit), give `entry` in place of
`view`: a script of your own that mounts the renderer, declaring the same
`comparisonModes` in its capabilities. `rendererConfig` takes exactly one of the
two, and `changeHighlighting`, `capabilities` and `kit` (the kit the generated
entry mounts with, default `@githubnext/projections/kit`: it imports
`<kit>/react` and `<kit>/react.css`) only with `view`.

`accepts` declares the extractions the renderer presents, written to
`renderer.json`: `[{schema: 'database/v0'}]`, or with a vocabulary the
extraction must declare,
`[{schema: 'architecture/v0', vocabulary: 'dependency-injection/v0'}]`. Hosts
don't send it others, and passing the same list to `useRenderer({accepts})` (or
the kit's `mountRenderer`) types `init` as `AcceptedExtraction<typeof accepts>`:
the extractions with the typed `data` the engine guarantees (see the
[schema reference](../../../docs/reference/schemas/README.md)). An extraction
outside it reaches `failure`, not `init`. Keep the list in one module
(`export const accepts = [...] as const satisfies readonly RendererAccepts[]`)
that `vite.config.ts` and the view (or entry) both import; with `view`, the
generated entry passes it to `mountRenderer`. Omit it for a renderer of any
extraction.

The build lints the renderer's own stylesheets (`lintRendererStyles`, not the
kit's or installed packages'): a `var(--projections-…)` that names no token
fails the build, because its fallback would always apply; hard-coded colors,
font sizes and families and `!important` (except to turn motion off) are
reported as warnings. The renderer checks then measure the result as painted.

Produces `dist/index.html`, one self-contained document (the bundled script as
an inline IIFE, styles inline, every other asset a data URL, plus the `<meta>`
policy), `dist/renderer.json` and `dist/THIRD_PARTY_NOTICES.txt`. The build
fails if anything else would be emitted: the renderer policy grants no source
but inline code, so a renderer can't request any file, not even from its own
bundle.

`THIRD_PARTY_NOTICES.txt` lists every npm package the script includes, taken
from the bundle's own module graph: each package's license files, the copyright
lines of its files and, for licenses such as EPL, MPL and (L)GPL, the elected
license and where its unmodified source is. The build fails when a bundled
package declares no license. Inside this repository,
`@githubnext/projections-renderer-sdk/notices` (Node, build time) exposes the
same helpers (`bundleNotices`, `bundledPackages`, `packageNotice`,
`noticeSections`, `mergeNotices`) for other bundlers.

### Development server

`rendererConfig` also configures `vite` (development), so a renderer package's
`npm run dev` serves it with hot updates to a local Inspector (the fixtures
workbench in a browser, `projections-renderer-workbench`; a VS Code webview
can't reach it, so the extension uses the built bundle):

- `/` is a renderer document loading the entry (yours, or the one generated for
  `view`) as a module, under `rendererDevContentSecurityPolicy(origin)`: the
  renderer policy, plus scripts, styles and assets from the development server,
  a WebSocket to it for hot updates, and a local Inspector's check probe (from
  its loopback origin, named in the frame's fragment). Only loopback hosts are
  served.
- Module requests are allowed from sandboxed frames (origin `null`) and loopback
  pages, never from other sites.
- Dependencies are found from the view or entry at startup (and may inline files
  with `?raw`), because optimizing one found later makes Vite reload the page,
  and a host stops a renderer that navigates its frame.
- `/__projections/renderer.json` is the renderer's manifest, and while the
  server runs, `rendererDevServerFile`
  (`node_modules/.projections/renderer-dev-server.json`) records its URL. The
  runner (`projections serve --stdio`) reads it, and a host page that can frame
  loopback (the renderer workbench, `projections-renderer-workbench`, and
  renderer tests) loads the renderer from the server, both for a projection's
  working tree and for a `--renderer` package in fixtures mode, while it answers
  as the same renderer; otherwise it uses the built bundle. A VS Code webview
  can't frame loopback, so there the built bundle is used: the extension runs
  the package's `watch` script on save while a tab of the projection is open (or
  run `npm run watch` yourself).

The host's sandbox and the protocol are unchanged. An edit remounts the renderer
in place, without reloading the frame: the generated entry accepts its own hot
updates and unmounts on dispose, and `connectRenderer` replays the host's latest
`init`, `environment`, `options`, `viewport`, `select`, `annotations`, `hover`,
`filter` and `progress` to a client that connects again in the same document on
the same channel; the host ignores the repeated `ready`. Edits to CSS update
without remounting.

An `entry` of your own needs no hot update code either: when it calls
`mountRenderer` and doesn't mention `import.meta.hot`, the development server
adds `import.meta.hot.accept()` to it, and `mountRenderer` called again in the
same document unmounts the renderer it mounted before. An entry that handles
`import.meta.hot` itself is left as it is; one that mounts without
`mountRenderer` reloads the frame on an edit, as Vite does by default.

## Presentation helpers

Pure interaction and presentation state, without a DOM.

- `presentComparison(before, after, comparison)` expands a comparator-produced
  comparison into before/after pairs, including splits and merges, and resolves
  its `steps` (and explicit `reverseSteps`) to those rows. It never matches,
  normalizes or compares entities; identity comes only from the comparison. Each
  row keeps the change's `varied` (volatile values that differ between the
  sides). A change that varied only within tolerance is `unchanged`, in no step,
  and presents nothing: `variedWithin(row)`. A `modified` change with a value
  beyond tolerance is `variedBeyond(row)`, which presentations mark with the
  neutral `varied` icon (`variedBeyondLabel` names it). `variedName(path)` and
  `variedValue(item, path)` read a varied path for display, and
  `variedWords(within)` says `within tolerance` or
  `beyond tolerance (volatile)`.
- **Comparison steps, by default.**
  `createFrame(after, changes, progress, {direction?, schedule?})` follows the
  comparison's order: every entity and relationship fades, switches version and
  crossfades a rewiring only inside its own step's window, so a custom
  comparator's order is what plays, and relationships never outlive their
  endpoints. Each item carries `local`, its progress through its own step, and
  the frame carries `staged` (the share of steps whose motion has completed, for
  motion many items share, such as a layout) and the `schedule` it was timed by.
  Within a step, leaving items fade out first, shared motion happens in the
  middle and arriving items fade in last (`stepPhases`, `phaseProgress`,
  `presence(change, local)`).
- **Holds.** Host playback is continuous, so shapes settle between steps while
  progress keeps moving: `scheduleSteps(changes, direction)` places each step in
  a motion window and keeps a hold (`stepHoldShare` of each step's slot) between
  windows. Report `stepEnds(schedule, direction)` with `client.steps`; each end
  is the middle of a hold, so a host's Previous and Next step land on settled
  frames. Under an explicit reverse order, keep one `DirectionLatch` per
  document and pass its direction. `stepProgress(step, progress)` is a step's
  local progress, `stepHolds(schedule)` the still intervals, and
  `compileTimeline(steps)` the underlying placement. The renderer kit re-exports
  these.
- `diffEmphasis(progress)` is the curve hosts use for `highlighting`.
- `relationshipLabel(relationship, entityLabels(extraction))` names a
  relationship for people: its own `label`, else its endpoints' labels with a
  unicode arrow and the kind when it says something ("API → Orders queue
  (publishes)"). Hosts and the kit use it for text, table and accessible names;
  use it rather than showing a relationship's ID.
- `viewerReducer` holds renderer-local search, filters, expansion and
  code-statistics options.
- Quantity helpers (`entityQuantity`, `quantityAt`, `quantityDomains`,
  `quantityGeometry`, `statisticsRows`, `quantityShares`) keep zero-anchored
  scales per unit and distinguish missing values from zero. `statisticsRows`
  reads each language at its own step and in `options.scope`: `all` files,
  `tests` (`testFiles`, `testCode`, `testComment`, `testBlank`, `testLines`) or
  `other` (the total minus tests); `statisticsCount(entity, key, scope)` and
  `hasTestCounts(entities)` expose the same.
