# Renderer kit components

## Presentation helpers and components

- `stepEmphasis(schedule, progress, highlighting, pane?)` (passed to components
  as `emphasis`): change emphasis scoped to each change's own step. A change
  shows none until its step's window begins (in the direction the schedule is
  travelled, so explicit reverse orders mirror it), then the host's
  highlighting, which is 0 at both endpoints; earlier steps never pre-tint later
  changes. A held pane of side by side or swipe (`pane`) is a static comparison:
  every change it shows takes the host's highlighting alike, so Before marks its
  removals as After marks its additions. Use it for all change decoration.
  `presentedEmphasis(change, highlighting)` is the unscoped form.
- `classifyChange`, `describeChange`, `statusLabels`, `isChanged`, `edgePaint`,
  `current(row, progress)`, `entityPresence`, `numericValue`, `isKind`,
  `edgeKind`, `edgePresence`.
- `useDomainIndex(model, progress, {include, presence})` / `domainIndex(model)`:
  rows keyed by identity with relationships resolved to entity rows (`changeOf`,
  `out`, `into`, `visible`).
- Components: `Badge`, `EmptyDomain`, `Notice`, `KindLegend`, `EdgeArrowMarker`,
  `edgeMarkerId`, `RendererBoundary`.
- Volatile data: a `modified` change with a volatile value beyond its tolerance
  (`variedBeyond`, re-exported from the SDK) gets `VariedMarker`, the `varied`
  icon in the text color (never a change color) named "Volatile field changed
  beyond tolerance", beside its status. `Badge`, `ChangeFooter`, `ChangeStatus`,
  `StatusTab` and `SvgChangeStatus` draw it themselves, in every mode (diff
  included), from the row's `varied`, and it fades with the status. A change
  that varied only within tolerance is `unchanged`: no status, emphasis or
  motion.
- Generated values: `GeneratedText({name, before?, after, entry?, bases?})`
  draws a [generated value](../design/generated-values.md) with its name in mono
  and the quiet `GeneratedMark` (the `generated` icon and "Generated"). Without
  `entry`, the value; reworded from an equal basis (`entry.within`), After's
  text with "Regenerated from the same inputs" and a toggle for Before's
  wording, never a word diff; with a moved basis, why (`generatedWords`) and
  both passages side by side, with a toggle for a word diff of strings. Toggles
  never shift layout. `generatedPaths(extraction, item)` (from the SDK) finds an
  item's generated values.
- Legends: renderers draw no legend in the frame.
  `useLegend(props.reportLegend, legend)` sends one to the host, which draws it
  once beside every pane (also side by side and swipe); `KindLegend` sends
  entity kinds as plain labels (and draws them as chips only outside a kit
  renderer), and `boundedLegend` fits any legend to the protocol's limits.
  Describe the whole document (both revisions), so the legend never changes
  while scrubbing, and use the same tokens the frame paints (`chart-n` in the
  frame's order).
- Summary bar: the host draws a bar along the bottom of every view with a figure
  per extraction kind (`12 workspaces · 18 dependencies`, and the changes of
  each in a comparison), then the renderer's facts. The shell counts every kind
  and posts the `summary` for each document itself (`rendererSummary`), so a
  renderer only names its kinds and states its facts. Renderers draw no summary
  or statistics row of their own.
  - Kinds: `nouns` in the view's `options` or `mountRenderer`'s
    (`MountOptions.nouns`: `{kind: {singular, plural}}`, `false` to leave a
    structural kind such as `contains` out, `relationships:kind` for one
    collection's kind; listed kinds come first, in order; kinds named alike are
    one figure), or `useSummaryNouns(props.declareNouns, nouns)` for words that
    depend on the document (the dependency graph's workspaces). Unnamed kinds
    take the host's words (`humanizeKind`).
  - Facts: `facts(context)` (`MountOptions.facts`) returns the findings no kind
    count says, from `{init, model, controls, rendererName}` only, so the
    summary is the same at every progress and in both panes:
    `{type: 'fact', id, icon?, count, noun, ids?, added?, removed?, modified?, description?}`
    (`SummaryFactItem`). An `icon` names the SDK's icon vocabulary (`breaking`,
    `upgraded`, `enforced`); `ids` (change or item IDs) make it a filter;
    `added`, `removed` and `modified` are its changes in a comparison, drawn in
    the change colors, and `summaryChange(was, now)` words a measure's net
    change (`39,882 lines of code +2,056`); `description` is its tooltip, such
    as the rules that classified it. The shell posts facts after the kind counts
    and keeps the summary within the protocol's bounds (a fact naming too many
    items keeps its count and loses its filter).

- Hover, focus and selection rings are the renderer SDK's (`connectRings`,
  started by `connectRenderer`; see [Item rings](#item-rings)): styling on each
  unit's own element (an outline inside an HTML unit's border, the stroke of an
  SVG unit's `data-projections-edge` shape), so the kit has no ring class or
  component and renderers draw no ring, outline or selection border of their
  own. Kit components mark their SVG edges. A part of a unit (an entity nested
  in another: a column in a table, a row in a card) takes `pk-part` (HTML) and
  gets a quieter inset tint, never a second ring. SVG elements never take an
  outline (browsers ring their bounding box). `arrowheadPath(x, y, angle, size)`
  draws an equilateral, rounded arrowhead (fill and stroke it in one color with
  `.pk-arrowhead`).
- Casing: data (identifiers, names, kinds, enum values) appears exactly as the
  data has it; labels, headings, legends and status words are written in
  sentence case. No style recases text (`npm run check:casing` fails on
  `text-transform: uppercase` or `capitalize` and on small caps); quiet a label
  with the type scale and the muted tone.

## No nested change colors

Only the innermost changed elements take a change hue (or the accent). An item
that shows changes inside it (a modified card around its added and removed
pills, a table around its changed columns, a boundary around changed cards)
stays neutral: no tinted fill or change edge, just a neutral edge and its status
words muted, so it can still be found while only what changed inside it is
colored. The kit's styles do this. An item marked `data-change` (or a
progress-mode card's `data-status`) that holds changed parts marked
`data-change` (as a `ValueChange`'s pills are) or an `SvgValueChange` is drawn
neutral, as is a `Group` holding changed items and a graph boundary with changed
cards or links inside it (`boundariesHoldingChanges`). Mark `pk-holds-changes`
on anything that has changes drawn over it rather than inside it, as the file
packing does for a folder around changed files. Status words (`.pk-status-part`)
follow the nearest changed element around them. The `nested-accents` renderer
check fails any change or accent color drawn inside another.

## Item rings

Hover, keyboard focus and selection show as one ring per unit, drawn by the
renderer SDK (its rings module, in `@githubnext/projections/renderer`, started
by `connectRenderer`) for every renderer, first-party or not, as **styling on
the unit's own element**. Because the ring is the element's own paint, it moves,
scales, scrolls, clips and fades with the item on the same frame, through any
transform, zoom or animation.

- **Unit.** An entity element (`data-entity-id`) not inside another, or one
  marked `data-projections-unit`. A nested entity is a part: hovering, focusing
  or selecting it rings its unit; renderers tint parts (`pk-part`), never ring
  them.
- **HTML units** take an `outline` at a negative `outline-offset` equal to its
  width: it follows `border-radius` (per corner and elliptical), covers the
  unit's border from its outer edge inwards and is never clipped by the unit's
  own `overflow`. Focusables inside a unit hand their outline to it.
- **SVG units** restyle the shape that draws their edge, marked
  `data-projections-edge` (a card's surface rect, a circle): its stroke takes
  the ring's color and width in screen pixels. No second shape is drawn. The
  stroke is centered on the shape, so a ring heavier than the edge reaches half
  the difference further out.
- **Lines** (relationships, arrows, connectors) are highlighted as themselves,
  never outlined: their path is marked `data-projections-edge="line"` and takes
  the accent, a little heavier on hover, at the selection width when selected
  and heavier still (solid) under focus. A changed line (green, red) takes the
  accent while selected and its change color again after; the change stays in
  the card status and summary. Its arrowhead (`data-projections-edge="fill"`,
  which keeps its shape and takes the color as fill and stroke, also on an
  `EdgeArrowMarker`) follows; a head drawn in another layer joins with
  `data-projections-ring-with="<id>"`.
- **States.** Hover (the pointer, or the host's mirrored hover), selection
  (heavier) and keyboard focus in the focus color: a double outline on HTML, a
  dashed stroke on SVG, so focus differs from selection. Focus wins over
  selection, selection over hover. Widths come from the border tokens (hover
  `border-width-thick`, selection thick + thin, focus 3 × thick), so focus meets
  WCAG 2.2 focus appearance. Forced colors use `Highlight` and `CanvasText`. The
  SDK marks the host's hover and the selection on units
  (`data-projections-ring-hover`, `data-projections-ring-selected`); the rest is
  CSS.

**The contract.** The unit (or its marked SVG edge) must be the element that
draws the item's visible edge. The built-in `rings` check (renderer testing,
`projections check`, the Inspector and the harness) holds every unit to it in
hover, focus and selection, in the default mode and the diff, and names the fix
when it doesn't hold:

- the edge is drawn by a child of a bare wrapper: put `data-entity-id` (or
  `data-projections-unit`) on that child;
- the edge is drawn outside the box (a spread `box-shadow`, an outline with a
  positive offset): draw it as a border, or an outline at minus its width;
- a positioned descendant paints over the ring (browsers paint outlines under
  positioned descendants): keep it in normal flow, or inset it;
- a row fills a corner of its rounded group without the group's inner radius:
  give it that radius;
- the unit sits a few pixels inside another edge, or another edge sits a few
  pixels inside it: two concentric edges;
- an SVG unit marks no edge shape, or not its visible one;
- a line is outlined (an outline, shadow or halo around it);
- the renderer draws a ring, outline or edge of its own for the state.

A row flush inside an edged group keeps the group's edge outside its ring on the
sides it shares, and a separator a neighbor draws against it stays too; the
check allows both. The harness's `ring-pixels` suite (every built-in renderer),
`rings` suite (the adversarial fixture `harness/browser/fixtures/rings.html`)
and Storybook's `rings` suite (the infrastructure story in diff mode, at the
opening scale, scrolled, zoomed in and out) confirm it in pixels.

### Decision

Three designs were tried:

1. **The kit ring**, an inset `::after` with `border-radius: inherit` on items
   that took `pk-item`: right only when the author put the class on the element
   that owns the edge, and even then 1–2 px inside a bordered item, with the
   outer radius on the inner box.
2. **An SDK overlay** that measured each item (border box and radii, or the SVG
   shape's screen matrix) and drew the ring in a layer above the document. It
   matched every case of the adversarial fixture, but as a separate thing it
   fell behind the item it followed: on the live infrastructure story (diff
   mode, cards in a scaled `translate … scale` group, the stage opening zoomed
   and scrolled) the ring sat about 20 px off its card. Rejected: "if the
   highlight is a 'separate thing' this will almost certainly not work. It needs
   to be styling on the actual element."
3. **Styling on the element** (this design): an outline on HTML units, the
   marked edge's own stroke on SVG. It is the item's paint, so nothing can fall
   out of step with it, and the cases the overlay papered over (a wrapper, an
   outside shadow, a positioned header, a row's corners) become author errors
   the `rings` check explains.

Measured on the fixture before the overlay was chosen (`outline` is design 3's
HTML half; an outline can't ring SVG shapes, which is why SVG edges restyle
their stroke instead):

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

A renderer composed from these needs no CSS of its own: they carry every color,
size and space from the theme, so they meet the renderer checks (`palette`,
`type-scale`, `spacing`) as they are. Their props take steps of the theme's
scales, never lengths or colors. The custom renderer
`projections init --renderer custom` scaffolds is built from them, with no
stylesheet.

- `ContentView`: The content root: the host's main scroll container, starting at
  the top of the frame, on the stage that groups and cards stand on, set in from
  the frame's edges by the same stage padding on all four sides (the host's
  `stage-inset`, else 12 px), so a card or table sits evenly in the frame. A
  renderer with a root of its own gets the same by giving it the class
  `pk-stage`; give the outer cards no margins.
- `Group`: A titled panel, the one pattern for a titled table, list or set of
  cards: raised and edged, its title in a header band inside its edge, then its
  body, which reaches its sides (a card grid keeps the band's inset).
  `titleFont="code"` draws a title that is code (a command, a kind, a path) in
  the monospace font, marked as an identifier; a title in words keeps the UI
  font. `icon` names the group's subject (`file`, `workload`; an icon from the
  vocabulary) with a muted icon before the title, centred on its capitals; give
  every group of a view one, or none. `meta` adds muted text after the title and
  `actions` content buttons at the band's end. In a comparison, `change` and
  `emphasis` state the change in words in a status cell at the end
  (`--pk-status-width`, reserved on every group), and in diff mode `mark` marks
  the group, striking a removed group's title through. With `id`, `selected` and
  `onSelect` the group presents an item: a ring unit whose title is the button
  that selects it.
- `CardGrid`: Cards in as many columns as fit, one on a phone.
- `EntityCard`: One entity: a ring unit with `data-entity-id`, a select button,
  its name (`label`) and `identifier`, `children`, and its change status in
  words. In the progress modes its leading edge takes the change's hue as
  `emphasis` rises, and `presence` fades it in or out; in diff mode
  `mark={change}` fills and edges it like any kit region.
- `RelationshipList`, `RelationshipItem`: A card's relationships, each a
  selectable unit with its own ID, `presence` and, in the diff, `mark` and
  `changeText`.
- `Fields`, `Field`: Name and value rows; names are identifiers.
- `Stack`, `Inline`: Children in a column or a wrapping row, `gap={1…8}` steps
  of the space scale apart.
- `Text`: Text with `size` (`xs`, `sm`, `md`, `lg`, `xl`), `weight` and a `tone`
  (`default`, `muted`, `subtle`).

For an inline style these don't cover, `token` (re-exported from the SDK) writes
a theme token as a CSS value, typed so a name that isn't a token doesn't
compile: `token.space(2)`, `token.color('fg-muted')`, `token.fontSize('sm')`,
`token.radius('sm')`, `token.chart(index)`.
