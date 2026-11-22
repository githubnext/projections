---
description: Tests renderer bundles against scenarios in the real host
---

# Renderer testing

`@githubnext/projections/testing` tests a renderer bundle against its scenario
fixtures in the real Projections host frame. It starts the fixtures workbench
(`projections serve --stdio --fixtures`, which has no listener, behind a
loopback page in the test process that mounts the CLI's own Inspector assets),
opens its stage page in Playwright, and runs the built-in renderer checks there:
the same checks as the Inspector's **Checks** panel, implemented once in this
package. This directory is the internal workspace it is bundled from,
`@githubnext/projections-renderer-testing`; renderers scaffolded by
`projections init --renderer custom` run it with `npm test`.

```sh
npm install --save-dev @githubnext/projections @playwright/test
```

The tests run the native `projections` CLI: put it on `PATH` (a dev dependency
on the CLI package does that under `npx`) or set `PROJECTIONS_CLI`. Node and
Playwright are needed for the tests only; the CLI and your renderer don't need
them.

## Check every scenario

```ts
// browser/renderer.spec.ts
import {expectScenarioToPass, scenarioKeys, test} from '@githubnext/projections/testing'

// One Inspector per Playwright worker, serving the bundle and scenarios.
test.use({projections: {fixtures: 'scenarios.json', renderers: '.'}})

for (const key of scenarioKeys('scenarios.json')) {
  test(`${key}: built-in renderer checks`, async ({page, inspector}) => {
    await expectScenarioToPass(page, inspector, key)
  })
}
```

`renderers` is a bundle directory (`index.html` and `renderer.json`) or a
package whose `package.json` names one in `"projections": {"renderer": "dist"}`.
Build the bundle before the tests. The checks:

- `neutral-endpoints`: At progress 0 and 1, every entity is painted as in an
  unchanged comparison of that revision. Parts marked
  `data-projections-category="<key>"` paint a categorical colour: a palette
  ranked over both revisions is allowed, as long as each key keeps one colour
  from Before to After.
- `step-holds`: Around each reported step end, and 250 ms later, nothing moves,
  fades or repaints.
- `highlight-scope`: After each step, only entities that step or an earlier one
  changed (or a unit's changed parts) are emphasized.
- `diff-changes`: In diff mode every changed entity is drawn, and drawn
  differently from how an unchanged comparison of its revision draws it.
- `diff-neutral`: In diff mode, entities no change touches are painted exactly
  as in an unchanged comparison.
- `diff-clipping`: In diff mode, at full and phone width, no element cuts off
  its own content (`overflow` hidden or clip with more content than fits).
- `affordances`: Host hover, selection and keyboard focus draw inside their
  unit; nested parts are tinted, not outlined; SVG elements never take an
  outline; focus always changes what is painted.
- `rings`: Hover, selection and keyboard focus ring each unit as styling on its
  own element (an outline inside an HTML unit, the stroke of an SVG unit's
  `data-projections-edge` shape), and the unit owns the item's visible edge: no
  wrapper around it, no edge drawn outside its box, no positioned descendant
  painting over its ring, a row's corners take its group's inner radius, no
  second edge a few pixels inside or around it, and no ring of the renderer's
  own. Each failure names the element to mark or the change to make; in the
  default mode and, when offered, the diff.
- `legend`: No legend in the frame (`data-projections-legend`, `.kind-legend` or
  a region labelled as a legend): the renderer sends it to the host
  (`client.legend`), and what it sends is the same at progress 0, 0.5 and 1.
- `summary`: When the renderer sends a `summary` for the host's summary bar,
  each count figure's `count` (and in a comparison its `added`, `removed` and
  `modified`) equals the documents' own for its kind (`summaryCounts`). A fact
  figure's count is the renderer's, but every ID it filters to (`ids`) exists in
  the documents, one extraction's facts carry no changes, and its `added` and
  `modified` are part of its `count`. The summary describes the whole document,
  so a renderer with a timeline sends the same one at progress 0, 0.5 and 1.
  Skipped when it sends none.
- `phone-overflow`: At 390 px the document never scrolls sideways (at progress
  0, 0.5 and 1).
- `selection`: Clicking an entity reports it; the host's selection is shown and
  can be cleared.
- `stable-layout`: Change status appears in reserved space: at 0, 0.25, 0.5,
  0.75 and 1 (animated; the endpoints for two-pane modes) and in the diff, every
  entity has the same box with highlighting on and off.
- `status-text`: While a change is emphasized (in the diff, after its step, or
  in its endpoint pane), its entity states its status as text (Added, Removed,
  Modified, Renamed or Moved), visibly or for assistive technology.
- `quiet-endpoints`: At both endpoints, with the default highlighting, no entity
  shows status text.
- `content-top`: The renderer draws no header of its own (the host owns title,
  schema and counts): its first entity, outermost SVG canvas or region marked
  `data-projections-content` (content that isn't an entity: an axis, a table
  head, a summary) starts within the stage padding of the frame top (the host's
  `stage-inset`, else 12 px, or its `stage-inset-top` where that is more), at
  full and phone width.
- `stage-insets`: The cards, panels and tables a renderer stands on its stage
  (outermost elements with a border on all four sides or a filled surface that
  isn't the stage) sit evenly in the frame: the space between their union and
  the frame's top, left and right, and the end of the content, is the same
  within 1 px, at full and phone width; where the host overlays the frame's top
  (`stage-inset-top`), the top is the larger of that and the other sides' inset.
  Pad the content root by the stage padding on all four sides (the kit's
  `ContentView` or class `pk-stage`, else
  `var(--projections-stage-inset, 12px)`) and give the outer cards no margins.
  Skipped for a renderer that centres a fitted drawing (a zoomable canvas,
  `data-zoom`, or a kit renderer that fills its frame) and for one that stands
  no cards on its stage.
- `opens-fitted`: A renderer whose canvas zooms (a scroll container marked
  `data-zoom`) opens fitted in a frame of fixed size (full width by 650 px, and
  390 by 700 px, as a tab or a phone shows it): in the diff and its first
  progress mode at both ends, or for one revision, it opens at zoom 1 and every
  entity it draws (`data-entity-id`, `data-graph-synthetic`) lies inside the
  visible canvas, so nothing needs scrolling to be seen; or, when fitting would
  draw its smallest text below the 8 px opening floor (`openingFloorPx`), it
  opens zoomed so that text is 8 px (not further: at most 1.25× that, since the
  floor also counts text that fades in later, nor when the fitted text would be
  8 px or more), with the start of its content (the top row's leftmost entity,
  by its top-left corner, or the top centre of that row for a centred layout) in
  view when it opens. A diff may open on its changes (`data-change`) instead: at
  least one in view, text no smaller than the floor, and zoomed past it only
  when every change is wholly in view. Opening text below 8 px fails unless all
  of the content fits. The smallest text it draws, in CSS px at the scale it is
  drawn, is reported in the result. Skipped for document-style renderers (lists,
  tables, text), which have no zoomable canvas and scroll naturally.
- `relationships`: When the extraction has relationships between entities the
  renderer draws, it draws at least one, marked with the relationship's ID in
  `data-entity-id`, unless it declares `drawsRelationships: false` (it
  deliberately draws none, or shows them only as structure such as nesting).
  Only the relationships the presentation draws count: a `relationships`
  renderer option naming one kind (as the built-in graph renderers'
  **Relationships** takes) expects that kind alone, and
  `showRelationships: false` expects none.
- `identifiers`: Every visible element marked `data-projections-identifier`
  (code identifiers and symbols: names, paths, routes, event names, IDs)
  computes a monospace font, at full and phone width; skipped when none is
  marked.
- `palette`: Every painted color (text, backgrounds, borders, outlines, shadows,
  SVG fills and strokes) is a theme color token in both light and dark mode: the
  token, the token faded toward transparent, or one mix of two tokens in the
  same proportion in both modes. Parts marked `data-projections-category` follow
  the category palette (`chart-*`). A hard-coded color can't match the theme in
  both modes.
- `stage-surface`: The field the renderer paints behind its content, sampled 2
  px inside the frame's top corners and halfway down its sides (in the diff, or
  at progress 0.5, at full width, in light and dark), is the stage
  (`color-surface-canvas`, the kit's `--stage`), or transparent so the host
  frame's stage shows: never a lighter page such as `color-bg`. Cards and panels
  stand on it in `color-surface-raised`.
- `type-scale`: Text uses a font-size token (or 11 px, the floor; never
  smaller), the theme's text or monospace family, and a font-weight token.
- `spacing`: Padding, margins and gaps are on the space scale (or a 1–2 px
  hairline; auto margins and percentages are layout, not spacing); corner radii
  are radius tokens, one less a 1–2 px border, or fully rounded; border widths
  are border-width tokens.
- `nested-accents`: Change and accent colors never nest: an element whose
  background or border (an SVG shape's fill or outline) is a change hue or the
  accent contains, or has drawn over it inside its shape, no other element
  painted in one, text and lines included. An item's own status words, icon and
  marks in its own hue are allowed. Checked in the diff and after the
  animation's steps (or at progress 0.5), with the host's highlighting on.
- `link-routes`: Every link a renderer routes between cards (marked
  `data-projections-route`) goes around the cards in its way. When none can, the
  renderer draws the route that overlaps them least, marks it
  `data-projections-route="crossing"` with the cards it crosses in
  `data-projections-route-crosses`, and this check reports it. Checked in the
  diff and at the end of the animation; skipped for a renderer that routes no
  links.

The styling checks (`palette`, `type-scale`, `spacing`) measure the diff and,
with a progress mode, progress 0.5, at full and phone width (`palette` in light
and dark). A subtree marked `data-projections-off-system="<reason>"` (say, a
data-driven heat map) is left out of them; the result lists each exemption with
its reason, so a review sees it. The SDK's style lint
(`@githubnext/projections/vite`) reports the same problems in the renderer's own
CSS at build time.

Checks follow the comparison modes the renderer declares
(`capabilities.comparisonModes`): `neutral-endpoints` runs when it declares a
progress mode (`animated`, `side-by-side` or `swipe`), `step-holds` and
`highlight-scope` only with `animated`, and the `diff-*` checks only with
`diff`. `affordances`, `rings`, `legend`, `summary` and `selection` present a
comparison in the renderer's default (first) mode; `phone-overflow` checks every
declared mode.

Entities are elements with `data-entity-id`; emphasis is measured by comparing
painted styles, so the checks need no knowledge of your class names. A check
that doesn't apply (no steps, a single extraction) is skipped with a reason.

## Rings in pixels

`ringGeometry(frame, id, {focused?})` reads a unit's ring geometry (an HTML
unit's border box and radii, or an SVG unit's marked edge), and
`ringPixelReport(page, frame, geometry, {ring, clear, offset})` compares a
picture of the item with the ring shown and hidden (for example with the SDK's
`style[data-projections-rings]` disabled) along lines across every side and
corner: the ring must start where the item's painted edge starts (within 0.5 CSS
px plus half a device pixel; an SVG ring, the edge's own centered stroke, may
reach half its extra width further out), cover the whole edge band and show on
every line. Only what is drawn where the item's geometry puts its edge counts as
that edge, so neighbors, sub-pixel borders of zoomed-out items and labels drawn
over an outline aren't mistaken for it: a ring may break where the item's own
edge is hidden too (a side hidden at every line isn't measured), a dashed ring
may show only on some lines, and an item under 16 CSS px across (`tinyRingItem`)
need only be ringed. Use them for a renderer's own pixel tests; the harness runs
them for every built-in renderer and an adversarial fixture, and checks that a
ring inside or outside its item is still named.

## Optical alignment

`opticalInsets(page, {surface, ink})` measures how far a label's text (`ink`)
sits from the painted edge of the pill or chip behind it (`surface`, which may
match several elements painted as one, such as a fill and a hover tint), on each
side, in CSS px, from rendered pixels rather than box metrics: pictures with and
without the text give its glyphs' bounds, and without the surface's paint too,
the surface's; antialiased edges count for the part of them that is covered. To
align a pill optically, give it a label that starts with a capital E and ends
with a capital H and check that the space above the E, below it, left of its
stem and right of the H's right stem match. Take it at a device scale of 2 or
more, and divide by the drawing's own scale when it is zoomed or fitted.

## Corners in pixels

`cornerReport(page, target, {label, frame})` checks a bordered box's rounded
corners in pictures of them: the border keeps its thickness around each curve,
within a quarter CSS px plus half a device pixel of its sides (or between them,
where the sides differ), no third color shows in it and no paint shows outside
the curve. That is what a filled band in a rounded container breaks when it
isn't concentric with it: a header, footer or last changed row with square
corners covers the inside of the border's curve, and one with the container's
own radius pokes out past it. Nested radii are the container's less the inset.
The `target` is a locator (an element's border box, radii and solid borders, its
solid outline where it has no border, or an SVG `rect`'s stroked outline, read
by `cornerBox`) or a `CornerBox` of your own. For a frame its contents draw (a
data table's scroll box, whose heading and rows draw its lines), pass `frame`,
the line's width; each corner is measured where its sides are painted, since a
browser may snap a border to whole pixels, and a box taller than the view is
scrolled for its top and then its bottom corners. Dashed outlines and corners no
larger than their border are skipped. Take the page at a device scale of 2 or
more; failing corners' pictures come back in `pictures`, to attach.

## Your own assertions

```ts
import {expect, openStage, samples, test} from '@githubnext/projections/testing'

test('cards never overlap while scrubbing', async ({page, inspector}) => {
  const stage = await openStage(page, inspector, {scenario: 'service-map/payments-split', progress: 0})
  await stage.scrub(samples(40, {roundTrip: true}), async progress => {
    const boxes = await stage.frame.locator('[data-entity-id]').evaluateAll(/* … */)
  })
})
```

- `startInspector({fixtures, renderers?, cli?, port?, cwd?, env?})` starts the
  workbench and resolves with `{url, page(query), close()}`; the `test` fixture
  `inspector` does this per worker from the `projections` option.
  `connectInspector(url)` wraps one started elsewhere. The page answers only its
  own loopback address (`127.0.0.1` or `localhost` and its port) and relays the
  runner's request paths (`/api/`, `/renderers/`, `/custom-renderers/`,
  `/inspector/`) to the backend, keeping the renderer content security policy
  the backend sets.
- `openStage(page, inspector, request)` presents `{scenario}` (a key
  `<source>/<id>`, or a unique ID, with its comparator and presentation) or
  `{renderer, extraction}` /
  `{renderer, before, after, comparison?, comparatorOptions?}` (compared in the
  page with the default comparator). Optional: `comparisonMode` (`'diff'`
  presents one static comparison and sends no progress), `progress`,
  `direction`, `highlighting` (`'auto'`, `'off'` or a number), `selection`,
  `options`, `colorMode`, `reducedMotion`, `locale`, `pane` (`'before'` or
  `'after'`: one held pane of side by side or swipe, as a host presents it at
  progress 0 or 1), `width`, and `height` (a fixed frame height the frame fills,
  as a tab or pane gives one; by default the frame follows the height the
  renderer asks for). It resolves once the renderer has painted. In WebKit,
  which keeps every removed frame until its page navigates, it reloads the stage
  page after it has started 8 frames, so a spec that loads many scenarios in one
  page stays bounded in memory; page state from before is gone. `checkScenario`
  likewise runs WebKit's checks three at a time, each batch in a fresh stage
  page.
- The handle: `frame` (the renderer document), `iframe`, `subject`,
  `seek(progress, options?)` (resolves after the renderer acknowledges that
  exact progress), `scrub(progresses, check)`, `select(id)`, `hover(id)`,
  `setOptions`, `action(id)`, `setEnvironment`, `setWidth(px | null)`,
  `measure(call)` (a probe measurement in the renderer document) and `state()`
  (`{bundle, capabilities, progress, rendered, steps, selection, selections, controls, errors, rejected, …}`).
- `checkScenario(page, inspector, key, {checks?})` returns the results;
  `expectScenarioToPass` asserts that none failed; `checkFailures(results)`
  formats failures. `scenarioKeys(path)` lists a file's keys, and
  `samples(n, {roundTrip})` makes evenly spaced progress values.

Inside this repository, the internal workspace's browser-safe entry
(`@githubnext/projections-renderer-testing`, which the Inspector uses) exports
the checks (`runChecks` over a `CheckDriver`), their titles and the in-document
measurements, such as `affordanceFailures`, which you can also pass to
`frame.locator('body').evaluate`.

## The workbench in a browser

```sh
npx projections-renderer-workbench --fixtures scenarios.json --renderer .   # prints its URL; npm run workbench in a scaffolded renderer
```

opens the same fixtures workbench as **Projections: Open Renderer Scenarios…**
in VS Code, in any browser: the Explorer lists the scenarios, the main view
presents them in every comparison mode with viewport presets, the **Checks**
panel runs these checks, and a changed scenario, fixture, comparator file or
bundle reloads. While the package runs `npm run dev`, the renderer loads from
its development server with hot updates (a VS Code webview can't frame loopback,
so it uses the built bundle). `--port N` picks the port; `--cli` the executable.

## How it works

In fixtures mode the Inspector injects a small probe (`./probe`, built from
`src/probe.ts`) into every renderer document it serves. The checks drive a stage
(a `RendererFrame`, as hosts use) through the renderer protocol and measure the
document through the probe over a `MessagePort`. The probe is never injected
outside fixtures mode.

This package depends only on the SDK's protocol types and the schemas, so
renderer packages can use it without a workspace cycle.
