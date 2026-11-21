# The stage's utility area

Status: shipped in the CLI viewer and the Copilot canvas (the Inspector's viewer
page).

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
- It is solid, so content passing under it stays legible, and nothing in it
  carries an accent colour. The playback bar takes the toolbar's own surface and
  divider. A label chip, chosen from ten styles reviewed in place, is 28 px tall
  with 10 px of padding and takes the bar's own fill, edge, corners and text
  (`--ph-utility-*`), so the two read as one family: the revision's name in mono
  at regular weight in the bar's muted text colour, then its commit subject in
  the text face and the same colour (a subtler one fell below 4.5:1), with its
  age in the tooltip. Its text is centred by cap height
  (`text-box: trim-both cap alphabetic`).
- The toolbar keeps one row in every mode. The title bar keeps its own row above
  the toolbar in the CLI viewer and canvas, as decided in #25.

## How a renderer keeps clear of it

The host decides what it covers, never the content, so there is no feedback
loop: the stage measures what it overlays on each frame, in the frame's own
coordinates, and sends two optional layout theme tokens.

- `stage-cover`: the covered rectangles, `x y width height` in CSS px, comma
  separated, for example `8 6 180 18, 412 6 140 18`.
- `stage-inset-top`: the band they take at the top (the lowest rectangle's
  bottom plus its gap again), which hosts already send for pane chips.

How a renderer uses them depends on how it lays out:

- **Content that scrolls** (tables, documents, the kit's `ContentView` and
  `pk-stage`) pads its top by `stage-inset-top` and scrolls under the cover. It
  needs no change: this is the existing token.
- **A fitted canvas** (the graph canvas, the dependency injection renderer) can
  do better with `stage-cover`. The kit's `useCoveredPadding` fits the drawing
  as it would without the cover, and moves its top down only if the fitted,
  centred drawing would reach a covered rectangle. A flat graph centred well
  below the chips takes no extra room and doesn't move. A tall one opens below
  them. Either way it can be panned under the cover. A view that opens scrolled,
  at the text floor, opens with its first row below the covered band.
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

- **Legibility over content.** The chips and the bar are solid, with the divider
  at their edge.
- **Drags through the gaps.** Only the bar and chips take the pointer (a chip
  does so its tooltip can show its whole label and the revision's age); the area
  around them is the stage, so drags and clicks there reach the frame.
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
  `useCoveredPadding` and pads its top by `--pk-fit-top`.

## Open questions

- Whether the title could join the area (or the toolbar) too, leaving two bars.
  For now the title bar keeps its own row.
- Whether `stage-cover` belongs in the renderer environment rather than in theme
  tokens. A token needed no protocol change.
- Whether the VS Code tab, whose toolbar is VS Code's own, should adopt it.
- Whether the bar should carry the revisions' names beside the slider.
