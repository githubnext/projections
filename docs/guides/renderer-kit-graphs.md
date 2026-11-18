# Renderer kit: graph canvas and geometry

- `GraphCanvas` (props: `RendererProps` plus `orientation`, `compound`,
  `visibleIds`, `kindLine`, `describeStatus`, `focus`, `detail`, `prose`,
  `synthetic` and `changedFields`): the staged graph shared by the graph, DAG,
  architecture, infrastructure and dependency graph renderers. In diff mode it
  draws one static union of both revisions (see
  [Diff mode](renderer-kit.md#diff-mode)): every card and relationship where the
  union layout put it, marked with its change (the host's summary bar counts the
  changes; see
  [Presentation helpers and components](renderer-kit-components.md#presentation-helpers-and-components)),
  and `changedFields(row)` lists a modified card's field changes, drawn inline
  on the card. Diff cards show their data whole (`diffCardText`): kind lines,
  names, versions and values wrap (`wrapText`) and the card grows, so nothing is
  cut off with an ellipsis; a value longer than six lines is left to the detail
  panel and the card says so. The view opens fitted, with every card in view,
  unless that draws text below the 8 px opening floor (see `useStageZoom`).
  `compound` is `true` for module boundaries or the entity kinds that may become
  boundaries; a card contained by a card sits in their nearest boundary.
  `kindLine` replaces a card's kind line (and a boundary's heading prefix) with
  the renderer's text, in the monospace font when it is an identifier, keeping
  the end of a long one, with an optional sans `note`. `describeStatus` words a
  row's change in the domain's own terms (`StatusPart`s: glyph, word and the
  change color they match) for its status footer; its accessible name keeps the
  comparison's word too (`Modified, Replace`). `focus` brings rows forward
  (`ids`) and recedes the rest, and the caption announces its `label`.
  `detail(entity)` is a short identifier drawn in monospace at the right of a
  card's kind line (a package version), crossfading between revisions;
  `prose(entity)` marks labels that are human language, drawn in sans; and
  `synthetic(id)` marks presentation-only cards and links (summaries of
  collapsed items) that carry `data-graph-synthetic` instead of a selection ID.
  It fills the frame's height, with its caption at the bottom, and fits the
  graph: centred, scaled down to fit both dimensions, never above 1×, and opens
  at that fit unless it draws text below the 8 px opening floor
  (`openingFloorPx`): then it opens at the floor on the top row
  (`contentStart`), centred across a top-to-bottom graph and from the leftmost
  card of a left-to-right one, and scrolls. A focus
  (`RendererProps.focusRequest`, from the host's `InitPayload.focus` or its
  "changes only" filter) opens on its area instead (`focusArea`): fitted, at
  most at 1× and not below the floor unless the request says `fit`, centred, or
  from its reading start when it doesn't fit; diff mode opens on its changes
  when everything doesn't fit at the floor, at the floor, so a content-sized
  frame still takes the content's height. Hubs grow wider for a port per
  relationship into them (`fanInWidths`), and a selected or hovered card's links
  carry `data-incident`, which shows their halo. A held pane lays out only its
  own revision (`GraphTransitionOptions.held`). Fit is the least zoom; zoom
  (`useStageZoom`) multiplies the fitted scale, and Fit restores it; the scroll
  position keeps its centre across scale changes. It lays out before its first
  paint and holds the shell's `rendered` acknowledgement until then
  (`usePaintGate`), so the host reveals the frame with the finished graph; a
  slow layout shows a delayed status message, and a new step order keeps the
  current layout until the next one is ready. Framing is computed from every
  layout, so it never zooms while scrubbing. Cards carry `data-entity-id`; links
  carry `data-entity-id` (the relationship ID), `data-edge-key`, `data-from`,
  `data-to` and `data-end` (the arrow tip, in SVG units). The scroll container
  is `data-projections-scroll="graph"` and carries `data-zoom`. Zoom is the
  host-drawn `graphCanvasControls` actions (`zoom-in`, `zoom-out`, `zoom-fit`)
  plus Ctrl/⌘-wheel and pinch in the frame; the canvas scrolls to pan. A single
  DAG extraction of `job`s routes each complete shared-prerequisite stage
  through one join/split point (a junction node in the ELK graph), with a menu
  to inspect each dependency. Shows up to `graphEntityLimit` (500) entities.
- `layoutGraph(nodes, edges, {orientation, compound, junctions, hints})`: ELK's
  layered algorithm (top to bottom or left to right) places the cards, with
  containment-only modules (or the `compound` kinds, see `boundaryKinds`) as
  compound boundaries (`moduleGroups`). Unconnected parts of a graph share its
  layers, and the cards of a layer line up on the side their relationships enter
  (its top, or its left), so every layer has one baseline. Without boundaries,
  ELK first orders the cards to cross least, then places them with one port in
  the middle of each face in one of the four Brandes–Köpf alignments rather than
  their balanced average, so a card sits over the card it links to wherever it
  can and that relationship runs straight (a parent over one of its children,
  chains of cards in columns): ELK's narrowest of the four, which the layout
  records (`GraphLayout.alignment`, told from which relationships came out
  straight). A transition's steps take their union's order and alignment
  (`GraphLayoutOptions.alignment`) and move onto it as a whole, so no step
  swings the graph sideways. Graphs with boundaries, graphs with no
  relationships and graphs with more than 300 keep ELK's balanced placement in
  one run. ELK runs are the layout's cost (a browser sends every run through one
  worker): a layout takes two, a step of a transition one, and each growth of
  its gap one more. Hinted layouts keep the hint's layers and in-layer order
  (interactive layering, from each card's hinted corner). ELK ignores
  interactive layering inside compound graphs, so hinted compound layouts pin
  each card to its hinted layer and in-layer position instead. The same graph
  always produces the same geometry, whatever the input order. Browsers run ELK
  in a Worker made from a `blob:` URL (the renderer policy's `worker-src`),
  falling back to the document if the browser refuses it; Node runs it
  in-process. A node may give its own `width` and `height` (`LayoutNode`);
  `cardWidth` (200) and `cardHeight` (56 for a kind line and label, 36 for a
  file, plus the 18-unit status footer in a comparison) are the defaults. Cards
  in a layer are `nodeSpacing` (24) apart, and cards of different widths in a
  left-to-right layer line up on the side their relationships enter. Cards in a
  layer also share its depth (`layerBands`): each is as tall as the tallest card
  of its layer top to bottom (as wide, left to right), so a layer reads as one
  band with common top and bottom edges. A transition takes the depths from its
  union (an extraction from its own layout) and lays out every step with them,
  so no card resizes while scrubbing; graphs with boundaries keep their own
  sizes. Across the layers the cards stand on one grid of columns
  (`snapToGrid`): column lines `nodeSpacing` apart beyond the cards' usual
  width, from the root's padding, and every card's leading edge on one, in every
  layer. Each layer keeps the order ELK gave it, and its cards take the nearest
  free columns to where Brandes–Köpf placed them, so a card ELK lined up over
  the card it links to stays over it; a hub wider than a column spans more.
  Junctions sit in the middle of the cards they join, and a step of a transition
  moves across by whole columns, so its cards stay on the union's lines. Routes
  find their way between the snapped cards (a direct S, or a corridor between
  columns); a route no S or corridor takes goes around every card, as ELK's own
  course no longer fits. Graphs with boundaries, and left-to-right graphs whose
  cards differ in height, keep ELK's placement. Also `compareIds`.
- Cards are sized to their text, densely: a graph's cards share one width, what
  its longest card text needs (`graphCardsWidth`, from each row's
  `graphCardWidth`: the kind line with its note and the detail at its right, the
  label, and in a comparison the status footer, in either revision), between
  `cardWidthRange` 112 and 216 units (and room for a card's expander past that),
  so short names make narrow cards and every layer stays aligned.
  `cardTextMetrics` holds the insets, baselines and character advances it
  measures with (monospace 0.6 em and the sans average, rounded up, at the
  theme's extra-small size: `GraphCanvas` scales them by the theme's size over
  12, so VS Code's 11 px makes cards a little narrower). Text longer than the
  widest card ends in an ellipsis (`cutText`; a kind line keeps its end,
  `kindText`), and the card's tooltip holds it whole. The width is the same at
  every progress, so no card resizes while scrubbing. One revision has no change
  status, so its cards have no footer and are 18 units shorter.
- A comparison's footer band centres its status, icons and words together, at
  every size and opacity the card is drawn, so it never shifts while a card
  fades or scales; a status wider than the band ends in an ellipsis (the last
  word first) and its tooltip has it whole (`SvgChangeStatus` with
  `anchor: 'middle'` and `room`). Every other row of the band is centred on the
  same axis by default: `SvgFooterRow` draws a change line
  (`Lifetime Scoped → Singleton`, links gained and lost) centred on the card,
  laid out within `cardFooterRoom(width)` (the card less its text inset each
  side) and wrapped onto more centred rows when longer, so it never reaches the
  card's sides; a row's vertical place is unchanged. `EntityCard`'s HTML footer
  centres its status too, and its words end in an ellipsis when the card is too
  narrow.
- `CardChangeMarks` is a changed card's marks as a graph card draws them: the
  card filled with its change's soft hue under a strong edge of it, and the
  status band across its bottom, ruled off, with the status centred. A renderer
  that draws its own SVG cards takes the same look from it (the dependency
  injection renderer does); `fill: false` leaves the fill to a card whose parts
  tint their own slices of it. A card that shows changes inside it (old and new
  values, changed fields) draws them neutral, as does a card marked
  `pk-holds-changes`: no fill, a neutral edge and band, muted status, so change
  colors never nest. A boundary with changed cards or links inside it is drawn
  neutral the same way (`boundariesHoldingChanges`).
- Routes, in every graph presentation (graph, DAG, architecture, infrastructure,
  dependencies), DI's arrows and database links: each relationship is **drafted
  as one clean S** (`sBend`): a straight stub leaves its source perpendicular to
  the face (at least `routeTail`, 8), a quarter circle turns across, a straight
  run crosses the gap square to the layers, a second quarter circle turns back,
  and a straight stub enters the target perpendicular to its face, ending with
  the arrowhead's lead-in (`arrowHeadReach`). No straight stretch is diagonal,
  every join is tangent-continuous, and a route has one inflection and never
  doubles back. Every turn has one radius, `routeRadius` (20): a sideways offset
  under two radii has no run, its two arcs meeting directly at less than 90° (a
  gentle wave, never two tight hooks), and that is the only exception to quarter
  circles. `sTurn` gives the geometry without drawing it. A route turns in the
  gap right after its source (its band: the gap to the next layer of cards), so
  every route leaving one card the same way turns together, as one trunk, then
  runs straight on to its target; failing that, across the whole span, or with
  `gappedBend` in the widest gap between rows of cards, whichever passes no card
  within 8 units. Its run sits in the middle of its band, moved off it only by a
  track, and only as far as both turns keep the full radius. Only where no
  single S can reach the target does a route follow ELK's orthogonal course
  around the cards, with one S per jog centred on it (`smoothRoute`); ELK keeps
  those jogs a full turn plus the arrowhead's lead-in from each layer, so they
  turn at the full radius too. A card's outgoing relationships share one port,
  the middle of its out face; a card's only outgoing relationship leaves it
  across from the port it enters when that lies on its out face (clear of the
  corners), so it runs straight. Its incoming relationships divide its in face
  evenly (two enter at its thirds), in the order they come from (where they
  leave their sources), at least `portInset` (16) from its corners, so their
  arrowheads stand well apart; a lone one meets the middle (`spreadPorts`, which
  dependency injection's arrows and the database's rows use too, at most
  `portSpacing` (16) apart: links meeting one row on one side spread over a band
  centred on its anchor). Runs that would lie on one another in a shared gap
  take separate tracks `trackSpacing` (10) apart (`RouteOptions.track`,
  `routeTracks`), a trunk per track, ordered so they cross least (of two heading
  the same way, the one leaving later turns first), and never beside a run of a
  route around cards. The space between layers is `layerGap` (64.5: a tail, two
  full turns and the lead-in); a layout whose tracks need more room is laid out
  again with a wider gap, by what it lacked, until they fit (at most three
  times, once for a graph with boundaries; `GraphLayout.layerGap`), keeping its
  order and alignment, and a transition lays every step out with its union's gap
  (`GraphLayoutOptions.layerGap`), so cards never jump between steps. Converging
  routes never cross: one turns early or late in its band, turns in a later gap,
  or goes around (a corridor between cards, then ELK's course); a route through
  a corridor finds its corridor again after the other moves, and two crossing
  trunks exchange runs; only as a last resort do ports change places; routes
  leaving one card never cross either (`routesCross`, `routeCrossings`: routes
  running together from or into one point only touch there). A card with one
  incoming route that can't arrive in line takes it in the middle.
  `GraphLayout.ports` records each route's ports and, for a single S, its band
  and track (`RoutePorts`). `tidyRoute` drops floating-point slivers. Diff mode
  draws its union layout with the same routes.
- Splines: `splinePath`, `interpolateSpline`, `withSegments`, `followEndpoints`,
  `arrowEnding`, `inwardNormal`, `sampleSpline`, `cubicPoint`, `lineSpline`,
  `joinSplines`, `roundedSpline`, `inflections` (visible changes of turning
  direction), `largestTurn`. Every frame of a transition is routed from the
  cards where they are at that progress: a route that is one S in the layouts it
  moves between is drawn by the same `sBend` between its moving cards, with its
  ports, band and track carried along; other routes morph stretch to stretch by
  position along them, with every join kept tangent-continuous, and a morph that
  would cross a card, wiggle, turn further than either end does or slant a
  straight run is faded out and in instead, held as its own course near its own
  cards (its tail stub and lead-in move wholly with their cards, so they keep
  their length). `drawnEdge` and `cardBox` give an edge and a card as drawn at a
  frame.
- Arrowheads: `arrowHead(tip, direction)` and `arrowHeadStyle(color)` are the
  one arrowhead every kit renderer draws: an equilateral triangle with slightly
  rounded corners (`arrowHeadLength` 8.5 from tip to base,
  `arrowHeadCornerRadius` 1.25, drawn as an inner outline stroked with round
  joins, so the painted tip is `tip`). It **touches** its target: the painted
  tip ends exactly on the outer edge of the target card's painted border,
  covering none of it. Kit cards stroke their outline centred on their box, so
  the tip stops half a border width outside it (`cardBorderOutset`;
  `arrowEnding(points, box, outset)`, `drawnEdge(…, outset)` and
  `boxEdge(…, outset)` take it, defaulting to the theme's default width), and a
  card's thicker change border is inset by the difference (`emphasisInset`), so
  the outline never grows toward a head. `useBorderWidths(ref)` reads the
  theme's widths (`--stroke`, `--stroke-strong`). A renderer whose cards have an
  outer ring passes its width instead (the database's tables; in diff mode a
  changed table's strong ring, and none for a removed table's inset outline).
  Diff mode's union layouts draw the same routes and heads: an SVG item's strong
  change edge (`pk-diff-shape`) is inset by `emphasisInset` like any change
  border. The head points along the inward normal of the face it reaches; the
  shaft ends at the middle of its flat base after a straight lead-in collinear
  with it (`arrowHeadLeadIn`), and routes curve into that run (`arrowEnding`),
  never into the head. The graph canvas draws shafts under the cards and heads
  in their own layer over them (`.graph-arrowheads` >
  `.graph-link-head[data-edge-key]` > `.graph-arrowhead`, with `data-direction`
  and `data-base`), so heads stay whole where cards are close; change emphasis
  is the shaft's own stroke and the head's fill, never a separate line.
- `boxEdge`, `edgeArrowHeadLength`: card-to-card arrows for renderers that place
  cards themselves, ending at the arrowhead's base after the same straight
  lead-in; `EdgeArrowMarker` draws the same head as an SVG marker on them. A
  downward arrow is drafted like a graph route: one S turning in the gap below
  its source (a trunk with its card's other arrows), or, past a card in its way,
  an S into the nearest clear corridor between cards, straight down it and an S
  above its target. Its result's `turns` (and `boxEdgeTurn`) give the S's it
  turns on, so a renderer can spread arrows that share a gap onto tracks with
  `routeTracks` and route them again (`tracks`), as dependency injection's
  `routeLinks` does.

ELK ([elkjs](https://github.com/kieler/elkjs), EPL-2.0) is about 1.6 MB of
script. A renderer bundle is one self-contained document, so every bundle that
uses `GraphCanvas` includes one copy, as a string run in the Worker; its license
and source are listed in the bundle's `THIRD_PARTY_NOTICES.txt`.
