# The host's default UI

If you want a ready-made interface that drops straight into a web app without
CSS collisions, use `@githubnext/projections-host/ui`:

```tsx
import {ComparisonExplorer} from '@githubnext/projections-host/ui'
import '@githubnext/projections-host/ui.css'

<ComparisonExplorer extractions={choices} engine={engine} renderers={renderers}
  loadComparator={loadComparator} runComparator={runComparator} />
```

`ProjectionView` displays a single subject, while `ComparisonExplorer` adds a
before/after revision picker. Both support all of the headless core's controlled
and uncontrolled props.

The layout prioritizes the projection itself: **a planned toolbar** (one row, or
two when playback controls are active) sits above a full-width stage that claims
the remaining height. All chrome lies flat edge to edge across hosts—the toolbar
uses the `surface-header` band separated from the stage by a single `divider`
hairline, with no outer card, border, or rounded corners, and the stage spans
edge to edge. A renderer's legend and the summary bar float over the stage's
foot as a single centered glass overlay (see
[the utility area](../design/utility-area.md#the-stages-foot-the-legend-and-summary)),
while notices sit as flat bands between the toolbar and stage. Inside the
toolbar, 4px padding frames every 32px control evenly on all four sides.

The toolbar is organized into three regions from start to end:

- **Start:** the revision pair picker (`ComparisonExplorer`, or custom
  `toolbarStart`).
- **Center:** the comparison mode switch (showing `availableModes`, hidden when
  only one mode exists; Animated uses a clapperboard icon so no mode icon looks
  like a play, pause, or step button), plus playback controls in animated mode
  and alongside table/text views—**one round play button**, compact step
  buttons, a flexible "Transition" slider, and a fixed-width percentage readout.
- **End:**
  1. When viewing Table or Text, a one-click return chip ("Table ×", labeled
     "Showing table; show the Graph renderer", or simply what is shown when no
     renderer is available).
  2. Icon buttons for the renderer's declared `zoom` controls (hidden in table
     and text views).
  3. **Filter**, expanding into the "Filter rows" input.
  4. **Settings** (built from `settingsModel`): **Show as** (active renderer
     title, **Table**, and **Text** as radio items) and **Changes only** at the
     top, followed by submenus for **Highlight changes**, **Renderer**,
     **Playback** (animated mode: Loop and Holds when not under reduced motion,
     plus Speed), and the renderer's remaining control groups (hidden in table
     and text views). The menu sizes itself to fit available space (opening
     upward when there is more room above) with internal scrolling and full
     arrow-key navigation (Right Arrow opens a submenu, Left Arrow closes it).
  5. **About this projection**, summarizing the title, counts, active renderer,
     comparator, diagnostics, and limitations.
  6. Custom `actions`, followed by **Enter full screen** (using the Fullscreen
     API or a fixed-overlay fallback).

Table and text views act as escape hatches inside Settings so the toolbar stays
uncluttered, while still serving as automatic fallbacks if a renderer is missing
or crashes. The play button calls `togglePlayback()`: pausing if playing,
otherwise playing in `nextDirection` (forward from Before, backward from After,
or continuing the last playback/step/seek direction), labeled "Play forward",
"Play backward" (mirrored icon), or "Pause". With Loop enabled, it starts and
stops back-and-forth playback; under reduced motion, it jumps straight to the
opposite endpoint ("Show <after label>" / "Show <before label>"). Pressing
**Space** toggles playback whenever focus is on the toolbar or stage chrome
(clicking their background focuses them), except inside text inputs or controls
that already handle Space.

### The toolbar

The toolbar never wraps, clips, or overlaps its controls. Instead, it is
**planned** from its own measured width via a ResizeObserver (`useToolbarLayout`
in `packages/host/core/src/ui/toolbar-layout.ts`, built on `useFitPlan` in
`fit-plan.ts`), so embedded views adapt to their container rather than the
viewport. Candidate layouts are measured before paint using each control's
minimum size—160px for the slider (120px below 480px), compact widths for
pickers, and 32px height across buttons, pickers, chips, and the play button—and
the roomiest plan that fits wins.

**Playback always lives on its own second row** (in animated mode, and in table
and text views which support progress in every mode): play button, step buttons,
a slider spanning at least 80% of the row (inset from the edge so its thumb
never touches the border), and percentage readout. Step buttons and percentage
only spill into "More playback controls" (or More) when needed to protect the
slider's span. Because playback has its own row, toggling Animated never shifts
row 1.

**The mode region leads the row.** The mode switch and scope switch (Changes ·
All) sit immediately after the pickers at the start of row 1 (or lead the row at
its left inset when no pickers are present), while actions sit at the end with
free space between them—never centered. The scope switch shares one slot with
the note shown when Changes hides nothing, keeping the region's width steady as
counts update.

As row 1 narrows further, controls collapse in priority order:

1. Before/After pickers shrink to compact triggers showing truncated short names
   ("v1") with full names in their tooltips.
2. The mode switch drops text labels (retaining them as tooltips and accessible
   names), then collapses into a single icon dropdown ("Comparison mode:
   Animated"), while scope moves into Settings under "Show".
3. End actions move into **More** ("⋯") one by one following
   `actionCollapseOrder`: zoom, About, full screen, then Filter (leaving
   Settings and custom `actions` visible).
4. The pickers merge into one compare button ("v1 → v3", named "Revisions: …")
   opening a "Revisions" popover with both selects and Swap.

When nothing sits at the start (a single revision with no `toolbarStart`), the
toolbar still spans full width with the end group right-aligned. Overflowed
controls retain their accessible names in menus. A 24px hysteresis prevents
layout flicker at width boundaries, and while a user has focus inside a region
or its open popover, that region stays pinned so controls never remount under
their hands. Filter expands inline in row 1 when spare room allows, otherwise
opening in a popover. You can inspect every breakpoint in Storybook at 1440,
1024, 768, 600, 480, and 390px (Default UI › Comparison explorer › At …px).

### The stage

Both at 1440×900 desktop and on an iPhone 13, the stage claims at least 80% of
the view's height. Pane labels sit in 28px header bands above each pane (clipped
with their layer in swipe mode) so they never cover content. In side-by-side
mode, panes meet at a single `divider` hairline (`ProjectionStage`'s
`paneEdge.between`, accounted for by `paneArrangement`; custom `paneEdge`
configurations without it retain the 16px gutter). Swipe's divider
(`.ph-swipe-handle`) styles its 1px line (`.ph-swipe-line`) and thumb outline
with `--ph-swipe-edge` (accent by default) and thumb fill with
`--ph-swipe-fill`, setting `data-dragging` and `data-focus-visible` so line and
thumb update together. Side-by-side panes share selection styling and pulse
counterparts (`data-projections-pulse`), with cross-pane connectors off unless
enabled via `connector`. Notices and failure alerts stay visible underneath,
while the active-view label (`[data-active-view]`) and comparator line
(`.ph-comparator`) remain mounted and visually hidden.

Views **fill their container's height** by default—give the container a definite
height such as `height: 100dvh` (without one they fall back to a usable
minimum), or pass `fill={false}` to size to content. When embedding a
content-sized view flat in a scrolling page column, pass `bleed` on
`ProjectionStage` alongside a matching `stage-inset` theme token so frames
extend into the page gutter while renderer content aligns squarely with your
column and edge rings remain unclipped. Sending `stage-max-height` (such as
`100vh`) caps pannable stages at that height and switches them to drag panning
so mouse wheels continue scrolling the page. Use `features` to disable
individual blocks (`playback`, `modes`, `highlighting`, `changesOnly`, `search`,
`rendererChoice`, `speed`, `rendererControls`, `zoom`, `table`, `text`, `info`,
`fullscreen`, `title`, `annotations`, `summary`), and `actions` to inject custom
toolbar items.

### The summary bar

Every view finishes with a 28px bottom row (`SummaryBar`, `[data-summary-bar]`,
named "Summary") floating over the renderer, table, and text views inside the
stage's foot (`StageFoot`, sitting under the renderer's legend with a single
rule between them). Styled like an editor status bar, it shows muted kind counts
in the renderer's vocabulary (`12 workspaces · 18 dependencies`) plus
color-coded comparison deltas (`12 workspaces +1 −1`). Clicking a total or a
delta (`+1` for added items) toggles `summaryFilter` to focus on those items
(clicking again clears it).

Renderer facts appear right after kind counts—either domain findings
(`2 breaking changes`, `1 newly enforced`, `3 to replace`) or non-kind measures
(`39,882 lines of code`). Each renders its theme icon (`iconMaskStyle`, putting
badges like `breaking`, `upgraded`, or planned actions on their disc just like
the renderer), count, and noun, staying muted unless given a tone. Facts with
`ids` act as filter toggles (`summaryFilterable`); comparison deltas appear in
change colors (`39,882 lines of code +2,056`) without acting as filters, and
`description` serves as both tooltip and accessible description. Renderers never
draw their own summary row—this bar serves as the summary everywhere, and the
text view opens with the matching `Summary: …` sentence (`figuresSentence`, via
`TextView`'s `summary` prop). Figures that don't fit the foot's available width
collapse from the end into a "…" button (`useSummaryFit`, `fitSummary`), whose
popover opens above the foot with each figure on its own full-width row and
aligned change counts. Text across the summary bar and toolbar labels centers
optically by cap height (`text-box: trim-both cap alphabetic`, falling back to a
one-cap line box where `text-box` is unsupported) with inline padding derived
from cap height so capitals sit evenly spaced inside pills and bars.

**Volatile variation.** When unchanged items varied within tolerance, the far
end of the summary bar shows a neutral, muted toggle such as "3 varied within
tolerance" (`.ph-varied-toggle[data-varied-within]`, `aria-pressed`) bound to
`variedOnly`. Toggling it filters the renderer, table, and text view down to
those items. If the `summary` feature is disabled, `VariedToggle` moves to the
toolbar (collapsing first into More via `actionCollapseOrder`). Within-tolerance
items are never highlighted or animated, and the text view notes how many
unchanged items varied. Beyond-tolerance volatile values on modified items carry
the neutral `varied` icon next to their status.

**Generated values.** Unchanged items whose
[generated values](../design/generated-values.md) were reworded from equal
inputs appear just before the varied toggle as "1 regenerated"
(`.ph-regenerated-toggle[data-regenerated]` with the `generated` sparkle),
toggling `regeneratedOnly` (or moving to the toolbar as `RegeneratedToggle` when
the summary bar is off). Inside the detail card, generated values appear first
with a quiet **Generated** mark: when regenerated from identical inputs, After's
text shows "Regenerated from the same inputs" with a toggle for Before's
wording; when inputs changed, it explains why ("Regenerated because the input
changed") and displays both passages side by side with a word-diff toggle.
Toggles swap layers within one grid cell so the card never shifts height.

### The detail card

Selecting any item opens a floating **detail card** (`DetailCard`, powered by
`useDetailCard`) anchored beside the item over the stage without reflowing the
toolbar, stage, or frames. It flips and shifts to stay in bounds, tracks the
item as you scroll or play, and turns into a bottom sheet on stages narrower
than 640px. Dismiss it with Escape, "Close details", clicking the stage or
outside the view, or clearing selection (toolbar interactions keep it open).

The card displays three sections in order:

1. **What changed:** change pills (`statusTone`, with "Renamed" in the moved
   hue), comparator tags, summary, and each changed field formatted as old → new
   with `ValueChange` (old value struck through in a removed pill, arrow, new
   value in an added pill; read as "was …, now …"). Changed `data` fields are
   selectable property targets (`[data-property-path][data-side]`) showing
   pressed state and annotation counts. Single extractions show **Properties**
   for the item's set fields. **Volatile values** (`VariedList`,
   `.ph-varied-field[data-varied-path][data-within]`) follow in monospace: old →
   new, "within tolerance" or "beyond tolerance (volatile)" (with the volatile
   icon), and the reason, all styled neutrally. Modified items differing only in
   a volatile value list it here rather than under changed fields.
2. **Where in the code:** evidence locations rendered as links when
   `evidenceLink(location, side)` returns a URL (such as a PR diff line or
   commit file), as buttons calling `onOpen` when supported (Inspector and CLI),
   or as plain text.
3. **Connections:** outgoing (→) and incoming (←) relationships for an entity,
   or From/To endpoints for a relationship, each showing its change and
   selecting its target when clicked.

Raw identity, kind, confidence, and raw JSON are intentionally omitted. Any
embedder content from `renderDetails` renders inside `.ph-details-slot`. Pass
`details="none"` to suppress the floating card if you render selection details
yourself, as the Inspector does with its docked `RawDetails` panel (identity,
kind, per-side property targets, evidence, and volatile values).

**Annotation markers** render as count badges or dots
(`.ph-annotation[data-annotation-id]`) on annotated rows in the table and text
views as well as in the detail card header.

## Layer-2 blocks

All of the building blocks behind `ProjectionView` and `ComparisonExplorer` are
exported as a stable public tier from `@githubnext/projections-host/ui`, sharing
the same names and prop signatures as `@githubnext/projections-host-vscode`
where both exist. Props and accessible names follow semver, while internal
styling may evolve. Bind each block to a `ProjectionController` from
`useProjection` (or a `ComparisonPair` from `useComparisonPair` for the picker)
and wrap them in `ScopedRoot`:

<!-- prettier-ignore -->
| Block | Props | What it draws |
|---|---|---|
| `Toolbar`, `ToolbarRow` | `children`, `onKeyDown?`, `rows?` | A group named "Projection toolbar": one line of blocks, or with `rows` a stack of planned `ToolbarRow`s; with `onKeyDown` it takes focus when its background is clicked. |
| `PairPicker` | `pair`, `form?` (`full`, `short`, `merged`), `compact?` | "Compare from", Swap and "To"; `short`, compact triggers with short revision names; `merged` (or `compact`), one "Revisions" button. |
| `ModeSwitch` | `projection`, `modes?`, `form?` (`labels`, `icons`, `menu`), `compact?`, `menu?` | The "Comparison mode" radio group of `availableModes`; icon-only, or a dropdown. Icons carry `data-icon` (`modeIcons`), none among `playbackIcons`. |
| `Playback` | `projection`, `beforeLabel`, `afterLabel`, `always?`, `compact?`, `minimal?`, `sliderMin?` | The play button, steps, the "Transition" slider (at least `sliderMin` px) and its percent; `compact` moves the steps and percent into "More playback controls", `minimal` leaves them out. |
| `PlayButton` | `projection`, `beforeLabel`, `afterLabel` | The one round play/pause button (`togglePlayback`), named by `playLabel`. |
| `PlaybackExtras`, `StepButtons` | `projection`, `position?` | The step buttons (and with `position` the percent) a `minimal` `Playback` leaves for an overflow menu. |
| `spaceTogglesPlayback` | `projection` | A keydown handler: Space toggles playback, except in fields and controls that use Space. |
| `ZoomControls` | `projection` | The renderer's declared `zoom` group as icon buttons. |
| `ShowAs` | `view`, `views`, `onViewChange`, `rendererTitle?` | The "Show as" radio group: the renderer, Table and Text. |
| `ShowAsChip` | `view`, `rendererTitle?`, `onDismiss?` | "Table ×" while a built-in view is shown; one click returns to the renderer. |
| `SummaryBar` | `projection`, `className?` | The summary bar: a figure per kind with its changes, each a filter toggle, the varied toggle at its end, overflow in a "…" popover. |
| `VariedToggle` | `projection`, `inline?` | "N varied within tolerance", a neutral toggle for `variedOnly`; nothing when no item varied within tolerance. |
| `ViewSwitch` | `view`, `onViewChange`, `views`, `rendererTitle?`, `idPrefix?`, `compact?` | The renderer, Table and Text as tabs, for hosts that want them in the row. |
| `FilterButton` | `projection`, `inline?`, `popover?` | Filter, expanding into "Filter rows" (or opening it in a popover). |
| `SettingsMenu` | `projection`, `features?`, `showAs?` | The Settings menu (`settingsModel`): Show as and Changes only, then submenus for highlighting, the renderer, playback and the renderer's option groups. |
| `InfoButton` | `projection`, `comparator?`, `diagnostics?` | About this projection. |
| `FullscreenButton`, `useViewFullscreen` | `target`, `fullscreen?` | Full screen for an element, with a fixed-overlay fallback; share one `useViewFullscreen` state between buttons (say, one in More). |
| `MoreMenu`, `MoreSection` | `children`, `label` | The "More" overflow dialog and its labeled sections. |
| `PaneLabel` | `side`, `children`, `corner?` | A revision's label as a chip over a pane, for custom stages (from the core); `ProjectionStage` draws header bands, or chips overlaid on each pane's frame with `paneLabels: 'chips'`. |
| `LoadingStatus` | `label`, `description?`, `reducedMotion?`, `fill?` | A loading state centered in the box it stands in for (from the core). |
| `DetailCard` | `projection`, `container`, `view?`, `onOpen?`, `evidenceLink?`, `beforeLabel?`, `renderDetails?`, `annotations?`, `sheetBelow?` | The selection's detail card over `container` (a positioned element around the stage), with the consumer slot (`.ph-details-slot`). |
| `VariedList` | `varied` | A change's volatile values (`RowDetails.varied`), neutrally: path, old → new, within or beyond tolerance. |
| `ValueChange` | `before?`, `after?` | A value that changed, old → new in removed and added pills. |
| `RawDetails` | `projection`, `row?`, `onClose?`, `onOpen?`, `beforeLabel?`, `afterLabel?`, `renderDetails?` | A row's raw details for a docked panel: identity, kind, each side's properties as targets and evidence. |

Here is how you can assemble a custom compact toolbar around `ProjectionStage`
with the table view as an escape hatch (also in Storybook under Default UI ›
Building blocks › A custom toolbar around ProjectionStage):

```tsx
import {useRef, useState} from 'react'
import {ProjectionStage, useProjection} from '@githubnext/projections-host'
import {
  DetailCard, FullscreenButton, InfoButton, ModeSwitch, Playback, ScopedRoot, SettingsMenu, ShowAsChip, TableView, Toolbar,
  spaceTogglesPlayback,
} from '@githubnext/projections-host/ui'
import type {ViewKind} from '@githubnext/projections-host/ui'
import '@githubnext/projections-host/ui.css'

function Compact({subject, renderer}) {
  const p = useProjection({subject, projection: {id: 'checkout', title: 'Checkout'}, renderers: [renderer]})
  const root = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<ViewKind>('renderer')
  const showAs = {view, views: ['renderer', 'table'] as const, onViewChange: setView, rendererTitle: renderer.title}
  return <ScopedRoot ref={root} colorMode={p.colorMode} style={{display: 'flex', flexDirection: 'column', height: '100%'}}>
    <Toolbar onKeyDown={spaceTogglesPlayback(p)}>
      <ShowAsChip view={view} rendererTitle={renderer.title} onDismiss={() => setView('renderer')} />
      <ModeSwitch projection={p} compact />
      <Playback projection={p} beforeLabel="Base" afterLabel="Head" always={view !== 'renderer'} className="pj:flex-1" />
      <SettingsMenu projection={p} showAs={showAs} />
      <InfoButton projection={p} />
      <FullscreenButton target={root} />
    </Toolbar>
    <div ref={stage} style={{position: 'relative', flex: 1, minHeight: 0}}>
      <ProjectionStage projection={p} hidden={view !== 'renderer'} labels={{before: 'Base', after: 'Head'}} fill />
      {view === 'table' && <TableView subject={p.subject} rows={p.visibleRows} total={p.rows.length} progress={p.progress}
        selectedId={p.selectedId} onSelect={p.select} />}
      <DetailCard projection={p} container={stage} view={root}
        renderDetails={selection => <MyComments targets={selection.targets} />} />
    </div>
  </ScopedRoot>
}
```

`ScopedRoot` (also exported from `@githubnext/projections-host/ui/components`
with the shadcn primitives) isolates the stylesheet; style `ScopedRoot` itself
with plain CSS rather than `pj:` utility classes.

To layer your own target-based features such as comments on top of the prebuilt
views (the UI itself renders no annotation content), use these integration
props:

- `annotations?: readonly TargetAnnotation[]` and
  `onAnnotationActivate?: (activation: AnnotationActivation) => void`.
- `onSelectionChange?: (id: string | null, selection: ProjectionSelection | null) => void`
  fires on every selection change, including property paths.
- `renderDetails?: (selection, projection) => ReactNode` appends custom content
  into `.ph-details-slot` at the bottom of the detail card.
- `evidenceLink?: (location, side) => string | undefined` turns an evidence
  location (`{path, line?}`) into a hyperlink (falling back to `onOpen` when
  `undefined`).
- `details?: 'card' | 'none'` lets you disable the built-in detail card (`none`
  turns it off).
- `onRendererStatusChange?: (status: RendererStatus) => void` and
  `onPainted?: (painted: Painted) => void` report when the renderer is ready or
  failed, and when the frames settle on what is shown, as `useProjection`'s
  options of the same names do (see the host core guide), so a host waits on
  them rather than on the view's DOM.
- `controllerRef?: Ref<ProjectionController | null>` exposes `selectTarget`,
  `resolveTarget`, and `anchorFor` (or use `useProjectionAnchor`).
- `ComparisonExplorer` also supports controlled `before`/`after` props with
  `onBeforeChange`/`onAfterChange`.

Under the hood, the default UI uses shadcn/ui components (Radix primitives
vendored into `packages/host/core/src/ui/components` under MIT) styled with
Tailwind CSS v4 using the `pj` prefix (`pj:bg-background`), scoped inside
`.pj-root` with no global reset. The build unwraps Tailwind's cascade layers in
order and scopes every rule, custom property, and keyframe to `.pj-root` so your
host page and the UI never leak styles into each other. It ships with the
Projector theme (see `packages/host/core/src/ui/components/README.md`) and
forwards those tokens into renderer frames. `./styles.css` remains available as
an alias for `./ui.css`.

**Surfaces and edges.** The default UI stacks the exact same elevation surfaces
as renderers, backed by `defaultThemeTokens` in both light and dark modes
(`test/theme.test.mjs` asserts parity with `theme.css`, and `sharedSurfaceNames`
and `projectorSurfaces` in `packages/host/core/src/ui/lib/tokens.ts` enumerate
them):

<!-- prettier-ignore -->
| `--pj-*` (Tailwind) | Token | Where the default UI draws it |
| --- | --- | --- |
| `surface-canvas` (`pj:bg-surface-canvas`) | `color-surface-canvas` | the stage behind cards: renderer frames and the table and text views' well (`.ph-scroll`), edge to edge |
| `surface-raised` | `color-surface-raised` | cards: each table (`.ph-table-scroll`), each text-view step (`.ph-step`), the detail card (`.ph-detail-card`); notices and failure alerts, as bands |
| `surface-header` | `color-surface-header` | header bands: the toolbar, the legend and the summary bar, table captions and column headers, step headings, the detail card's header |
| `surface-inset` | `color-surface-inset` | recessed wells (the Inspector's raw output, JSON and commands) |
| `divider` (`pj:border-divider`) | `color-divider` | a card's edge and a band's rule, 3:1 or more against every surface; quieter rules between rows keep `border` |
| `<change>-muted`, `<change>-border` | `color-<change>-muted`, `-border` | change fills and their edges, for `added`, `removed`, `modified` and `moved` |

**Every tinted region carries a same-hue edge—never a bare fill.** Change chips
(`statusTone`) paint an opaque `-muted` fill over the raised surface (keeping
text AA on any row) framed by a 1px `-border` edge; change-colored legend
swatches (`color-<change>-muted` or `-highlight`) take a 1px `-border` edge;
neutral selection fills (`lens-muted`) carry a 2px leading lens edge, and the
active text-view step wears a lens ring; destructive badges pair their faint red
fill with a destructive edge. `packages/host/core/browser/surfaces.spec.ts`
enforces this rule across table, text, detail card, legend, and notice elements
in both color modes.

First-party apps like the Inspector import these primitives from
`@githubnext/projections-host/ui/components`, render inside `ScopedRoot`, and
load `ui.css` (which compiles only classes referenced in
`packages/host/core/src/ui/**` and `packages/host/inspector/src/**`). If your
app bundles the default UI, append `hostUiNotices()` from
`@githubnext/projections-host/build/ui-notices` to your third-party notices
(covering shadcn/ui, Radix, lucide, and related packages under MIT, ISC, 0BSD,
and Apache-2.0 for class-variance-authority).
