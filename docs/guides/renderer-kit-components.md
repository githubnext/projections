# Renderer kit components

## Presentation helpers and components

The kit bundles a set of presentation utilities and React primitives so you do
not have to reinvent change emphasis, legends, summary bars, or styling rules:

- **Step-scoped emphasis.**
  `stepEmphasis(schedule, progress, highlighting, pane?)` (passed to components
  as `emphasis`) scopes change emphasis to each change's own step. A change
  stays neutral until its step's window opens (following the schedule's
  traversal direction so reverse orders mirror it), then takes the host's
  highlighting (0 at both endpoints) without pre-tinting later changes. In a
  held side-by-side or swipe pane (`pane`), every visible change receives the
  host's highlighting equally so Before marks removals and After marks
  additions. Use this for all change decoration;
  `presentedEmphasis(change, highlighting)` is the unscoped alternative.
- **Model and change helpers.** `classifyChange`, `describeChange`,
  `statusLabels`, `isChanged`, `edgePaint`, `current(row, progress)`,
  `entityPresence`, `numericValue`, `isKind`, `edgeKind`, and `edgePresence`
  cover common per-entity and per-edge calculations. For lookup tables,
  `useDomainIndex(model, progress, {include, presence})` and
  `domainIndex(model)` key rows by identity and resolve relationships to entity
  rows (`changeOf`, `out`, `into`, `visible`).
- **Basic UI pieces.** `Badge`, `EmptyDomain`, `Notice`, `KindLegend`,
  `EdgeArrowMarker`, `edgeMarkerId`, and `RendererBoundary`.
- **Volatile data.** When a `modified` change includes a volatile value outside
  its tolerance (`variedBeyond`, re-exported from the SDK), it displays
  `VariedMarker`—the `varied` icon in neutral text color (never a change color),
  labeled "Volatile field changed beyond tolerance"—next to its status. `Badge`,
  `ChangeFooter`, `ChangeStatus`, `StatusTab`, and `SvgChangeStatus` render it
  automatically in every mode (including diff) from the row's `varied` flag and
  fade it alongside the status. Changes within tolerance stay `unchanged`, with
  no status, emphasis, or motion.
- **Generated values.** `GeneratedText({name, before?, after, entry?, bases?})`
  displays a [generated value](../design/generated-values.md) with its name in
  monospace and a quiet `GeneratedMark` (`generated` icon plus "Generated").
  Without `entry`, it renders the value directly. When regenerated from an
  unchanged basis (`entry.within`), it shows After's text with "Regenerated from
  the same inputs" and a toggle for Before's wording—never a word diff. When the
  basis moved, it explains why (`generatedWords`), puts both passages side by
  side, and offers a toggle for a string word diff. None of these toggles shift
  layout. Use `generatedPaths(extraction, item)` (from the SDK) to locate an
  item's generated values.
- **Legends.** Never draw a legend inside your frame. Instead, call
  `useLegend(props.reportLegend, legend)` to hand it to the host, which draws it
  once beside the panes (including side-by-side and swipe). `KindLegend` reports
  entity kinds as plain labels (rendering chips only outside a kit renderer),
  and `boundedLegend` trims any legend to protocol limits. Always describe the
  entire document across both revisions so the legend stays stable during
  scrubbing, and reuse the exact `chart-n` tokens painted in the frame.
- **Summary bar.** The host renders a bottom bar with a figure per extraction
  kind (`12 workspaces · 18 dependencies`, plus per-kind deltas in a comparison)
  followed by your renderer's facts. Because the shell counts kinds and sends
  `summary` automatically (`rendererSummary`), renderers never draw their own
  summary or statistics row—just name your kinds and provide any domain facts:
  - **Kinds:** pass `nouns` in view `options` or `mountRenderer`
    (`MountOptions.nouns`: `{kind: {singular, plural}}`, `false` to omit
    structural kinds like `contains`, or `relationships:kind` for a single
    collection; listed kinds come first in order, and kinds with identical names
    merge into one figure). When wording depends on document contents (such as
    workspaces in the dependency graph), call
    `useSummaryNouns(props.declareNouns, nouns)`. Unnamed kinds fall back to
    `humanizeKind`.
  - **Facts:** `facts(context)` (`MountOptions.facts`) computes findings that no
    kind count captures from `{init, model, controls, rendererName}` alone,
    ensuring the summary stays constant across progress and panes. Each
    `SummaryFactItem` has the shape
    `{type: 'fact', id, icon?, count, noun, ids?, added?, removed?, modified?, description?}`.
    `icon` picks from the SDK vocabulary (`breaking`, `upgraded`, `enforced`),
    `ids` makes the fact clickable as a filter, `added`/`removed`/`modified`
    show comparison deltas in change colors (use `summaryChange(was, now)` for a
    net measure delta like `39,882 lines of code +2,056`), and `description`
    sets the tooltip (for example, the classification rules). The shell appends
    facts after kind counts and enforces protocol limits—if a fact references
    too many items, it keeps its count and drops its filter.
- **Rings and arrowheads.** Hover, focus, and selection rings belong to the SDK
  (`connectRings`, started by `connectRenderer`; see [Item rings](#item-rings)).
  They style each unit's own element (an inset outline on HTML units, or the
  stroke of an SVG unit's `data-projections-edge` shape), so the kit has no ring
  component and renderers should never draw their own selection borders. Kit
  components mark their SVG edges automatically. Nested sub-items (a table
  column, a row inside a card) take `pk-part` in HTML for a subtle inset tint
  rather than a second ring, and SVG elements never use CSS outlines (which ring
  the bounding box). `arrowheadPath(x, y, angle, size)` builds an equilateral
  rounded arrowhead styled with `.pk-arrowhead`.
- **Casing.** Keep data (identifiers, names, kinds, enum values) exactly as
  extracted, and write UI copy (labels, headings, legends, status text) in
  sentence case. Never recase text in CSS—`npm run check:casing` fails on
  `text-transform: uppercase`, `capitalize`, or small caps. Quiet a label using
  the type scale and muted tone instead.

## No nested change colors

Only the innermost changed elements should carry a change color or accent. Any
container showing changes inside it—a modified card holding added and removed
pills, a table containing changed columns, or a boundary wrapping changed
cards—stays neutral: no tinted fill or change-colored border, just a neutral
edge and muted status text so it remains easy to spot while color stays focused
on what actually changed.

The kit's stylesheets handle most cases automatically. Any element with
`data-change` (or a progress-mode card with `data-status`) that contains
`data-change` children (like a `ValueChange`'s pills) or an `SvgValueChange`
turns neutral, as do `Group` containers holding changed items and graph
boundaries containing changed cards or links (`boundariesHoldingChanges`). When
changes are drawn over a container rather than nested inside it (such as a
folder around changed files in file packing), add `pk-holds-changes`. When
changes are not marked with `data-change` (like a gallery card wrapping a nested
comparison renderer), pass `holdsChanges` to `EntityCard` or `Group`. Status
text (`.pk-status-part`) follows its nearest enclosing changed element, and the
`nested-accents` check fails any change or accent color painted inside another.

## One line per boundary

Adjacent rows, cards, and panels share a single boundary line—never two parallel
lines sitting side by side—and wherever a change region meets a neutral rule,
the change color owns that line.

The kit's `pk-region-run` helper (for contiguous rows) draws its border on the
surrounding lines, painting one stroke outside the run over a neighbor's rule, a
header's bottom edge, or the container border. When two runs touch, the later
run's top edge draws the shared line. Each side is a switch, `--pk-run-out-top`,
`-right`, `-bottom` or `-left`, holding a stroke or `0px`: a renderer turns a
side off where its row draws that line itself, or where the run's next sibling
sits beside it rather than below (text diff's split columns turn the kit's "next
run starts below" rule back off for that reason). Because `Group` clips to its
outer edge (`overflow: clip` with the border width as its margin, or a
`clip-path` where the browser lacks that margin), a run flush against the
group's edge cleanly replaces the group's border there. Anything that reaches a
group's corner uses the group's inner radius (`--pk-group-inner-radius`: the
radius minus the border width), so it stays concentric with the border and never
covers it. The header band takes it at the top, and a renderer's last row or
band at the bottom (as runtime policy's last rows and text diff's last line do).
To keep that outer stroke visible inside a scrolling container, extend the
scroll box over the card edge by one border width and pad it back in (as text
diff does). For rows that draw their own side borders (like runtime policy's
bottom-bordered rows or text diff's After column), color that border with
`--pk-region-line` (fading to `--pk-line`) instead of adding a second edge next
to it. A changed `EntityCard` acting as a change region colors its own border,
and a pill containing a `ValueChange` draws no outer frame around its two inner
pills.

## Frames: borders drawn over their contents

`Group` is the kit's frame: a bordered, rounded box with filled contents. A fill
that meets the border's curve, even one concentric with it, dilutes the border's
antialiased pixels, so the arc comes out thinner than the sides (runtime
policy's header band did this). So a group draws its border a second time over
everything it holds, as an overlay on `--pk-layer-frame`, and change runs draw
their edges above that on `--pk-layer-change-edge`, so the change color still
wins the boundary. Two rules keep this working:

- Nothing between a group and the runs inside it may form a stacking context
  (`isolation`, a `z-index` on a positioned wrapper, `opacity` below 1,
  `transform`, `filter`), or the runs' edges sink under the group's.
- While the SDK rings a group, the ring is its edge: the overlay steps aside and
  the runs inside drop under the group's paint, since an outline paints under
  positioned descendants. The SDK publishes the state as `--projections-ringed`
  (1 on a ringed HTML unit, never inherited). A unit with positioned rows can
  query it with `@container style(--projections-ringed: 1)`, as runtime policy's
  hook lanes do.

`DataTable` draws its frame's top again outside its scroll box, from a box that
never scrolls, because the scroll box's rounded clip thins any line inside it
that follows the same curve. The harness `frames` spec checks every scenario's
groups and tables in pixels, light and dark: each corner's arc stays within 93%
to 160% of its sides, and no stacking context sits between a group and its runs.

## Item rings

Hover, keyboard focus, and selection appear as a single ring per unit, drawn by
the renderer SDK's rings module (in `@githubnext/projections/renderer`, started
by `connectRenderer`) for every renderer. Because the ring is **styling on the
unit's own element**, it moves, scales, scrolls, clips, and fades on the exact
same frame through any transform, zoom, or animation:

- **Units** — A top-level `data-entity-id` element, or an element explicitly
  marked `data-projections-unit`. Any nested entity is a part: hovering,
  focusing, or selecting it rings its parent unit, while parts take a quiet tint
  (`pk-part`) instead of a second ring.
- **HTML units** — Styled with an `outline` at a negative `outline-offset` equal
  to its width, so it follows per-corner and elliptical `border-radius`, covers
  the unit's border inward from its outer edge, and is never clipped by
  `overflow`. Focusable controls inside a unit hand their focus outline up to
  the unit.
- **SVG units** — Restyle the stroke of the shape marked `data-projections-edge`
  (such as a card rect or circle) in screen pixels, without creating a second
  shape. Because SVG strokes center on the path, a ring thicker than the resting
  border extends outward by half the difference.
- **Lines** — Relationships, arrows, and connectors highlight directly rather
  than taking an outline. Mark their path `data-projections-edge="line"` so it
  switches to the accent color (slightly heavier on hover, selection width when
  selected, heavier solid stroke on focus). Changed lines (green or red) turn
  accent while selected and return to their change color afterward, while the
  card status and summary retain the change state. Their arrowhead
  (`data-projections-edge="fill"`, including on `EdgeArrowMarker`) updates its
  fill and stroke to match; an arrowhead rendered in a separate layer links up
  with `data-projections-ring-with="<id>"`.
- **States** — Hover (pointer or mirrored host hover), selection (heavier), and
  keyboard focus (focus color, using a double outline on HTML and a dashed
  stroke on SVG so focus is distinct from selection). Priority is focus >
  selection > hover. Ring widths derive from border tokens (`border-width-thick`
  for hover, thick + thin for selection, 3 × thick for focus) to satisfy WCAG
  2.2 focus appearance, and forced-colors mode uses `Highlight` and
  `CanvasText`. The SDK toggles `data-projections-ring-hover` and
  `data-projections-ring-selected` on units; CSS handles everything else.

**The contract.** The unit (or its marked SVG edge) must be the element that
paints the item's visible edge. The built-in `rings` check—run by renderer
testing, `projections check`, the Inspector, and the harness—verifies every unit
across hover, focus, and selection in both default and diff modes, flagging the
specific fix whenever any of these break:

- The visible edge lives on a child inside a bare wrapper (move `data-entity-id`
  or `data-projections-unit` onto that child).
- The edge is painted outside the box via a spread `box-shadow` or positive
  outline offset (use a real border or a negative-offset outline instead).
- A positioned descendant paints over the outline (keep it in normal flow or
  inset it).
- A row touches a rounded group's corner without inheriting the group's inner
  radius (apply that radius).
- The unit sits a few pixels inside another edge, or vice versa, creating double
  concentric edges.
- An SVG unit has no marked edge shape, or marks the wrong shape.
- A line carries an outline, shadow, or halo around it.
- The renderer draws its own ring, outline, or state border.

A row sitting flush inside an edged group may keep the group's outer edge on
shared sides, and a neighbor's separator rule may remain against it; the check
permits both. Pixel-level coverage comes from the harness's `ring-pixels` suite
(every built-in renderer), its `rings` suite
(`harness/browser/fixtures/rings.html`), and Storybook's `rings` suite (the
infrastructure story in diff mode at opening scale, scrolled, and zoomed).

### Decision

We evaluated three approaches before settling on this one:

1. **The kit ring** used an inset `::after` pseudo-element with
   `border-radius: inherit` on `pk-item`. It only aligned when authors placed
   the class on the exact border-owning element, and even then sat 1–2 px inside
   a bordered item with the outer radius on an inner box.
2. **An SDK overlay** measured each item's border box and radii (or SVG screen
   matrix) and painted the ring in a separate top layer. It passed the
   adversarial fixture, but being detached from the element meant it drifted
   behind live transforms—on the infrastructure story (diff mode, scaled
   `translate … scale` groups, opened zoomed and scrolled), the ring sat roughly
   20 px off its card. We rejected it: "if the highlight is a 'separate thing'
   this will almost certainly not work. It needs to be styling on the actual
   element."
3. **Styling on the element** (the current design) uses CSS `outline` on HTML
   units and restyles the marked SVG edge's stroke. Because it is the element's
   own paint, it can never drift out of sync, and edge cases the overlay used to
   mask (bare wrappers, spread shadows, positioned headers, unrounded corners)
   become explicit, actionable `rings` check diagnostics.

Measurements from the adversarial fixture comparing the HTML half of design 3
against the earlier kit ring (SVG shapes cannot use CSS `outline`, which is why
design 3 restyles their stroke instead):

<!-- prettier-ignore -->
| Fixture item | `outline`, negative offset | inset `::after` (the kit ring) |
|---|---|---|
| Plain card, 1 px border | ok | 1 px inside the edge: two edges |
| Card in a bare wrapper | 6 px outside the card (now a check failure) | 6 px outside the card |
| Scaled card | ok | 1 px inside |
| Per-corner radii, 2 px border | ok | 2 px inside |
| No border, 2 px border | ok | 2 px inside a 2 px border |
| Spread-shadow edge | 1 px inside (now a check failure) | 1 px inside |
| Rows in a rounded group | inside the group's edge (allowed, with the group's inner radius at shared corners) | the same |
| SVG shapes | not painted, or the square bounding box | not painted |

## Layout components

If you compose your renderer from these primitives, you do not need any custom
CSS. Every color, font size, and spacing step comes from the theme tokens, so
your view passes `palette`, `type-scale`, and `spacing` automatically. Props
accept token scale steps rather than raw lengths or colors—this is how
`projections init --renderer custom` scaffolds a stylesheet-free renderer.

- `ContentView` is the root scroll container on the stage surface, inset evenly
  on all four sides by the host's `stage-inset` (defaulting to 12 px) so cards
  and tables sit cleanly in the frame. Custom root elements can get the same
  framing by adding `pk-stage` and leaving margins off outer cards.
- `Group` renders a raised, edged panel with a header band and full-bleed body
  (card grids inside keep the band's inset)—the standard container for a titled
  table, list, or card set. Set `titleFont="code"` for code identifiers (a
  command, kind, or path) in monospace while keeping prose titles in the UI
  font. `icon` places a muted subject icon (`file`, `workload`, or any
  vocabulary icon) before the title, centered on its capitals—use icons on every
  group in a view or none at all. `meta` adds muted trailing text and `actions`
  places buttons at the end of the header band. In comparisons, `change` and
  `emphasis` render status text in a reserved `--pk-status-width` cell, and in
  diff mode `mark` styles the group and strikes through removed titles. Passing
  `id`, `selected`, and `onSelect` turns the group itself into a selectable ring
  unit whose title acts as the select button.
- `CardGrid` lays cards out in as many columns as fit, collapsing to one column
  on phones.
- `EntityCard` renders a single entity as a ring unit with `data-entity-id`, a
  select button, `label`, `identifier`, `children`, and worded change status. In
  progress modes, its leading edge picks up the change hue as `emphasis` rises
  while `presence` fades it in or out; in diff mode, `mark={change}` applies
  standard kit change-region styling.
- `RelationshipList` and `RelationshipItem` list a card's relationships, each a
  selectable unit with its own ID, `presence`, and (in diff mode) `mark` and
  `changeText`.
- `Fields` and `Field` display name-value pairs with identifier-styled names.
- `Stack` and `Inline` arrange children in a vertical column or wrapping row
  with `gap={1…8}` steps from the spacing scale.
- `Text` renders typography using `size` (`xs`, `sm`, `md`, `lg`, `xl`),
  `weight`, and `tone` (`default`, `muted`, `subtle`).

## Data tables

When your entities share comparable properties, reach for `DataTable` instead of
hand-rolling table markup—it handles sorting, diffing, folding, and theme checks
out of the box:

```tsx
import {tableSortControls} from '@githubnext/projections/kit'
import {DataTable, useTableProps} from '@githubnext/projections/kit/react'
import type {DataTableColumn, RendererProps, ViewOptions} from '@githubnext/projections/kit/react'
import type {Entity} from '@githubnext/projections/schemas'

const columns: DataTableColumn<Entity>[] = [
  {id: 'name', label: 'Service', value: entity => entity.label ?? entity.id, font: 'code'},
  {id: 'replicas', label: 'Replicas', value: entity => entity.data?.replicas as number, sort: 'number'},
]
export const options: ViewOptions = {
  controls: tableSortControls({columns, default: {column: 'replicas', direction: 'descending'}}),
}
export function View(props: RendererProps) {
  return <DataTable {...useTableProps(props)} label="Services" columns={columns} rows={props.model.entities} />
}
```

- **Columns** — `value(item)` extracts the sortable value for one version of a
  row and formats it for display (using the host's locale for numbers) unless
  `render(item)` overrides it. Set `font: 'code'` for identifiers while keeping
  column headings in the UI font. `align` defaults to `end` for numeric columns,
  and `width` defaults to `fill` for the first column and `fit` for the rest. A
  cell counts as changed when `value` differs between revisions or when
  `changed(before, after)` returns true.
- **Rows** — Pass `model.entities` or any compatible `TableRow` list (`id`,
  `before`, `after`, `status`). Each row is a ring unit with `data-entity-id`,
  and its first cell serves as the select button.
- **Sorting** — Every sortable column header is a button (with `aria-sort` on
  the active column) that toggles sort direction. Configure sorting with
  `sort: 'number' | 'string' | (a, b) => number | false`. Strings use natural
  ordering (`v2` before `v10`), missing values sort last in both directions, and
  label plus ID break ties. `tableSortControls({columns, default})` registers a
  "Sort by" choice and a "Changes first" toggle in the host's settings so the
  host persists the sort and agents can inspect or change it.
  `useTableProps(props)` wires those controls up and forwards header clicks via
  `RendererProps.setControl` so headers, settings, and agents stay in sync.
  Without `onSortChange`, headers remain static.
- **Comparisons** — Rows sort by their After version (or Before for removed
  rows), keeping row order fixed throughout playback. A status column explains
  each change in words. In diff mode, changed cells render a `ValueChange` (was
  → now), added and removed rows render as change regions, and rows containing
  changed cells stay neutral to avoid nested change colors. In progress modes,
  each row reflects its current version (`rowProgress`, a staged timeline's
  `local`), entering or leaving rows fade in place, and changed cells tint as
  pills during emphasis before returning to plain text at the endpoints.
- **Lines** — Rows own the table's outer frame and internal rules—one line per
  boundary—and paint identically in any sort order. Where a neutral rule meets a
  change-colored rule, the change hue wins: fully colored rows (added, removed,
  renamed) stack above neutral rows holding changed cells, which stack above
  unchanged rows and the frame. The header row's rule belongs to the frame and
  always wins over the first row beneath it. Inside a `Group`, the table serves
  as the body: the group omits its own border and its header band joins directly
  onto the table's frame.
- **Changes scope** — When `scope` (`RendererProps.scope`, wired through
  `useTableProps`) hides unchanged rows, each contiguous hidden run collapses in
  sorted order into a single `Fold` row ("12 unchanged languages", using `noun`)
  that expands in place and shares the table's border rule.
- **Scrolling** — Tables wider than the frame scroll horizontally in their own
  container with the first column frozen (pass `frozen={false}` to let it scroll
  with the rest).

When you occasionally need an inline style that these components do not cover,
use `token` (re-exported from the SDK) for compile-time-checked CSS values:
`token.space(2)`, `token.color('fg-muted')`, `token.fontSize('sm')`,
`token.radius('sm')`, and `token.chart(index)`.
