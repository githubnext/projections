# The host's default UI

```tsx
import {ComparisonExplorer} from '@githubnext/projections-host/ui'
import '@githubnext/projections-host/ui.css'

<ComparisonExplorer extractions={choices} engine={engine} renderers={renderers}
  loadComparator={loadComparator} runComparator={runComparator} />
```

`ProjectionView` presents a subject; `ComparisonExplorer` adds the pair picker.
Both accept the core's controlled and uncontrolled settings.

The views give the projection the space: **a planned toolbar** (one row, or two
where playback needs them) above a stage that takes the rest, at full width.
Their chrome lies flat, edge to edge, in every host: the toolbar and the summary
bar are bands of the header surface (`surface-header`), each ruled off from the
stage by one `divider` hairline, with no card, border or corners; the stage (the
single frame and each comparison pane) runs to both edges, and a renderer's
legend is a band of the same surface between the stage and the summary bar.
Notices sit between the toolbar and the stage as bands too. The toolbar's 4px
padding is the space around every 32px control, at its ends as at its top and
bottom. In order, it holds three regions:

- **start:** the pair picker (`ComparisonExplorer`, or `toolbarStart`);
- **center:** the comparison mode (the renderer's `availableModes`, hidden when
  there is one; Animated is a clapperboard, and no mode icon looks like a play,
  pause or step glyph), then playback (animated mode, and beside the table and
  text views): **one round play button**, small step buttons, the "Transition"
  slider, which takes all remaining space, and its percent at a fixed width;
- **end:**
  1. while the table or text view is shown, a chip ("Table ×") that returns to
     the renderer in one click (named "Showing table; show the Graph renderer";
     with no renderer it only says what is shown);
  2. the renderer's `zoom` group of declared controls, as icon buttons (hidden
     while the table or text view is shown);
  3. **Filter**, which expands into the "Filter rows" field;
  4. **Settings**, a menu (`settingsModel`): **Show as** first (the renderer by
     its title, **Table** or **Text**, radio items) and **Changes only**, then
     submenus: **Highlight changes**, **Renderer**, **Playback** (animated: Loop
     and Holds, not under reduced motion, and Speed) and the renderer's other
     declared controls by group (not while the table or text view is shown). It
     is never taller than the room beside its button (it opens over the button
     when there is more room there) and scrolls inside; the keyboard moves
     through it and its submenus (Right Arrow opens one, Left Arrow closes it),
     scrolling the focused item into view;
  5. **About this projection**: the title, counts, the active renderer, the
     comparator, and diagnostics and limitations;
  6. `actions`, then **Enter full screen** (the Fullscreen API, or a fixed
     overlay where element full screen is unavailable).

The table and text views are escape hatches, so they live in Settings rather
than the row; without a renderer, or when it fails, the view still falls back to
them. The play button calls the core's `togglePlayback()`: it pauses while
playing, and otherwise plays in `nextDirection` (forward from the before end,
backward from the after end, else the way playback, a step or a seek last went),
named "Play forward", "Play backward" (a mirrored icon) or "Pause". With Loop on
it starts and stops the back-and-forth. Under reduced motion it shows the other
endpoint at once and is named "Show <after label>" or "Show <before label>".
**Space** toggles playback while focus is in the row or on the stage's chrome
(the row and stage take focus when their background is clicked), but not in text
fields or controls that use Space themselves.

### The toolbar

The toolbar never wraps, and no control ever overlaps, clips or leaves another:
it is **planned** from its own width (a ResizeObserver on the toolbar, not the
viewport, since a view is embedded at any width; `useToolbarLayout` in
`packages/host/core/src/ui/toolbar-layout.ts`, over the generic `useFitPlan` in
`fit-plan.ts`). Each plan is measured as rendered, before paint, with every
control at its minimum size: the slider at 160px (120px on a toolbar under
480px), the pickers at their compact width, and every control (buttons, pickers,
the chip and the round play button) 32px tall. It shows the most spacious plan
that fits. **One row is preferred**: as the toolbar narrows, it collapses in
priority order while one row still fits at those minimums:

1. the Before/After selects become compact triggers with the short revision
   names ("v1"), truncated, the full names as their titles;
2. the mode switch drops its labels (each icon keeps its label as tooltip and
   accessible name), then becomes one dropdown button with the current mode's
   icon ("Comparison mode: Animated");
3. the step buttons and percent move into the playback group's overflow ("More
   playback controls"); the slider stays;
4. the actions move into **More** ("⋯") one at a time, in `actionCollapseOrder`:
   zoom, About, full screen, then Filter (Settings and `actions` stay); then the
   steps and percent join them there.

Only when one row can't fit even then does playback take **a planned second
row**: the play button, the step buttons, a slider spanning at least 80% of the
row (inset from the toolbar's edge, so its thumb never touches the border) and
the percent; the steps and percent move into the group's overflow, or into More,
only when the row needs it to keep the slider's span. Row 1 then has the width
to itself, so it starts again from its most spacious forms (all actions inline)
and collapses in the same order; it is used only while it stays at least 62%
full (`firstRowFill`), else one row with the pickers merged is preferred. Last:

5. the pickers merge into one compare button ("v1 → v3", named "Revisions: …")
   whose "Revisions" popover holds both selects and Swap.

Without playback (side by side, swipe, diff) the single row continues with
step 5. With nothing at its start (one revision and no `toolbarStart`: no
pickers, modes or playback) the band keeps its full width, with its end group
(the chip, zoom, Filter, Settings, About, full screen) at the right. Hidden
controls keep their accessible names in their overflow menus. A more spacious
plan returns only once the toolbar is 24px wider than it needs (hysteresis), so
the toolbar doesn't flicker at a boundary; while a person is using a region
(focus in it, or in a popover it opened) its form is kept, so the control in
their hands isn't remounted. On a two-row toolbar, Filter opens its field in a
popover. Storybook shows the explorer at 1440, 1024, 768, 600, 480 and 390px
(Default UI › Comparison explorer › At …px).

### The stage

At 1440×900 and on an iPhone 13 the stage takes at least 80% of the view's
height. Pane labels are 28px header bands above the panes, never over their
content; in swipe each band is clipped with its layer. Left and right, side by
side's panes meet at one `divider` hairline rather than a gutter
(`ProjectionStage`'s `paneEdge.between`; a host's own `paneEdge` without it
keeps the 16px gutter), and `paneArrangement` sizes the columns with that 1px.
Swipe's divider (`.ph-swipe-handle`) is one control: its 1px line
(`.ph-swipe-line`) and the thumb's outline take `--ph-swipe-edge` (the accent by
default), the thumb is filled with `--ph-swipe-fill`, and the handle carries
`data-dragging` and `data-focus-visible`, so a host UI changes line and thumb
together. Side by side links its panes by shared selection styling and a brief
pulse on the counterpart of a selection (`data-projections-pulse`); the
connector between them is off unless a host opts in with the `connector` prop
(no setting toggles it). Notices and failure alerts stay visible below it. The
active-view label (`[data-active-view]`) and the comparator line
(`.ph-comparator`) stay mounted, visually hidden.

The views **fill their container's height** by default: give it a definite
height (for example `height: 100dvh`). Without one they keep a usable minimum.
`fill={false}` sizes them to their content instead. A host that lays a
content-sized view flat on its page's column can line renderer content up with
that column: `ProjectionStage`'s `bleed` extends the frames that far past the
stage's outer edges, into the page's gutter, and the host sends the same length
as the `stage-inset` theme token, where renderers start their content (rings at
the edges then still show). A host that also sends `stage-max-height` (for
example `100vh`) caps stages that pan and zoom at that height; they then pan by
dragging, so the wheel scrolls the page. `features` turns off blocks and views
(`playback`, `modes`, `highlighting`, `changesOnly`, `search`, `rendererChoice`,
`speed`, `rendererControls`, `zoom`, `table`, `text`, `info`, `fullscreen`,
`title`, `annotations`, `summary`); `actions` adds host content to the row.

### The summary bar

A thin band along the bottom of every view (`SummaryBar`, `[data-summary-bar]`,
named "Summary", 28px under its hairline), under the renderer, table and text
alike, like an editor's status bar: small muted text, a figure per kind in the
renderer's words (`12 workspaces · 18 dependencies`), and in a comparison each
figure's changes after it (`12 workspaces +1 −1`), only the change figures in
their change colors. Every figure is a toggle for `summaryFilter`: the total
shows only those items, `+1` only the added ones, and pressing it again shows
every item. A renderer adds fact figures, findings no kind count says
(`2 breaking changes`, `1 newly enforced`, `3 to replace`) or measures that
aren't kinds (`39,882 lines of code`): its theme icon (a badge, such as
`breaking`, `upgraded` or a planned action, on its disc as in the renderer:
`iconMaskStyle`), count and noun, muted unless it has a tone, a filter toggle
only when it names its items (`ids`; `summaryFilterable`), and in a comparison
its changes after it in their change colors, as a count's, but not filters
(`39,882 lines of code +2,056`). Its `description` (such as the rules that
classified it) is its tooltip and accessible description. Renderers draw no
summary line of their own: the bar is their summary in every view, and the text
view opens with the same sentence (`Summary: …`, `figuresSentence`; the
`summary` prop of `TextView`). Figures that don't fit collapse from the end into
a "…" popover (`useSummaryFit`, `fitSummary`). The count of items that varied
within tolerance sits at the bar's end (below). Its text, like the toolbar's
mode, varied and Show as labels, is centred by its cap height rather than its
line box (`text-box: trim-both cap alphabetic`, with a line box one cap high
where `text-box` is unsupported): a capital E has the same space above, below
and to its left in the bar (its inline padding is computed from the font's cap
height) and in a figure's pill.

**Volatile variation.** When a comparison has items that varied only within
tolerance, the summary bar's end shows their count, "3 varied within tolerance"
(`.ph-varied-toggle[data-varied-within]`), muted and neutral, never in a change
color. It is a toggle (`aria-pressed`) for `variedOnly`: pressed, the renderer,
table and text show only those items, as "changes only" shows only changes, and
pressing it again shows every item. With the `summary` feature off it returns to
the toolbar (`VariedToggle`), the first action to move into More on a narrow row
(`actionCollapseOrder`). These items are never highlighted or animated; the text
view adds how many of the unchanged items varied. The renderer kit marks a
modified item with a volatile value beyond tolerance with the neutral `varied`
icon beside its status.

**Generated values.** Items whose
[generated values](../design/generated-values.md) were reworded from an equal
basis are counted on their own, "1 regenerated"
(`.ph-regenerated-toggle[data-regenerated]`, with the `generated` sparkle),
before "varied within tolerance" and like it: muted, a toggle for
`regeneratedOnly`, and in the toolbar (`RegeneratedToggle`) without the summary
bar. The detail card lists the selected item's generated values first, each with
a quiet **Generated** mark: reworded from the same inputs, After's text with
"Regenerated from the same inputs" and a toggle for Before's wording; changed,
why ("Regenerated because the input changed") and both passages side by side,
with a toggle for a word diff. The toggles swap layers of one grid cell, so the
card never shifts.

### The detail card

Selecting an item opens a **detail card** anchored to it over the stage
(`DetailCard`, on the core's `useDetailCard`): nothing reflows, and the stage,
toolbar and frames keep their boxes. It sits beside the item and flips and
shifts to stay in view, follows the item as it moves, and on a stage narrower
than 640px is a bottom sheet over the stage. Escape, "Close details", a press on
the stage or the page outside the view, or selecting nothing close it; the
toolbar's controls keep it open. In order, it shows:

1. **What changed:** the change's pills (`statusTone`, "Renamed" in the moved
   hue) and the comparator's classification tags, its summary, then each changed
   field, old → new in the renderer kit's value-change vocabulary
   (`ValueChange`: the old value struck through in a removed pill, an arrow, the
   new one in an added pill; read as "was …, now …"). A changed `data` field is
   a selectable property target (`[data-property-path][data-side]`, pressed when
   selected, with its annotation count). In one extraction: **Properties**, the
   item's set fields. **Volatile values** (`VariedList`,
   `.ph-varied-field[data-varied-path][data-within]`) follow: each value of the
   change's `varied`, path and values in the monospace font, old → new, then
   "within tolerance" or "beyond tolerance (volatile)" (with the volatile icon)
   and the comparison's reason, all neutral. A modified item whose only
   difference is a volatile value lists it here rather than as a field.
2. **Where in the code:** each evidence location as a link where the host's
   `evidenceLink(location, side)` gives one (a hosted view can link a pull
   request's file diff at the line, or the file at the commit), else a button
   that calls `onOpen` (the Inspector and CLI open files), else plain text.
3. **Connections:** an entity's outgoing (→) and incoming (←) relationships, or
   a relationship's endpoints (From, To), with their change; each selects its
   item, moving the card.

It shows no identity, kind, confidence or raw data. The embedder's
`renderDetails` content follows in `.ph-details-slot`. `details="none"` turns
the card off, for an embedder that draws the selection itself, as the
Inspector's docked raw panel does (`RawDetails`: identity, kind, each side's
properties as targets and evidence, and the change's volatile values).

**Annotation markers:** a badge (`.ph-annotation[data-annotation-id]`) with the
count, or a dot, on each annotated row in the table and text views and in the
detail card's header.

## Layer-2 blocks

The blocks the prebuilt views are made of are a stable public tier, exported
from `@githubnext/projections-host/ui`, with the same names and props as the VS
Code UI's (`@githubnext/projections-host-vscode`) where both offer a block.
Their props and accessible names are versioned like the rest of the public API;
their styling is not. Each is bound to a `ProjectionController` from
`useProjection` (the picker to a `ComparisonPair` from `useComparisonPair`) and
renders inside a `ScopedRoot`:

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
| `PaneLabel` | `side`, `children`, `corner?` | A revision's label as a chip over a pane, for custom stages (from the core); `ProjectionStage` draws header bands, or chips in a strip above each pane with `paneLabels: 'chips'`. |
| `LoadingStatus` | `label`, `description?`, `reducedMotion?`, `fill?` | A loading state centered in the box it stands in for (from the core). |
| `DetailCard` | `projection`, `container`, `view?`, `onOpen?`, `evidenceLink?`, `beforeLabel?`, `renderDetails?`, `annotations?`, `sheetBelow?` | The selection's detail card over `container` (a positioned element around the stage), with the consumer slot (`.ph-details-slot`). |
| `VariedList` | `varied` | A change's volatile values (`RowDetails.varied`), neutrally: path, old → new, within or beyond tolerance. |
| `ValueChange` | `before?`, `after?` | A value that changed, old → new in removed and added pills. |
| `RawDetails` | `projection`, `row?`, `onClose?`, `onOpen?`, `beforeLabel?`, `afterLabel?`, `renderDetails?` | A row's raw details for a docked panel: identity, kind, each side's properties as targets and evidence. |

A custom view composes them around the core's `ProjectionStage`, for example a
toolbar of its own with the table as an escape hatch (Storybook: Default UI ›
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

`ScopedRoot` (also in `@githubnext/projections-host/ui/components`, with the
shadcn components) scopes the stylesheet; its own element takes plain CSS, not
`pj:` utilities.

Hooks for embedders that build their own features on targets, for example
comments (the UI itself shows no annotation content):

- `annotations?: readonly TargetAnnotation[]` and
  `onAnnotationActivate?: (activation: AnnotationActivation) => void`.
- `onSelectionChange?: (id: string | null, selection: ProjectionSelection | null) => void`:
  fires on every selection change, including a property path.
- `renderDetails?: (selection, projection) => ReactNode`: content at the end of
  the detail card, in `.ph-details-slot`.
- `evidenceLink?: (location, side) => string | undefined`: where the detail card
  links an evidence location (`{path, line?}`) on a side; `undefined` falls back
  to `onOpen`.
- `details?: 'card' | 'none'`: `none` turns the detail card off.
- `controllerRef?: Ref<ProjectionController | null>`: for `selectTarget`,
  `resolveTarget`, `anchorFor` (or `useProjectionAnchor`).
- `ComparisonExplorer` only: controlled `before`/`after` with
  `onBeforeChange`/`onAfterChange`.

The UI is built with shadcn/ui components (Radix primitives, copied into
`packages/host/core/src/ui/components` under MIT). Its Tailwind CSS v4 is
compiled with the `pj` prefix (classes are written `pj:bg-background`), under a
`.pj-root` scope and without a global reset. The build unwraps Tailwind's
cascade layers in order and scopes every rule, custom property and keyframe to
`.pj-root`, so embedding pages and the UI don't affect each other. The theme is
Projector (see `packages/host/core/src/ui/components/README.md`); renderer
frames receive its tokens. `./styles.css` remains as an alias of `./ui.css`.

**Surfaces and edges.** The chrome stacks the same surfaces as renderers, with
the renderer token set's own values (`defaultThemeTokens`, light and dark;
`test/theme.test.mjs` keeps `theme.css` equal to them, and `sharedSurfaceNames`
/ `projectorSurfaces` in `packages/host/core/src/ui/lib/tokens.ts` list them):

<!-- prettier-ignore -->
| `--pj-*` (Tailwind) | Token | Where the default UI draws it |
| --- | --- | --- |
| `surface-canvas` (`pj:bg-surface-canvas`) | `color-surface-canvas` | the stage behind cards: renderer frames and the table and text views' well (`.ph-scroll`), edge to edge |
| `surface-raised` | `color-surface-raised` | cards: each table (`.ph-table-scroll`), each text-view step (`.ph-step`), the detail card (`.ph-detail-card`); notices and failure alerts, as bands |
| `surface-header` | `color-surface-header` | header bands: the toolbar, the legend and the summary bar, table captions and column headers, step headings, the detail card's header |
| `surface-inset` | `color-surface-inset` | recessed wells (the Inspector's raw output, JSON and commands) |
| `divider` (`pj:border-divider`) | `color-divider` | a card's edge and a band's rule, 3:1 or more against every surface; quieter rules between rows keep `border` |
| `<change>-muted`, `<change>-border` | `color-<change>-muted`, `-border` | change fills and their edges, for `added`, `removed`, `modified` and `moved` |

**A tinted region always has a same-hue edge, never a fill alone.** Change chips
(`statusTone`) paint their `-muted` fill over the raised surface (opaque, so
their text stays AA on any row) inside a 1px `-border` edge; a legend swatch
with a change fill token (`color-<change>-muted` or `-highlight`) gets a 1px
`-border` edge; the lens's neutral selection fill (`lens-muted`, on a selected
row or property) keeps a 2px lens edge on its leading side, and the current
text-view step a lens ring; the destructive badge's faint red fill takes a
destructive edge. `packages/host/core/browser/surfaces.spec.ts` checks every
tinted fill in the table, text, detail card, legend and notices for its edge, in
both modes.

Projections apps (the Inspector) compose the same components from
`@githubnext/projections-host/ui/components`: render them inside `ScopedRoot`
and load `ui.css`. Only classes used in `packages/host/core/src/ui/**` and
`packages/host/inspector/src/**` are compiled into `ui.css`. Apps that bundle
the UI should append `hostUiNotices()` from
`@githubnext/projections-host/build/ui-notices` to their third-party notices
(shadcn/ui, Radix, lucide and friends; MIT, ISC, 0BSD and Apache-2.0 for
class-variance-authority).
