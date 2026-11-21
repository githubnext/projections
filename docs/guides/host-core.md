# The host's headless core

If you want to embed Projections inside your own design system—or expose only a
slice of the controls—start with the headless core. It manages playback,
filtering, selection, and sandboxed renderer frames without dictating any chrome
of its own:

```tsx
import {ProjectionStage, loadRendererCatalog, resolveRenderer, useProjection} from '@githubnext/projections-host'

function Review({subject, renderer}) {
  const projection = useProjection({subject, projection: {id: 'deps', title: 'Dependencies'},
    renderers: renderer ? [renderer] : [], mode: 'side-by-side'})
  return <>
    <input aria-label="Find" value={projection.search} onChange={event => projection.setSearch(event.target.value)} />
    <p>Selected: {projection.selectedRow?.label ?? 'nothing'}</p>
    <ProjectionStage projection={projection} labels={{before: 'Base', after: 'Head'}} />
  </>
}
```

Calling `useProjection(options)` returns a `ProjectionController` containing
three groups of fields:

- **Controlled or uncontrolled state.** Every setting can be controlled (pass a
  value plus its `on…Change` handler) or left uncontrolled (optionally seeded
  with `initial…`). This applies to `position` (or `progress`), `playing`,
  `loop`, `holds`, `speed`, `mode`, `swipePosition`, `highlighting`,
  `changesOnly`, `variedOnly`, `regeneratedOnly`, `summaryFilter`, `search`,
  `selectedId`, `rendererName`, and `controlValues`.
- **Derived state:**
  - `rows`, `visibleRows` (filtered by find, "changes only", "varied only",
    "regenerated only", and the summary filter), and `selectedRow`.
  - `summary`, the list of `SummaryFigure` entries for the summary bar: one
    figure per extraction kind with its total (in `after` for a comparison) and
    `added`, `removed`, and `modified` counts (`summaryFigures`). Wording,
    ordering, and included kinds come from the renderer's `summary` message (the
    after pane's in two-pane modes); renderers that send none (such as version 0
    bundles) fall back to `humanizeKind` (`depends-on` → dependencies,
    `devDependencies` → dev dependencies), merging kinds with identical names
    into one figure. Any renderer facts follow as sent, complete with deltas and
    `description`. `figuresSentence` formats the whole bar into one line, such
    as `12 workspaces +1 −1 · 18 dependencies +2 · 18 major upgrades`, and each
    row preserves its change's `varied` volatile diffs.
  - `variation` (`{within, beyond, regenerated}`, or `undefined` when nothing
    varied) counts unchanged items with non-generated volatile values within
    tolerance, modified items with volatile values beyond tolerance, and
    unchanged items whose [generated values](../design/generated-values.md) were
    reworded from an equal basis (`regenerated`, from the SDK). Relationship
    rows without their own label are named from their endpoints via
    `relationshipLabel` (for example "API → Orders queue (publishes)", marked
    `derivedLabel`), omitting the raw ID in descriptions.
  - `notices`, `rendererErrors`, `rendererStatus`, and per-pane `panes`.
  - `renderedProgress`, `stepEnds`, `nextStep`, and `previousStep`.
  - Resolved `theme`, `themeStyle`, `colorMode`, and `reducedMotion`.
  - Compatible `renderers`, declared `controls`, `durationMs` (at the current
    speed), and `baseDurationMs` (at 1×).
- **Actions:** `seek`, `play`, `pause`, `toggle`, `stepForward`, `stepBack`,
  `setSpeed`, `setMode`, `setSwipePosition`, `setHighlighting`,
  `setChangesOnly`, `setVariedOnly`, `setRegeneratedOnly`, `setSearch`,
  `select`, `hover`, `setRenderer`, `setControl`, `runAction`, and `openSource`.

`ProjectionStage({projection, labels?, paneLabels?, hidden?, stackBelow?, renderStatus?, legend?, fill?})`
mounts and coordinates the sandboxed frames for the active comparison mode:

- **Animated** renders a single frame.
- **Side by side** mounts before and after panes, each titled by a slim header
  band above it (band surface with a divider rule) so labels never cover
  content. Each frame receives `pane` in its environment to suppress transition
  captions. Panes sit side by side or stack vertically (Before above After)
  depending on which yields the larger fitted view: `paneArrangement` compares
  both using the renderer's reported `aspect` (width / height across the
  transition) with a 15% hysteresis (`arrangementHysteresis`) so minor resizes
  or scrubbing never flip the layout; widths below `stackBelow` (640px) always
  stack. Selection and hover sync across both panes—selecting in one pane
  scrolls the counterpart into view if needed and briefly pulses it
  (`data-projections-pulse`, ~900 ms, disabled under reduced motion)—and
  annotation badges appear in both. Cross-pane connectors are **off by default**
  with no built-in toggle; hosts opt in via the `connector` prop (`connector`,
  `initialConnector`, `onConnectorChange`, `setConnector`) to draw a line
  between the selected item's anchors.
- **Swipe** stacks both panes behind an accessible divider, placing the before
  label at the top left and the after label at the top right above both layers.
- **Diff** mounts one frame with `comparisonMode: 'diff'` in `init` and sends no
  `progress` messages, except `{progress: 1, highlighting: 0}` when highlighting
  is toggled off (and full highlighting when toggled back on).

Renderers declare their supported modes in `comparisonModes` (both in `ready`
capabilities and `renderer.json`), defaulting to animated, side by side, and
swipe. The controller exposes these as `availableModes` and ensures `mode` is
always valid—if a requested or controlled mode is unsupported (including after a
renderer switch), it falls back to the renderer's default mode and notifies
`onModeChange`. Omit `mode`/`initialMode` to start in that default. The core
exports `clampMode`, `twoPaneMode`, and `defaultComparisonModes`. Built-in UIs
display only `availableModes` in the renderer's order, hide the mode switch when
only one mode exists, and show playback, loop, and speed controls only in
animated mode.

To avoid unnecessary reloads, the after pane stays mounted across mode switches
(becoming the animated frame and back), so switching modes loads at most the
before frame. Switching revision pairs reuses the existing frames and sends a
fresh `init`. Each frame stays transparent behind its loading status until its
first `rendered` message (`PaneState.status` transitions to `ready`), preventing
unthemed flashes.

**Legend.** Renderers can emit a `legend` (`legend {title?, items}`) instead of
drawing one inside each pane. The controller surfaces it as `legend` (from the
after pane in two-pane modes), and the stage renders it once below the panes
(outside swipe layers) on `color-surface-raised` with a `color-divider` edge and
theme-resolved swatches (change fill swatches `color-<change>-muted` or
`-highlight` automatically pick up their matching `color-<change>-border` edge).
Pass `legend={false}` to render `projection.legend` yourself, or reuse
`ProjectionLegend`.

**Filling a container.** Pass `fill` so the stage fills its container's definite
height; side-by-side panes share that height (stacking on narrow widths) and
frames scroll internally rather than expanding to the renderer's reported
height.

Because the stage is styled inline with theme tokens, the core needs no
stylesheet. You supply revision labels from the consumer and choose how they
appear. `paneLabels: 'chips'` overlays a quiet 28px chip on each pane's stage
without consuming vertical height (top-start in side by side, top-left and
top-right in swipe, none in single-frame modes), inset evenly from the frame's
top and side edges in the utility bar's fill, border, radius, and muted text
(`--ph-utility-*`), with the revision name in regular monospace and its commit
subject in the text face (the age sits in the tooltip). The stage sends each
covered frame `stage-cover` (the covered rectangles in frame coordinates) and
`stage-inset-top` (plus `stage-inset-bottom` for `foot` overlays at the stage's
bottom) so renderers keep content clear of overlays. You can restyle chips
individually with `--ph-pane-chip-bg`, `--ph-pane-chip-border`,
`--ph-pane-chip-radius`, `--ph-pane-chip-fg`, and `--ph-pane-chip-name`, or set
`paneLabels: 'hidden'` when your host names revisions elsewhere; either way, the
labels still name each pane for assistive technology.

In single-frame modes (animated, diff), `utility` places controls in a floating
bar over the stage's top edge—inset from the sides and sized to its content—
instead of adding a toolbar row above the stage. The stage measures whatever it
overlays (bar or chips) and sends the same two tokens so the frame clears it
while still panning or scrolling underneath; the default UI's `utilityArea` uses
this for playback with chips for labels (see
[the design note](../design/utility-area.md)). Pass `renderStatus` to customize
loading and error states (or `null` to render `rendererStatus` and
`rendererErrors` yourself). While one pane loads, its status centers over that
frame; while both panes of side by side or swipe load, a single status covers
the whole stage (rendered for side `main`).

`LoadingStatus({label, description?, reducedMotion?, fill?})` is the shared
loading indicator across frames, explorer comparisons, and engine startup: a
spinner and short label centered inside the space the content will occupy
(filling it, or using a 480 px starting height when `fill: false`) so nothing
jumps when content loads. It uses a polite `role="status"`, stops spinning under
`reducedMotion` or `prefers-reduced-motion: reduce`, and can be restyled via
`--pj-loading-color` and `--pj-loading-font-size` (re-exported by the default
UI).

`ProjectionsPane({items, current, onChoose?, onClose, label?, autoFocus?, footer?})`
renders a surface's projection list as a durable side pane for hosts that offer
"Pin projections pane" at the end of their projection menu. It's a `nav`
landmark (`label`, "Projections") sized to `paneWidth` (240 px) with a trailing
border, a `paneHeaderHeight` header matching the toolbar row with a close button
that returns to the menu, and one button per projection
(`{id, title, detail?, status?}`) with the `current` entry marked
`aria-current="page"`. Setting `autoFocus` moves focus into the pane when pinned
or re-enabled (replacing a focused menu), without stealing focus on reload. The
component lives in `/ui`, while its headless state comes from the package root
so custom UIs can render their own pane: `usePinnedPane(key)` persists pinned
state in `localStorage` per surface, and `usePaneRoom(element?)` tracks whether
the surface (or `element`) is at least `paneMinWidth` (900 px) wide with
hysteresis. Only offer the pane when there are multiple projections and enough
room, falling back to the menu otherwise—both the viewer page and the Copilot
canvas use it.

For choosing before and after revisions,
`useComparisonPair({extractions, engine, renderers, loadComparator?, runComparator?, customRenderer?})`
provides the headless pair picker. It returns:

- Selected `before` and `after` extractions.
- Current `outcome`, `subject`, and `subjectLabels` (keeping the previous
  subject visible while a new pair computes).
- Renderer `resolution`, compatible `renderers`, and the definition's
  `presentation` defaults.
- Actions: `setBefore`, `setAfter`, `swap`, and `retry`.

Comparisons run in the browser using the projection's comparator, with failures
surfaced explicitly. Companion helpers (`subjectRows`, `rowItems`,
`describeChange`, `rowStatusCounts`) feed table, text, and detail views.

**Detail card.** Call `rowDetails(subject, row, rows, limits?)` to build the
structured content of a detail card without any UI coupling:

- `parts` breaks the change into hue-and-word tokens (`changeParts`: "Renamed"
  in the moved hue, followed by "Added", "Removed", or "Modified"), alongside
  comparator classification `tags` and `summary`.
- `fields` lists changed fields as text pairs (`before`, `after`, omitting unset
  sides): identity (for renames, splits, and merges), then `label`, `kind`,
  `from`, `to`, and each `data` key with its property `path` and `side` (in a
  single extraction, all set fields unchanged). Volatile fields listed in
  `varied` are excluded.
- `generated` lists the item's [generated values](../design/generated-values.md)
  (`GeneratedField`) first, with `path`, `name`, `before`, `after`, comparison
  `entry`, and both sides' `bases`. `generatedForm(field)` classifies each as
  `plain`, `regenerated` (same inputs), or `changed` (with prose reason and
  string word diff), and `GeneratedList` renders them with the Generated mark.
  Generated values and their bases are excluded from `fields` and `varied`.
- `varied` lists differing volatile values (`VariedField`): `path`, `name` under
  `/data/`, `before`, `after`, `within`, `words` (`within tolerance` or
  `beyond tolerance (volatile)`), and `reason`. `variedText(field)` formats one
  line (for example `durationMs 120 → 135 · within tolerance`).
- `evidence` lists after-side source locations followed by before-side files not
  present on the after side (`{path, line?, side}`).
- `connections` lists an entity's outgoing then incoming relationships (changed
  first, with `rowId` pointing to the relationship), or a relationship's `from`
  and `to` endpoints (with `rowId` pointing to the entity), each with change
  parts.

`changeTags(subject, rowId)` reads standard comparator metadata—
`metadata.compatibility.changes[id].level` (api-compatibility: "Breaking",
"Additive", "Compatible") and `metadata.runtimePolicy.interpretations[id]`
(runtime-policy: "Scope broadened", …)—ignoring anything malformed.

`useDetailCard(projection, {container, view?, enabled?, sheetBelow?})` returns
`{row, placement, style, ref, close, select}` for building a floating detail
card over `container` (a positioned wrapper around the stage, table, and text
views). Whenever a row is selected, `placeDetailCard` positions the card beside
the item's anchor (`anchorFor`, or the selected `button[data-row-id]` in table
or text views)—preferring right, then left, below, or above, shifted to stay
inside the visible container (or falling back to top-end when unanchored, and a
full-width bottom sheet below `sheetBelow`, 640px). It tracks the anchor across
scrolling, playback, resizes, and view switches without reflowing anything else.
Opening only steals focus after keyboard selection in the container (or `select`
inside the card), moving focus to `[data-detail-card-title]`. Pressing Escape,
calling `close`, or clicking outside the card (inside `container` or outside
`view`, while toolbar clicks and popovers keep it open) dismisses it and
restores focus, leaving the item selected until a new selection reopens it.

## Targets, annotations and anchors

These primitives let you attach application data—like pull request comments—to
projection items while keeping storage entirely in your app. See the
[embedding guide](embedding.md#building-commenting-on-projections) for a full
walkthrough.

- **`ProjectionTarget`** identifies an extraction item cleanly without change or
  row IDs:
  `{kind: 'entity' | 'relationship', id, side: 'before' | 'after', path?}`.
  `path` is an optional RFC 6901 pointer into `data` (construct one with
  `propertyPath(...segments)`). Single extractions only have `after`.
- **Selection** exposes `selection` as `{rowId, targets, target?}`, where
  `targets` (from `rowTargets(row, subject)`) are all underlying items for the
  selected row (multiple for renamed, split, or merged rows) and `target` is the
  specific item or property chosen.
  - `onSelectionChange(selection)` fires on every change, including selecting a
    different property on the same item.
  - `selectTarget(target)` selects the matching row across every pane and view,
    returning a `TargetResolution`: `{status: 'present', rowId}`;
    `{status: 'absent', reason: 'item' | 'side'}` (selection unchanged); or
    `{status: 'absent', reason: 'property', rowId}` (selects the item without
    the property).
  - `resolveTarget(target)` checks presence without changing selection.
  - Renderers with the `properties` capability can report a selected property,
    and the host forwards `path` with `select`.
- **Annotations** take a list of
  `TargetAnnotation {target, count?, label?, tone?: 'neutral' | 'attention' | 'done' | 'subtle'}`.
  Tones avoid change colors (`attention` uses accent, `done` is muted, `subtle`
  uses a dashed outline for outdated items). The core aggregates them per row
  into `annotationMarks` for renderers declaring `annotations`, while built-in
  UIs also display them in table, text, and detail card views. Use
  `annotationsFor(rowId)` for one row's annotations and `unplacedAnnotations`
  for targets not present in the current subject. Activating a badge selects the
  item and invokes `onAnnotationActivate({rowId, targets, annotations})` (UIs
  trigger this via `activateAnnotation(rowId)`).
- **Anchors** locate items on screen: `anchorFor(rowId?, side?)` returns
  `{x, y, width, height, side}` in host viewport coordinates (clipped to visible
  bounds) or `null`. `useProjectionAnchor(projection, rowId?, side?)` keeps that
  rect updated across scrolling, layout, mode switches, and resizes for
  selected, hovered, and annotated items.
- **Digests** let you check whether a target changed across revisions:
  `targetDigest(engine, extraction, target)` and `targetDigests` hash the
  normalized item (or value at `path`) as RFC 8785 canonical JSON with a
  `sha256:` prefix, returning `undefined` if absent.
- **Deep links** serialize targets into URL-safe strings like
  `entity.after.payments` or `entity.before.api.%2Fowner` via
  `encodeTarget(target)` and parse them back with `decodeTarget(text)` (or
  `undefined` if malformed).
- **Controlled pairs** in `useComparisonPair` (and the explorers) accept
  `before`/`after` with `onBeforeChange`/`onAfterChange` so you can open the
  exact revision pair a comment belongs to.

## Settings

Settings fall into two buckets—host-wide settings owned by the core, and
renderer-specific controls—unified into one menu model:

- **Host settings:**
  - `highlighting`: `animated` fades emphasis with progress to zero at both
    endpoints, `on` keeps it active, and `off` hides it.
  - `changesOnly`, `variedOnly` (items in `variation.within` whose volatile
    values varied within tolerance), and `regeneratedOnly` (items in
    `variation.regenerated` reworded from an equal basis) are mutually
    exclusive—enabling one turns the others off.
  - `summaryFilter` narrows within the active scope to a summary figure's kinds
    or one change status (`summaryFilterOf(figure, status?)`,
    `setSummaryFilter`, or `null` for all), receding non-matching items without
    re-laying out the scope.
  - `search` filters by text. Together with "changes only", "varied only", and
    "regenerated only", it reaches renderers with the `filter` capability as a
    `filter` message (passing varied or regenerated IDs in `ids` with
    `changesOnly` false), while table and text views render `visibleRows`.
  - Active renderer selection across compatible bundles, and comparison `mode`
    across `availableModes`.
  - Playback `speed` multiplier. Base 1× duration comes from `durationMs`, then
    the definition's `presentation.durationMs`, then
    `defaultDuration(steps, pace)`: `pace.stepMs` per step (capped at 60 s) or
    1500 ms per step (capped at 20 s), with a 4.5 s minimum, using the
    renderer's step ends (or `comparison.steps` before they arrive).
  - Playback `loop` (on by default) cycles Base → Head → Base; turning it off
    stops at the endpoint. Pausing, seeking, stepping, or changing modes stops
    playback, and reduced motion never loops (Play jumps straight to the
    endpoint).
  - Playback `holds` controls how playback pauses at step ends (`stepHoldMs`,
    1200 ms) and endpoints (`endpointHoldMs`, 600 ms):
    - `timeline` (default) advances the slider at a steady rate through a
      timeline containing the holds. Each hold spans a slice of slider travel
      mapped to one presentation progress so visuals rest while the slider
      glides (half the endpoint hold at each end so loops dwell for the full
      hold). Travel between holds scales with step length, and speed scales the
      entire timeline.
    - `pause` stops the slider itself during each hold (scaled by speed, floor
      250 ms), keeping slider position equal to presentation progress.

    Internally, the controller separates slider `position` (shown on the slider
    and set by `seek(position)`) from presentation `progress` sent to renderers.
    `seekProgress(progress)` seeks by progress, landing step ends mid-hold.
    `stepPositions`, `nextStep`, and `previousStep` are slider positions, while
    `stepEnds` are progress values. Embedders can control either `position` or
    `progress` (controlled progress leaves the slider alone while it still maps
    to that progress). Pure timing functions—`presentationProgress`,
    `timelinePosition`, `timelineStepPositions`, `advanceTimeline`, and
    `advancePlayback`—are exported. Both UIs place Holds next to Loop under
    Settings → Playback, and hosts can preset it with `initialHolds`.
- **Renderer settings** expose the renderer's declared controls (`controls`,
  `controlValues`, `setControl`, `runAction`) for each UI to render in its own
  design system.
- **Settings model.** `settingsModel(projection, features, showAs)` builds the
  canonical Settings menu hierarchy: **Show as** and **Changes only** at the
  top, followed by submenus for **Highlight changes**, **Renderer** (when
  multiple bundles exist), **Playback** (in animated mode: Loop, Holds, Speed),
  and renderer option groups named by `groupLabel` (falling back to the sole
  control's label or group ID), deduplicated at every level. Up to
  `maxRendererSubmenus` groups appear at the top level and any extras roll into
  a shared "<Renderer> options" submenu so the menu fits a 400px-tall viewport.
  Declared ranges open in a separate widget from their menu item ("Depth…").
- **Definition defaults.** Projection definitions can provide
  `presentation: {highlighting?, changesOnly?, mode?, durationMs?, rendererOptions?}`
  as initial values that viewers can still override. `rendererOptions` are
  validated against declared controls, ignoring unknown IDs or invalid values
  with a notice.

## Planned bars

A bar that never wraps chooses among layouts its UI plans, most spacious first,
by measuring itself: `useFitPlan(bar, plans, options)` returns the plan to
render, its index and the bar's width. Each UI owns its plans and their order,
and through `options` how a plan is measured (`measure`, default `fitWidth`:
`data-fit-min` for flexible parts, `data-fit` for measured rows), the room a
fuller plan needs to spare (`hysteresis`, a number or a function of the
transition and the bar, default `toolbarHysteresis`, 24px), a plan's identity
(`signature`), where a previous plan lands when the plans change (`locate`),
which plans keep a control in use mounted (`lock`) and the widest bar a plan
suits (`ceiling`).

The core owns the lifecycle, an explicit machine (`fitPlanLifecycle`, see
[State machines](state-machines.md)): needs measured as rendered, before paint,
cached until `key` changes; a ResizeObserver on the bar and on its
`data-toolbar-region` elements, so a growing block replans; `data-fit-settled`
on the bar once a plan settles, at that width in whole pixels; no replanning
between a pointer's press and its click, so the pressed control isn't remounted;
and focus kept on a control marked `data-focus-id` when a plan remounts it, else
moved to the first of its `focusFallbacks` the bar holds. `chooseFitPlan` is the
choice alone, without a DOM: a plan collapses as soon as it stops fitting and a
fuller one returns only with its hysteresis to spare.
