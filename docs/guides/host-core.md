# The host's headless core

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

`useProjection(options)` returns a `ProjectionController` with state and
actions.

- **State, each controlled or uncontrolled.** You can pass the value with its
  `on…Change` handler, or omit it and optionally seed it with `initial…`. This
  covers `position` (or `progress`), `playing`, `loop`, `holds`, `speed`,
  `mode`, `swipePosition`, `highlighting`, `changesOnly`, `variedOnly`,
  `regeneratedOnly`, `summaryFilter`, `search`, `selectedId`, `rendererName` and
  `controlValues`.
- **Derived data:**
  - rows: `rows`, `visibleRows` (after find, "changes only", "varied only",
    "regenerated only" and the summary filter) and `selectedRow`;
  - `summary`, the summary bar's figures (`SummaryFigure`): a figure per
    extraction kind with its total (in `after` for a comparison) and its
    `added`, `removed` and `modified` changes, counted by the core
    (`summaryFigures`). The words, order and kinds come from the renderer's
    `summary` message (from the after pane in two-pane modes); a renderer that
    sends none, such as a version 0 bundle, gets the core's words for every kind
    (`humanizeKind`: `depends-on` → dependencies, `devDependencies` → dev
    dependencies). Kinds named alike are one figure. A renderer's facts follow,
    as sent, with their changes and `description`. `figuresSentence` writes them
    as the bar's one line,
    `12 workspaces +1 −1 · 18 dependencies +2 · 18 major upgrades`; a row keeps
    its change's `varied` (volatile values that differ);
  - `variation`, `{within, beyond, regenerated}` counted from the rows
    (`undefined` when nothing varied): unchanged items with a volatile value
    other than a generated one that varied within tolerance, modified items with
    a volatile value beyond it, and unchanged items whose
    [generated values](../design/generated-values.md) were reworded from an
    equal basis (`regenerated`, from the SDK); a relationship row without a
    label of its own is named by its endpoints (`relationshipLabel`, for example
    "API → Orders queue (publishes)", flagged `derivedLabel`), and descriptions
    then omit its ID;
  - `notices`, `rendererErrors`, `rendererStatus` and per-pane state (`panes`);
  - `renderedProgress` and the renderer's `stepEnds`, `nextStep` and
    `previousStep`;
  - the resolved `theme`, `themeStyle` and `colorMode`, and `reducedMotion`;
  - `renderers`, the compatible bundles;
  - `controls`, the renderer's declared controls;
  - `durationMs` (the playback duration at the current speed) and
    `baseDurationMs` (at 1×).
- **Actions:** `seek`, `play`, `pause`, `toggle`, `stepForward`, `stepBack`,
  `setSpeed`, `setMode`, `setSwipePosition`, `setHighlighting`,
  `setChangesOnly`, `setVariedOnly`, `setRegeneratedOnly`, `setSearch`,
  `select`, `hover`, `setRenderer`, `setControl`, `runAction` and `openSource`.

`ProjectionStage({projection, labels?, paneLabels?, hidden?, stackBelow?, renderStatus?, legend?, fill?})`
renders the renderer frames for the current mode:

- **Animated:** one frame.
- **Side by side:** before and after panes, each labeled in a slim header band
  above it (the band surface with a divider rule), so a label never covers the
  renderer's content; each frame is told it is a held pane (`pane` in its
  environment), so renderers leave out transition captions. The panes sit left
  and right, or stack (Before above After) when that fits the content larger: a
  renderer reports its content's shape (`aspect`, width / height of its framing
  over the whole transition) and `paneArrangement` compares the two fitted sizes
  for the stage, keeping the current arrangement unless the other wins by 15%
  (`arrangementHysteresis`), so it holds while scrubbing and on small resizes.
  Below `stackBelow` (640px) they always stack. The panes share selection and
  hover: the selected item is styled as selected in both, and when a selection
  arrives from the other pane (or a view) the renderer scrolls its counterpart
  into view if it was scrolled out, and briefly pulses it
  (`data-projections-pulse`, about 900 ms; never under reduced motion).
  Annotation badges show in both panes. There is **no connector by default** and
  no UI toggle for one: a host opts in with the `connector` prop (`connector`,
  `initialConnector`, `onConnectorChange`; `setConnector`), which draws a line
  between the selected item's anchors in the two panes.
- In **swipe**, the before label sits at the top left and the after label at the
  top right, above both layers.
- **Swipe:** stacked layers behind an accessible divider.
- **Diff:** one frame that draws its own static comparison: `init` carries
  `comparisonMode: 'diff'` and the frame gets no `progress`, except one
  `{progress: 1, highlighting: 0}` when highlighting is turned off (and full
  highlighting again when it is turned back on).

Each renderer declares the modes it supports (`comparisonModes` in its `ready`
capabilities and `renderer.json`), in order; without a declaration it supports
animated, side by side and swipe. The controller's `availableModes` lists them,
and `mode` is always one of them: a chosen or controlled mode the renderer
doesn't support falls back to its first (default) mode, and the change is
requested through `onModeChange`, including when the renderer changes. Omit
`mode`/`initialMode` to start in the renderer's default. `clampMode`,
`twoPaneMode` and `defaultComparisonModes` are exported. The UIs offer only
`availableModes`, in the renderer's order, hide the mode switch when there is
one, and show playback, loop and speed only in animated mode.

The after pane keeps its place in the document in every mode, so the animated
frame becomes the after pane (and back): a mode switch loads at most the before
frame. A new pair keeps the shown frames and sends them a new `init`. Each frame
stays transparent behind the pane's loading status until the renderer's first
`rendered` (`PaneState.status` becomes `ready` then), so an unthemed first paint
never shows.

**Legend.** A renderer can send its legend (`legend {title?, items}`) instead of
drawing one in each pane. The controller exposes it as `legend` (from the after
pane in two-pane modes), and the stage draws it once below the panes, outside
the swipe layers, as a card on `color-surface-raised` with a `color-divider`
edge, with theme-token swatches resolved from the host theme (a change fill
swatch, `color-<change>-muted` or `-highlight`, takes its same-hue
`color-<change>-border` edge). Pass `legend={false}` to draw `projection.legend`
yourself, or use `ProjectionLegend`.

**Filling a container.** With `fill`, the stage fills its container's height
(give the container a definite height). Side-by-side panes share that height,
stacking into two rows on narrow widths. Frames fill their pane instead of
growing to the renderer's requested height, so renderers scroll inside.

It is styled inline from the theme tokens, so the core needs no stylesheet. Pane
labels come from the consumer. `paneLabels: 'chips'` shows each label as a quiet
chip overlaid on its frame instead of a header band, on the renderer's own stage
and taking no height: in side by side at each pane's top start, in swipe the
before chip at the top left and the after chip at the top right, each revealed
with its side; single-frame modes show none. The chip lines up with where the
renderer's content starts, and the stage sends each frame under a chip the
`stage-cover` theme token (the rectangles it covers, in the frame's own
coordinates) and `stage-inset-top` (the band they take; `stage-inset-bottom` for
what floats at the stage's foot, `foot`), so renderers that honour them keep
their content clear of the chip. It sits as far below the frame's top as from
its side: a box in the utility bar's own fill, edge, corners and muted text
(`--ph-utility-*`), 28px tall, the revision's name in mono at regular weight and
its commit subject in the text face, both muted (the age is in its tooltip). A
host can restyle the chip alone with `--ph-pane-chip-bg`,
`--ph-pane-chip-border`, `--ph-pane-chip-radius`, `--ph-pane-chip-fg` and
`--ph-pane-chip-name`. `paneLabels: 'hidden'` drops the bands of side by side
and swipe for a host that names the revisions elsewhere. Either way the labels
name each pane for assistive technology. `utility` puts controls in the stage's
utility area in its one-frame modes (animated, diff): a bar floating over the
stage's top edge, inset from its sides and as wide as its content needs, instead
of a toolbar row above the stage. The stage measures what it overlays on each
frame (the bar, or the chips) and sends it the same two tokens, so the frame
keeps clear of it and shows under it as it pans or scrolls. The default UI's
`utilityArea` uses it for playback, with chips for the labels (see
[the design note](../design/utility-area.md)). `renderStatus` renders a pane's
loading or failure state; pass `null` to show `rendererStatus` and
`rendererErrors` yourself. While a pane loads, its status covers the frame's
area and is centered in it; while both panes of side by side or swipe load, one
status covers the stage instead, rendered for side `main` since it speaks for
both.

`LoadingStatus({label, description?, reducedMotion?, fill?})` is the loading
state every UI shows (renderer frames, the explorer's comparison, engine
startup): a spinner and a short label centered in the box the content will
occupy, filling it (or, with `fill: false`, a frame's starting 480 px) so
nothing moves when the content arrives. It is a polite `role="status"`, and
static under reduced motion (`reducedMotion`, for example the controller's, or
`prefers-reduced-motion: reduce`). Styled inline from the theme tokens;
`--pj-loading-color` and `--pj-loading-font-size` restyle it. The default UI
re-exports it.

`useComparisonPair({extractions, engine, renderers, loadComparator?, runComparator?, customRenderer?})`
is the headless pair picker. It returns:

- the chosen `before` and `after` extractions;
- the `outcome`, and the `subject` to present with its `subjectLabels` (the
  previous subject stays while another pair computes);
- the renderer `resolution`, compatible `renderers` and the definition's
  `presentation` defaults;
- actions: `setBefore`, `setAfter`, `swap` and `retry`.

`useComparisonSession(options)` keeps what the person chooses while they move
between pairs: the mode, the swipe divider, highlighting, the scope, find, the
connector and loop. A pair picker's view remounts for each new comparison, so
call it above the view, with `presentation: pair.presentation`, and spread its
result (controlled values with their handlers) into `useProjection` or a view.
Each setting starts from its `initial…` option, else the definition's
`presentation`, else the shared default: the renderer's default mode, the
divider centred, animated highlighting, **the Changes scope**
(`initialChangesOnly` changes it), no find, no connector and loop on
(`comparisonSessionDefaults`). Each is also controllable, with its `on…Change`.

Comparisons are computed in the browser with the projection's comparator, and
failures are explicit. Data helpers (`subjectRows`, `rowItems`,
`describeChange`, `rowStatusCounts`) feed table, text and details views.

**Detail card.** `rowDetails(subject, row, rows, limits?)` is what a detail card
shows for a row, without any UI:

- `parts`, the change as hue-and-word parts (`changeParts`: "Renamed" in the
  moved hue, then "Added", "Removed" or "Modified"), the comparator's
  classification `tags` and its `summary`;
- `fields`, the fields that changed, old and new as text (`before`, `after`;
  either missing when the field appeared or went away; unset values are left
  out): the item's identity (renamed, split, merged), then `label`, `kind`,
  `from` and `to`, then each `data` key, with its property `path` and `side`. In
  one extraction they are the item's set fields, unchanged. A volatile value the
  change lists in `varied` is left out of `fields`;
- `generated`, the item's [generated values](../design/generated-values.md)
  (`GeneratedField`), listed first: each `path`, `name`, `before` and `after`
  values, the comparison's `entry` when it differs and both sides' `bases`.
  `generatedForm(field)` says how to present one: `plain`, `regenerated` (from
  the same inputs) or `changed` (with the reason as prose and, for strings, a
  word diff); `GeneratedList` draws them with the Generated mark. Generated
  values and their bases are left out of `fields` and `varied`;
- `varied`, each volatile value that differs (`VariedField`): its `path`, its
  `name` below `/data/`, `before` and `after` as text, `within`, `words`
  (`within tolerance` or `beyond tolerance (volatile)`) and the comparison's
  `reason`. `variedText(field)` writes one as a line, for example
  `durationMs 120 → 135 · within tolerance`;
- `evidence`, the after side's locations, then before-side files the after side
  doesn't name (`{path, line?, side}`);
- `connections`, an entity's outgoing then incoming relationships (changed
  first; `rowId` is the relationship), or a relationship's `from` and `to`
  endpoints (`rowId` is the entity), each with its change parts.

`changeTags(subject, rowId)` reads the comparator's classification from the
comparison's metadata conventions: `metadata.compatibility.changes[id].level`
(api-compatibility: "Breaking", "Additive", "Compatible") and
`metadata.runtimePolicy.interpretations[id]` (runtime-policy: "Scope broadened",
…); anything malformed is ignored.

`useDetailCard(projection, {container, view?, enabled?, sheetBelow?})` is the
headless card: `{row, placement, style, ref, close, select}`. While a row is
selected it is open over `container` (a positioned element around the stage and
the table and text views), placed by `placeDetailCard` beside the item's anchor
(`anchorFor`, else the selected row's `button[data-row-id]` in a table or text
view): to the right, else the left, below or above, aligned with it and shifted
to stay inside the container's visible box; without an anchor, in its top end
corner; on a container narrower than `sheetBelow` (640px), a bottom sheet across
it. It follows the anchor through renderer scrolling and playback, host
scrolling and resizing, and view switches. Nothing else moves. Opening never
takes focus, except after a selection made with the keyboard in the container
(or `select` from the card), when the card's title (`[data-detail-card-title]`)
takes it. Escape in the container, `close`, or a press outside the card (in the
container, or outside `view`; the toolbar and its popovers keep it) close it,
and focus returns to where it was before the card (or the renderer frame). The
selection stays; a new selection opens it again.

## The view model

A host UI decides which views it offers and which controls show. The core makes
those decisions once, so every UI (the default UI, the VS Code UI and yours)
shares the same defaults, and a host changes them only through the options
below.

- `offeredViews(projection, features)`: the renderer's view when there is one,
  then the table and text views the features keep; never empty.
  `useViewChoice(projection, features, initialView)` is the stateful part:
  `{views, view, setView, recoverView}`. It shows `initialView` when offered,
  else the first view, and shows the renderer's view when a renderer arrives
  where there was none. `recoverView` is the built-in view to offer when the
  renderer fails. `viewLabel` names a view ("Built-in table view").
- `viewControls(projection, {features, view, playbackInViews?})` says what
  shows:
  - `modes` and `modeSwitch`: the modes the features offer that the renderer
    supports, in its order; the switch shows comparing, in the renderer's view,
    with more than one;
  - `scope`: comparing, with `changesOnly` on;
  - `playback`: comparing, with `playback` on, **in the Animated mode only, in
    every view**. `playbackInViews: 'always'` also shows it beside the table and
    text views in the other modes, which present the transition's progress too;
  - `zoom` and `zoomControls`: the renderer's `zoom` group, with both `zoom` and
    `rendererControls` on, in the renderer's view; no controls to draw while the
    renderer has failed;
  - `varied`: the varied toggle belongs in the toolbar only when something
    varied and there is no summary bar.
- `scopeChoice(projection)`: what a scope switch offers. `options` are Changes
  and All, and Noise while it is the scope, each with its `label` and a `title`
  ending in its count; `nothingHidden` says to show the note "Changes · nothing
  hidden" instead, with `noteTitle`.
- `summaryToggle(applied, figure, status?)` is a summary figure's filter toggle
  (`{pressed, next}`), `summaryToggleTitle` its tooltip, and `summaryFactTitle`
  a fact's.
- `ProjectionFeatures`, `featureOn`, `offeredModes` and `rendererLabel` are the
  feature switches every UI takes.
- `playButton(projection, beforeLabel, afterLabel)` is the one play button:
  `{action, direction, label}`, where `action` is `pause` while playing, else
  `play`, or `show` under reduced motion ("Show <after label>"). The icon is the
  UI's.

**Keyboard.** These take any keydown event (DOM, React or another framework's):

- `handlePlaybackShortcut(event, projection, keeps?)`: Space plays and pauses
  (`togglePlayback`) from the listening element (a toolbar, the stage's chrome)
  or an element in it that doesn't use Space itself, once per press.
  `spaceKeeping` lists the elements that keep Space (fields, buttons, radios,
  tabs, menus, dialogs…); `keeps` adds a design system's custom elements. An
  element that keeps Space but encloses the listener, such as a dialog around
  the view, doesn't count. `isPlaybackShortcut` only tests.
- `rovingIndex(key, index, count, orientation?)`: where an arrow, Home or End
  key moves the choice in a radio group or tab list, wrapping at either end.

The default scope is Changes (`changesOnly`, which a definition's
`presentation.changesOnly: false` turns off).

## Targets, annotations and anchors

These let embedders attach their own data, such as pull request comments, to
projection items. The core stores none of it. The
[guide](embedding.md#building-commenting-on-projections) has a worked example.

- **`ProjectionTarget`:**
  `{kind: 'entity' | 'relationship', id, side: 'before' | 'after', path?}`. It
  names an extraction item by its own identity on one side, plus optionally a
  property (`path`, an RFC 6901 pointer into the item's `data`; build one with
  `propertyPath(...segments)`). It never uses change or row IDs. A single
  extraction has only `after`.
- **Selection:** `selection` is `{rowId, targets, target?}`. `targets` are the
  items the selected row stands for, from `rowTargets(row, subject)`: several
  for a renamed, split or merged row. `target` is the specific one chosen (a
  property, or a target the host selected).
  - `onSelectionChange(selection)` reports every change, including a property
    chosen within the same item.
  - `selectTarget(target)` selects the row presenting a target in every pane and
    view. It returns `TargetResolution`:
    - `{status: 'present', rowId}`;
    - `{status: 'absent', reason: 'item' | 'side'}`, which leaves the selection
      unchanged;
    - `{status: 'absent', reason: 'property', rowId}`, which selects the item
      without the property.
  - `resolveTarget(target)` checks a target without selecting it.
  - Renderers declaring `properties` may report a selected property; the host
    sends the selected property's `path` with `select`.
- **Annotations:**
  - `annotations` is a list of
    `TargetAnnotation {target, count?, label?, tone?: 'neutral' | 'attention' | 'done' | 'subtle'}`.
    Tones never use change colors: `attention` uses the accent color, `done` is
    muted and `subtle` (for example outdated) has a dashed outline.
  - The core combines them per presented row into `annotationMarks`, which
    renderers declaring `annotations` draw as badges. The default and VS Code
    UIs show them in their table and text views and the detail card.
  - `annotationsFor(rowId)` lists a row's annotations. `unplacedAnnotations`
    lists those whose targets the subject doesn't present.
  - Activating a badge selects the item and calls
    `onAnnotationActivate({rowId, targets, annotations})`; UIs call
    `activateAnnotation(rowId)`.
- **Anchors:** `anchorFor(rowId?, side?)` returns where an item is drawn as
  `{x, y, width, height, side}` in host viewport coordinates, clipped to what is
  visible, or `null`. `useProjectionAnchor(projection, rowId?, side?)` follows
  it through renderer scrolling, layout, mode changes, and host scrolling and
  resizing. Renderers report anchors for the selected, hovered and annotated
  items.
- **Digests:** `targetDigest(engine, extraction, target)` and the batch form
  `targetDigests` return `sha256:` over the RFC 8785 canonical JSON of the item
  (or the value at `path`), after the engine normalizes the extraction. The
  result is `undefined` when the target is absent. Compare digests across
  revisions to tell whether a target changed.
- **Deep links:** `encodeTarget(target)` returns URL-safe text such as
  `entity.after.payments` or `entity.before.api.%2Fowner`; `decodeTarget(text)`
  reverses it, returning `undefined` for anything malformed.
- **Pair:** `useComparisonPair` (and the explorers) accept controlled `before`
  and `after` keys with `onBeforeChange` and `onAfterChange`, for example to
  open the pair a comment was written on.

## Settings

- **Host settings:** the same for every projection, and owned by the core.
  - `highlighting`: `animated` fades change emphasis with progress, to zero at
    both endpoints; `on` keeps it; `off` hides it.
  - `changesOnly`.
  - `variedOnly`: only the items that varied within tolerance
    (`variation.within`, unchanged items whose volatile values differ). It and
    `changesOnly` exclude each other: turning one on turns the other off.
  - `regeneratedOnly`: only the items whose generated values were reworded from
    an equal basis (`variation.regenerated`). It excludes "changes only" and
    "varied only" the same way.
  - `summaryFilter`: only the items of a summary figure's kinds, or only those
    with one change status (`summaryFilterOf(figure, status?)`,
    `setSummaryFilter`; `null` shows every item). It narrows within the scope:
    renderers recede what it leaves out and lay out the scope unchanged.
  - `search`: find an entity. Find, "changes only", "varied only" and
    "regenerated only" reach renderers with the `filter` capability as a
    `filter` message (the varied or regenerated items' IDs in `ids`, with
    `changesOnly` false), and the table and text views show `visibleRows`.
  - The renderer, chosen among compatible bundles.
  - Playback `speed`, a multiplier. The duration at 1× is the `durationMs`
    option, else the definition's `presentation.durationMs`, else
    `defaultDuration(steps, pace)`: the renderer's declared `pace.stepMs` per
    step (at most 60 seconds), else 1500 ms per step (at most 20 seconds), and
    at least 4.5 seconds. The step count comes from the renderer's step ends, or
    from `comparison.steps` until it reports them.
  - Playback `loop`, on by default. Animated playback travels Base → Head → Base
    and repeats. Without `loop`, playback stops at the endpoint. Pausing,
    seeking, stepping and switching modes stop it; reduced motion never loops,
    and play shows the endpoint.
  - Playback `holds`: where playback dwells at each step end (1200 ms,
    `stepHoldMs`) and at the endpoints (600 ms, `endpointHoldMs`).
    - `timeline` (default): the slider moves at a constant rate through a
      timeline that includes the holds. A hold is a stretch of the slider that
      shows one presentation progress, so the graphics stay still while the
      slider keeps moving; half of the endpoint hold starts the timeline and
      half ends it, so a loop dwells the whole of it at each end. Travel between
      holds is proportional to step lengths, and speed scales the whole
      timeline.
    - `pause`: the slider itself stops at each hold (holds scale with speed but
      never drop below 250 ms), and the slider position is the progress.

    The controller separates the slider `position` (what the slider shows,
    playback advances and `seek(position)` sets) from the presentation
    `progress` renderers receive. `seekProgress(progress)` seeks by progress,
    landing a step end mid-hold. `stepPositions`, `nextStep` and `previousStep`
    are slider positions; `stepEnds` are the renderer's step ends as progress.
    Embedders may control `position`, or `progress` as before: a controlled
    progress keeps the slider where it is while that position still shows it.
    `presentationProgress`, `timelinePosition`, `timelineStepPositions`,
    `advanceTimeline` and (for `pause`) `advancePlayback` expose the timing as
    pure functions. Both UIs offer Holds next to Loop in Settings' Playback
    submenu; hosts preset it with `initialHolds`.

  - Comparison `mode`, among the renderer's `availableModes`.
- **Renderer settings:** the controls a renderer declares (`controls`,
  `controlValues`, `setControl`, `runAction`). Each UI draws them with its own
  design system.
- **Settings model:** `settingsModel(projection, features, showAs)` is the
  Settings menu every UI draws, as one hierarchy: **Show as** and **Changes
  only** at the top; **Highlight changes**, **Renderer** (more than one),
  **Playback** (animated: Loop, Holds, Speed) and the renderer's option groups
  as submenus, each named by its controls' `groupLabel` (else the lone control's
  label, else the group ID), unique at every level. Up to `maxRendererSubmenus`
  groups get their own submenu; more share one "<Renderer> options" submenu, so
  the top level fits a 400px-tall view however many options a renderer declares.
  A declared range opens from its item ("Depth…") in a widget, as a menu can't
  hold one.
- **Definition defaults:** a definition may set
  `presentation: {highlighting?, changesOnly?, mode?, durationMs?, rendererOptions?}`.
  Hosts apply these as initial values, and viewers can still change them.
  `rendererOptions` is checked against the renderer's declared controls; unknown
  IDs and invalid values are ignored, with a notice.
