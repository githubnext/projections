# The stage's utility area

Status: shipped in the default UI: the CLI viewer and the Copilot canvas (the
Inspector's viewer page), and the hosts built on it.

## The problem

A comparison can stack three full-width bars above the stage: the title bar (the
mark and the projection's title), the toolbar (the mode and scope switches and
the zoom and view tools), and a third bar that changes with the mode: each
pane's label band in side by side and swipe, or the playback row in animated.
Each bar takes height from the stage, and three of them read heavy, especially
in the Copilot canvas, which is often 600–760 px wide.

## The idea

The third bar becomes a **utility area**: room on top of the stage, used only
when it's needed, for labels and controls.

- It floats over the stage's top edge, 12 px below it and 12 px from its sides:
  the renderers' own content inset (the kit's stage padding), so its edges line
  up with the tables and cards under it, with the stage visible around it. It is
  as wide as its content needs: two label chips in side by side (one at each
  pane's top start), one chip at each side's outer corner in swipe, and the
  playback slider, at most 560 px wide and centred, in animated and beside the
  table and text views.
- The stage keeps its full height and runs under it. Content panned or scrolled
  up shows in the gaps around the area and behind it.
- It is glass: the toolbar's surface at 70%, blurring what passes under it
  (`backdrop-filter: blur(8px) saturate(1.2)`), so the stage shows through while
  its text stays legible (muted text keeps 4.7:1 over a dense graph, in both
  themes). Where the browser can't blur a renderer's frame behind it (WebKit:
  Safari and every iOS browser, where the frame's text showed through sharp) or
  has no `backdrop-filter`, the fill is solid. Nothing in it carries an accent
  colour. The playback bar takes the toolbar's own divider. A label chip, chosen
  from ten styles reviewed in place, is 28 px tall with 10 px of padding and
  takes the bar's own fill, edge, corners and text (`--ph-utility-*`), so the
  two read as one family: the revision's name in mono at regular weight in the
  bar's muted text colour, then its commit subject in the text face and the same
  colour (a subtler one fell below 4.5:1), with its age in the tooltip. Its text
  is centred by cap height (`text-box: trim-both cap alphabetic`).
- The toolbar keeps one row in every mode. The title bar keeps its own row above
  the toolbar in the CLI viewer and canvas, as decided in #25.

## The stage's foot: the legend and summary

The same idea at the bottom: the renderer's legend and the summary bar float
over the stage's foot as **one** overlay, instead of two full-width bands under
it. It is centred, 12 px from the stage's bottom and sides, in the same glass:
the legend's row over the summary's, one 1px rule between them, one edge and
radius around both. It is as wide as its longer row, the shorter centred in it,
and on whole pixels. Either row alone is the whole foot; over the table and text
views only the summary shows, and they pad their end clear of it.

The summary fits its figures to the room the foot may grow to (the stage less
its insets), not to its own width, which would shrink it a figure at a time to a
lone "…". What doesn't fit moves into the "…" at the row's end; its popover
opens above the whole foot, never over the legend, its figures full-width rows
whose highlight takes a figure's counts too, the counts of each kind of change
in one column.

The foot covers the frames as the utility area does (`data-stage-cover`): the
stage sends the band it takes at the frame's foot as `stage-inset-bottom`.

## The toolbar around it: the sides layout

With playback on the stage, the toolbar keeps one row in a fixed order: at its
start the picker a host puts there (the projection switcher on a pull request),
then the mode switch (Diff, Side by side, Animated, Swipe) and Changes / All; at
its end zoom, Find, Settings, About and full screen. Short of room it collapses
within that row (the modes to a menu, the tools into More), never adding a line.

A centred projection name, with its own line where the row was short, was tried
and dropped: it read as a heading floating between controls, and moved when the
row narrowed. The title stays where it was: in the CLI viewer and canvas the
header row above the toolbar, and on a pull request the switcher at the
toolbar's start.

A surface that already says exactly what is compared doesn't say it again. A
pull request page names its base and head, so a host showing a projection there
declares it (`InspectorHost.revisionsNamed`, or the host's own toolbar leaves
the pair out), and no revision pair is drawn beside the title. The CLI viewer
and the canvas say nothing of the sort, so their header keeps the pair. The
stage's chips still label side by side's and swipe's panes on every surface:
they say which pane is which, not what is compared.

## How a renderer keeps clear of it

The host decides what it covers, never the content, so there is no feedback
loop: the stage measures what it overlays on each frame, in the frame's own
coordinates, and sends optional layout theme tokens.

- `stage-cover`: the covered rectangles, `x y width height` in CSS px, comma
  separated, for example `8 6 180 18, 412 6 140 18`.
- `stage-inset-top`: the band the rectangles in the frame's top half take at its
  top (the lowest one's bottom plus its gap again), which hosts already send for
  pane chips.
- `stage-inset-bottom`: the same for the rectangles in its bottom half (the
  foot), up from the frame's bottom edge.

How a renderer uses them depends on how it lays out:

- **Content that scrolls** (tables, documents, the kit's `ContentView` and
  `pk-stage`) pads its top by `stage-inset-top` and its bottom by
  `stage-inset-bottom`, and scrolls under the cover.
- **A fitted canvas** (the graph canvas, the dependency injection renderer) can
  do better with `stage-cover`. The kit's `useCoveredPadding` fits the drawing
  as it would without the cover, and moves its top down (and its bottom up) only
  if the fitted, centred drawing would reach a covered rectangle above (or
  below) the stage's middle. A flat graph centred well between the chips and the
  foot takes no extra room and doesn't move. A tall one opens between them.
  Either way it can be panned under the cover. A view that opens scrolled, at
  the text floor, opens with its first row below the covered band.
- A renderer that reads neither token draws under the cover, as it already does
  under pane chips.

The decision is made from the fit without the cover, so it can't oscillate.
Renderers that only know `stage-inset-top` keep working: a host that sends
`stage-cover` sends both.

## Motion

When the cover changes (switching mode, or the area's height changing), the
content is fitted to the new cover at once: it never zooms, scales or slides to
it. An early version eased the fitted drawing's size, and on a mode switch that
read as a dramatic camera zoom. Only a new chip or bar fades in, over 120 ms,
and not at all under reduced motion.

## Risks, and what it does about them

- **Legibility over content.** The chips, the bar and the foot are glass over a
  70% fill, or solid where the frame can't be blurred, with the divider at their
  edge.
- **Drags through the gaps.** Only the bar, the chips and the foot take the
  pointer (a chip does so its tooltip can show its whole label and the
  revision's age); the area around them is the stage, so drags and clicks there
  reach the frame.
- **Narrow canvases.** The bar is at most the stage less its insets. Below 440
  px it moves the step buttons and percent into its own overflow, as the
  toolbar's compact playback does. Swipe's chips keep to their half of the
  stage, so they never meet at the divider.
- **Keyboard order.** The area comes before the frames in the document, so Tab
  reaches the playback controls before the content they float over.
- **Screenshots.** `projections view screenshot --page` captures the page with
  the area. A renderer-only image (no page) has no cover and is unchanged.
- **Custom renderers.** The kit does the work: `ContentView`, `pk-stage` and the
  graph canvas need nothing. A renderer with its own fitted drawing calls
  `useCoveredPadding` and pads its top by `--pk-fit-top` and its bottom by
  `--pk-fit-bottom`.

## Open questions

- Whether the title could join the area (or the toolbar) too, leaving two bars.
  For now the title bar keeps its own row.
- Whether `stage-cover` belongs in the renderer environment rather than in theme
  tokens. A token needed no protocol change.
- Whether the VS Code tab, whose toolbar is VS Code's own, should adopt it.
- Whether the bar should carry the revisions' names beside the slider.
