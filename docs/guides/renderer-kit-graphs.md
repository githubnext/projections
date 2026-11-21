# Renderer kit: graph canvas and geometry

This page covers the shared graph canvas, ELK layout pipeline, card sizing,
orthogonal/S-bend edge routing, spline interpolation, and arrowheads used across
the kit's graph-based renderers.

**Graph canvas (`GraphCanvas`).** The graph, DAG, architecture, infrastructure,
and dependency graph renderers all share `GraphCanvas`. Alongside
`RendererProps`, it accepts `orientation`, `compound`, `visibleIds`, `kindLine`,
`describeStatus`, `focus`, `detail`, `prose`, `synthetic`, and `changedFields`.

In diff mode, `GraphCanvas` renders one static union of both revisions (see
[Diff mode](renderer-kit.md#diff-mode)): every card and relationship sits where
the union layout places it and carries its change mark, while the host's summary
bar handles the change counts (see
[Presentation helpers and components](renderer-kit-components.md#presentation-helpers-and-components)).
For modified cards, `changedFields(row)` supplies the field-level changes drawn
inline. Diff cards show their data in full (`diffCardText`): kind lines, names,
versions, and values wrap with `wrapText` and the card expands so nothing gets
truncated with an ellipsis. If a value exceeds six lines, the card notes that
the full value is in the detail panel.

Several props tailor how cards look and behave:

- `compound` accepts `true` for module boundaries, or a list of entity kinds
  that can act as boundaries; a card contained by another card is placed in
  their nearest boundary.
- `kindLine` replaces a card's kind line (and a boundary's heading prefix) with
  renderer-supplied text—drawn in monospace when it is an identifier, preserving
  the tail of long identifiers, with an optional sans `note`.
- `describeStatus` expresses a row's change in domain terms using `StatusPart`s
  (glyph, word, and matching change color) for the status footer, while keeping
  the comparison's standard wording in its accessible name
  (`Modified, Replace`).
- `focus` brings selected rows forward (`ids`), recedes everything else, and
  announces its `label` in the caption.
- `detail(entity)` draws a short monospace identifier at the right edge of the
  kind line (such as a package version) that crossfades between revisions.
- `prose(entity)` marks human-language labels so they render in sans instead of
  monospace.
- `synthetic(id)` marks presentation-only summary cards and links for collapsed
  items, giving them `data-graph-synthetic` instead of a selection ID.

`GraphCanvas` fills the frame height with its caption pinned at the bottom. By
default, it scales the graph down (never above 1×) and centers it to fit both
dimensions. If that fit would shrink text below the 8 px opening floor
(`openingFloorPx`), it opens at the floor instead, anchored to the top row
(`contentStart`)—centered horizontally for top-to-bottom graphs or aligned to
the leftmost card for left-to-right graphs—and scrolls. When a focus request
arrives (`RendererProps.focusRequest`, from the host's `InitPayload.focus` or
its "changes only" filter), the canvas opens on that region (`focusArea`):
fitted at up to 1× and never below the floor unless the request specifies `fit`,
centered or anchored to its reading start when it overflows. In diff mode, if
the whole graph does not fit at the floor, the view opens on the changed region
at the floor so a content-sized frame still matches the content's height.

Hubs widen automatically to provide a separate port for each incoming
relationship (`fanInWidths`), and any links incident to a selected or hovered
card receive `data-incident` to display their halo. A held pane lays out only
its own revision (`GraphTransitionOptions.held`). Fit is always the minimum zoom
level: `useStageZoom` multiplies the fitted scale, Fit resets it, and scroll
positions keep their center point across zoom changes. The canvas finishes
layout before its first paint and holds the shell's `rendered` acknowledgement
via `usePaintGate` so the host never reveals an unlaid-out frame. If layout
takes a while, a delayed status message appears; when step order changes, the
previous layout stays on screen until the next one is ready. Framing is computed
across all layouts so the view never zooms while scrubbing.

In the DOM, cards carry `data-entity-id`, while links carry `data-entity-id`
(the relationship ID), `data-edge-key`, `data-from`, `data-to`, and `data-end`
(the arrow tip in SVG units). The scroll container carries
`data-projections-scroll="graph"` and `data-zoom`. Users zoom with the
host-drawn `graphCanvasControls` actions (`zoom-in`, `zoom-out`, `zoom-fit`) or
Ctrl/⌘-wheel and pinch inside the frame, and pan by scrolling. For a single DAG
extraction of `job`s, each complete shared-prerequisite stage routes through a
single join/split junction node in the ELK graph with a menu to inspect each
dependency. Up to `graphEntityLimit` (500) entities are rendered.

**Graph layout.** Calling
`layoutGraph(nodes, edges, {orientation, compound, junctions, hints})` runs
ELK's layered algorithm (top-to-bottom or left-to-right) to position cards,
turning containment-only modules—or the kinds specified by `compound` (see
`boundaryKinds`)—into compound boundaries (`moduleGroups`). Disconnected
subgraphs share layers, and cards within a layer align along the edge where
their incoming relationships arrive (top or left) so each layer forms a clean
baseline.

For flat graphs with relationships and 300 or fewer nodes, ELK first orders
cards to minimize crossings and then places them with one centered port per face
using the narrowest of the four Brandes–Köpf alignments rather than their
balanced average. That keeps linked cards directly in line whenever possible
(parents over children, chains in neat columns). The chosen alignment is
recorded on `GraphLayout.alignment` based on which edges came out straight. Each
step of a transition inherits the union's order and alignment
(`GraphLayoutOptions.alignment`) and shifts onto it as a unit so the graph never
swings sideways between steps. Graphs with boundaries, graphs with no
relationships, and graphs over 300 nodes use ELK's balanced placement in a
single pass.

Because browsers funnel every ELK call through one Worker, ELK runs are the main
layout cost: a standalone layout takes two runs, a transition step takes one,
and each layer-gap expansion adds one more. Hinted layouts preserve the hint's
layers and in-layer order using interactive layering from each card's hinted
corner (and since ELK ignores interactive layering inside compound graphs,
hinted compound layouts pin each card directly to its hinted layer and in-layer
slot instead). Layout is deterministic—identical graphs always produce the same
geometry regardless of input order (see also `compareIds`). Browsers execute ELK
in a Worker built from a `blob:` URL (allowed by the renderer policy's
`worker-src`), falling back to the main document if Workers are blocked; Node
runs it in-process.

Nodes can declare their own `width` and `height` (`LayoutNode`), defaulting to
`cardWidth` (200) and `cardHeight` (56 for a kind line and label, 36 for a file,
plus 18 units for the comparison status footer). Cards in a layer are spaced
`nodeSpacing` (24) apart, and cards of varying widths in a left-to-right layer
align on their entry edge. Cards in a layer also share a uniform depth
(`layerBands`): every card in a top-to-bottom layer matches the tallest card in
that layer (or the widest in left-to-right), giving the layer shared top and
bottom edges. Transitions take these band depths from the union layout (single
extractions use their own) so cards never resize while scrubbing; graphs with
boundaries keep their individual sizes.

Across layers, cards snap onto a shared column grid (`snapToGrid`) with column
lines spaced `nodeSpacing` beyond the standard card width starting from the root
padding, placing every card's leading edge on a grid line. Each layer preserves
ELK's ordering while assigning cards to the nearest free columns to their
Brandes–Köpf positions, keeping vertical chains aligned while allowing wide hubs
to span multiple columns. Junctions sit centered between the cards they join,
and transition steps shift by whole columns so cards stay locked to the union's
grid. Routes then navigate between the snapped cards using a direct S or a
corridor between columns, falling back to routing around cards when ELK's
original path no longer fits. Graphs with boundaries and left-to-right graphs
with mixed card heights keep ELK's placement directly.

**Dense text-driven card sizing.** Every card in a graph shares one width—just
enough for the longest card text in either revision (`graphCardsWidth`, computed
from each row's `graphCardWidth` across the kind line, its note, the right-side
detail, the label, and any comparison status footer), clamped to
`cardWidthRange` (112–216 units, plus room for an expander when present). Short
names produce compact cards while every layer stays aligned. `cardTextMetrics`
holds the insets, baselines, and character advances used to measure text
(monospace at 0.6 em and the sans average, rounded up at the theme's extra-small
size; `GraphCanvas` scales these by the theme size divided by 12 so VS Code's 11
px type yields slightly narrower cards). Text that still exceeds the maximum
width truncates with an ellipsis (`cutText`, or `kindText` to preserve the end
of a kind line), with the full string in the tooltip. Because width is fixed
across all progress values, cards never resize during playback. Single-revision
views have no change status, so they omit the footer and are 18 units shorter.

**Centered comparison footers.** In a comparison, the footer band centers its
status icon and wording together at every scale and opacity so text never
jitters during fades or zooms. If a status exceeds the band width, it truncates
with an ellipsis (trimming the last word first) and puts the full text in its
tooltip (`SvgChangeStatus` with `anchor: 'middle'` and `room`). Additional
footer lines center on the same axis: `SvgFooterRow` renders change details
(such as `Lifetime Scoped → Singleton` or gained/lost links) inside
`cardFooterRoom(width)` (card width minus horizontal text insets), wrapping onto
extra centered lines when needed so text never crowds the card edges while
keeping each row's vertical position stable. `EntityCard`'s HTML footer follows
the same centered layout and ellipsis truncation.

**Card change marks (`CardChangeMarks`).** `CardChangeMarks` draws the standard
visual treatment for a changed SVG card: a soft change-colored fill, a strong
border, and a ruled status band across the bottom with centered status text.
Custom SVG renderers—such as the dependency injection renderer—reuse it to match
graph cards directly, passing `fill: false` when child parts tint their own
slices. Cards that display internal changes (old/new values or changed fields)
and cards marked `pk-holds-changes` stay visually neutral—no fill, neutral
border and band, muted status—so change colors never nest. Boundaries containing
changed cards or links stay neutral in the same way
(`boundariesHoldingChanges`).

**Edge routing.** Across every graph view (graph, DAG, architecture,
infrastructure, dependencies) as well as dependency injection arrows and
database links, each relationship is **drafted as one clean S** (`sBend`): a
perpendicular stub leaves the source (at least `routeTail`, 8 units), a quarter
circle turns sideways, a straight run crosses the gap perpendicular to the
layers, a second quarter circle turns back, and a straight stub enters the
target perpendicular to its face, finishing with the arrowhead's lead-in
(`arrowHeadReach`). Straight segments are never diagonal, every join is
tangent-continuous, and routes have a single inflection without doubling back.
Every turn uses `routeRadius` (20), with one exception: when the lateral offset
is smaller than two radii, the straight run disappears and the two arcs meet
directly at less than 90° as a gentle wave rather than two tight hooks. (`sTurn`
computes this geometry without rendering it.)

A route prefers to turn in the gap immediately after its source (its band to the
next layer) so edges leaving the same card in the same direction share a single
trunk before fanning out straight to their targets. If that band is blocked, it
tries the full span or uses `gappedBend` in the widest gap between
rows—whichever clears every card by at least 8 units. Its horizontal run stays
centered in the band, shifted only for track separation and only as far as both
turns keep their full radius. Only when no single S can reach the target does a
route fall back to ELK's orthogonal path around cards, smoothing each jog with a
centered S (`smoothRoute`); ELK keeps jogs spaced a full turn plus the arrowhead
lead-in from each layer so those turns keep the full radius as well.

Outgoing edges from a card share a single centered port on the exit face—unless
the card has just one outgoing edge whose target port sits directly across on
the exit face (clear of the corners), in which case it leaves straight across.
Incoming edges distribute evenly across the entry face (two enter at the thirds)
in the order of their source positions, inset at least `portInset` (16) from the
corners so arrowheads stay well separated; a lone incoming edge enters at the
center (`spreadPorts`, also used by dependency injection arrows and database
rows at up to `portSpacing` (16) apart to fan links cleanly around a row's
anchor).

When multiple runs would overlap in the same gap, `routeTracks` assigns separate
tracks `trackSpacing` (10) apart (`RouteOptions.track`), one trunk per track,
ordered to minimize crossings (between two edges heading the same way, the one
leaving later turns first) and kept clear of around-card routes. The default
layer gap is `layerGap` (64.5: one tail, two full turns, and the lead-in). If
tracks need more room, layout re-runs with the gap expanded by the deficit—up to
three times, or once for compound graphs (`GraphLayout.layerGap`)—preserving
card order and alignment. Transitions reuse the union's gap across every step
(`GraphLayoutOptions.layerGap`) so cards never jump between steps.

Converging routes are prevented from crossing: one turns earlier or later in its
band, shifts to a later gap, or routes around via a card corridor or ELK's
course. Corridors are re-solved after sibling moves, crossing trunks swap runs,
and ports swap only as a last resort; routes leaving the same card never cross
either (`routesCross` and `routeCrossings` treat routes sharing a start or end
point as touching only there). A card with one incoming route that cannot arrive
straight takes it at the center. `GraphLayout.ports` stores each edge's ports
and, for a single S, its band and track (`RoutePorts`), while `tidyRoute` strips
floating-point slivers. Diff mode renders its union layout with the same routing
pipeline.

**Splines and transition morphing.** The spline utilities—`splinePath`,
`interpolateSpline`, `withSegments`, `followEndpoints`, `arrowEnding`,
`inwardNormal`, `sampleSpline`, `cubicPoint`, `lineSpline`, `joinSplines`,
`roundedSpline`, `inflections` (visible changes in turning direction), and
`largestTurn`—drive smooth per-frame edge routing. At every progress value, a
route that is a single S in both endpoints is recomputed live with `sBend`
between the moving cards, carrying its ports, band, and track along. Other
routes morph segment-by-segment by arc position while preserving tangent
continuity; if morphing would clip a card, wiggle, bend further than either
endpoint, or slant a straight run, the route crossfades out and in instead while
anchoring its tail stub and lead-in to its cards so their lengths never distort.
`drawnEdge` and `cardBox` expose the rendered edge and card geometry for a given
frame.

**Arrowheads.** Every kit renderer draws the same arrowhead via
`arrowHead(tip, direction)` and `arrowHeadStyle(color)`: an equilateral triangle
with gently rounded corners (`arrowHeadLength` 8.5 from tip to base,
`arrowHeadCornerRadius` 1.25, drawn as an inner outline with round joins so the
painted tip lands squarely on `tip`). The tip **touches** the outer edge of the
target card's painted border without overlapping it. Because kit cards stroke
their border centered on the box, the tip stops half a border width outside the
box (`cardBorderOutset`, passed to `arrowEnding(points, box, outset)`,
`drawnEdge(…, outset)`, and `boxEdge(…, outset)`, defaulting to the theme stroke
width). Thicker change borders are inset by the difference (`emphasisInset`) so
the border never expands into the arrowhead; `useBorderWidths(ref)` reads the
theme's `--stroke` and `--stroke-strong` widths. Renderers whose cards use an
outer ring pass that ring's width instead (for example, database tables pass the
strong ring width for changed tables in diff mode and zero for a removed table's
inset outline). In diff mode, an SVG item's strong change edge (`pk-diff-shape`)
is inset by `emphasisInset` the same way.

Each head points along the inward normal of the face it meets, and the shaft
stops at the center of the flat base after a collinear straight lead-in
(`arrowHeadLeadIn`); routes curve into that lead-in via `arrowEnding`, never
directly into the head. `GraphCanvas` layers shafts beneath cards and arrowheads
in their own top layer (`.graph-arrowheads` >
`.graph-link-head[data-edge-key]` > `.graph-arrowhead`, carrying
`data-direction` and `data-base`) so tightly packed cards never clip an
arrowhead. Change emphasis is applied directly to the shaft stroke and head
fill, never as a duplicate line.

**Card-to-card arrows (`boxEdge`).** For renderers that position cards
themselves, `boxEdge` and `edgeArrowHeadLength` produce card-to-card arrows that
stop at the arrowhead base after the same straight lead-in, with
`EdgeArrowMarker` drawing the matching SVG marker. Downward arrows follow the
same S-bend discipline as graph routes: a single S turning in the gap below the
source (sharing a trunk with sibling arrows), or an S into the nearest clear
corridor between cards, straight down, and an S above the target. The result's
`turns` (and `boxEdgeTurn`) report the turn positions so a renderer can assign
tracks with `routeTracks` and re-route with `tracks`, just as dependency
injection's `routeLinks` does.

ELK ([elkjs](https://github.com/kieler/elkjs), EPL-2.0) is roughly 1.6 MB of
JavaScript. Because each renderer bundle is a self-contained single document,
every bundle using `GraphCanvas` embeds a copy as a string executed in the
Worker, with its license and source recorded in the bundle's
`THIRD_PARTY_NOTICES.txt`.
