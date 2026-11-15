---
description: "Built-in file-packing renderer: files as packed circles"
---

# File packing renderer

`@githubnext/projections-renderer-file-packing` draws a repository the way
GitHub Next's 2021
[Repo Visualization](https://githubnext.com/projects/repo-visualization/) did:
every file is a circle whose area is its size, packed inside its folder's
circle, and colored by its file type. It presents the `repository-map` extractor
(`graph/v0` directories and files joined by `contains`) and any weighted
hierarchy (`treemap/v0`, sized by `data.value`). The renderer name is
`file-packing`; it also handles `treemap`.

Inspired by
[Repo Visualization](https://githubnext.com/projects/repo-visualization/)
(GitHub Next, 2021), and a fresh implementation: no code is taken from
[githubocto/repo-visualizer](https://github.com/githubocto/repo-visualizer). It
uses [d3-hierarchy](https://github.com/d3/d3-hierarchy) (ISC, listed in the
bundle's `THIRD_PARTY_NOTICES.txt`) for enclosing circles and for very large
folders. The frame shows the credit in a small footer line; renderer frames
can't navigate, so the link to the post is in the line's tooltip and here.

## Picture

- **Sizes.** A file's circle has area proportional to its bytes (`data.size`,
  the revision's blob size), or its lines (`data.lines`, with `"lines": true` in
  the extractor's inputs) when **Size by** is Lines; a weighted hierarchy uses
  `data.value`. Folders are outlined containers sized by what they hold; a
  folder collapsed at the depth limit takes its own declared weight when it has
  one (a weighted hierarchy's explicit internal weight).
- **Colors.** Programming and markup languages take their GitHub Linguist hues,
  as on github.com (TypeScript blue, Rust tan, Go cyan), muted to sit on the
  theme's canvas as one family and kept well under the change colors, so a
  change ring always stands out from a file's type (see the SDK's
  [languages](../sdk/README.md#languages)); TSX counts as TypeScript. Data,
  configuration, docs and assets (JSON, YAML, TOML, Markdown, images, extensions
  Linguist doesn't know) take distinct colors from the theme's categorical
  palette, and only types past it share the neutral "other" gray. A generic
  weighted hierarchy is colored by entity kind: a kind the definition gives a
  color (`presentation.kinds.<kind>.color`, a meaning such as `danger` or a
  categorical hue, sent as `init.projection.kinds`) takes its theme token, and
  the others take the free palette slots farthest (in OKLab, in both themes)
  from every color in use, so no two kinds look alike. Colors come from the
  kit's `categoryPalette`, so a language is the same color here and in code
  statistics, and they are ranked over both revisions, so a type keeps its color
  from Before to After. The host draws the legend: the largest types, then "N
  other types".
- **Flags.** A weighted hierarchy's leaf may list further attributes in
  `data.flags` (strings; its own kind is left out). Each is a dot in a row along
  the bottom of its circle, inside the change ring, in the palette color of the
  kind of that name (or its own after the kinds), outlined in the canvas color;
  at most four are drawn, none on circles under 6 px, and the hover card and
  accessible name list them all (`flagged hidden and secret`). The legend names
  flags with the kinds and says so in its title.
- **Labels.** Files large enough show their name in the middle; folders show
  theirs along the top of their outline, abbreviated with an ellipsis when it
  doesn't fit (never under four characters; the hover card has the whole path).
  A folder whose top is taken, typically by its crowded parent's name, is named
  along the bottom of its outline instead, after every change status is placed.
  Names are identifiers, so they are drawn in the theme's monospace font.
- **Layout.** The packing fills the frame: the area is the stage's size (the
  kit's `useFrameFill`), the top level is spread to the stage's aspect like the
  original's horizontal reflow, and the scale is the largest that fits. A stage
  smaller than the smallest area packed (300 × 220) gets that area scaled down
  to fit, so the whole packing is always in view. Each folder's children are
  arranged by a deterministic relaxation (gravity towards the folder's centre,
  collisions pushing apart) in which every circle starts on its own bearing, a
  hash of its ID, so it settles on the same side of its folder whatever else
  changes; the folder is then the smallest circle around them (d3's
  `packEnclose`). The same revision always packs the same way, and a resized
  file only nudges its neighbours. Spacing is relative to the circles it
  separates, so one layout scales to any area; the smallest files keep a 1.25 px
  circle and a slot to match.

## Controls

The host draws them; a definition can preset them in
`presentation.rendererOptions`.

<!-- prettier-ignore -->
| ID | Control | Default |
|---|---|---|
| `maxDepth` | **Depth**: deeper folders are drawn as one circle in their heaviest type's color, like the original's `max_depth`; ranges up to the document's own depth | the document's depth (everything) |
| `measure` | **Size by** Bytes or Lines (only when the extraction counts lines) | `bytes` |
| `hideDependencies` | **Hide dependencies and build output**: `node_modules`, `dist`, `build`, `target`, `.next` and similar folders | off |
| `hideLockfiles` | **Hide lockfiles**: `package-lock.json`, `Cargo.lock`, `go.sum` and others | off |
| `show.<folder>` | One show/hide toggle per top-level folder (up to 24; `show.github` for `.github`), mirroring the original's `excluded_paths` | on |

Everything is shown by default, so a comparison never hides a change unless
someone asks it to; the original Repo Visualization excluded lockfiles and build
output by default, which a definition can reproduce with
`"rendererOptions": {"hideLockfiles": true, "hideDependencies": true}`. The
repository-map extractor's own `include` and `exclude` globs remove paths from
the extraction itself.

## Comparisons

Animated, side by side, swipe and diff. Every stage of a comparison (the state
after each step) is packed into the same area, and frames interpolate between
the stages of the step moving now (the kit's `createStagedTimeline` and its hold
policy): a removed file fades out, then its circle closes while its neighbours
take the room; an added file's room opens, then it fades in where it belongs; a
resized file grows or shrinks during its step. Rows absent from a stage collapse
in place, so nothing flies in from elsewhere. Two collision-free packings can
pass circles through each other halfway between them, so while circles move each
folder's children are pushed apart and kept inside their folder, carrying their
contents along (`settle`); a settled frame is untouched. Both endpoints are
exactly the packing of that revision alone, with no change decoration. Names and
status are drawn in one layer above every circle, so a child never covers its
folder's name, and a name that would overlap one already placed is left out.

The diff packs the union of both revisions at the after revision's scale, so
unchanged files keep their after size, removed files stay where they were
(faded, with a dashed outline) and added files appear where they are.

Change status never rests on color: a changed circle gets a change-colored ring
(dashed when removed) and its status as text, `+ Added`, `− Removed`,
`~ Modified`, in a band reserved inside the circle when it fits, otherwise its
glyph alone; the smallest circles state it in their accessible name. Where
status goes depends only on a circle's size, never its emphasis, so nothing
moves when status appears. Hovering or focusing a circle shows its path, size
and, in a comparison, how its size changed.

## Fixtures

`scenarios.json` drives the Storybook stories, the Inspector's fixtures mode and
the browser checks. `node scripts/fixtures.mjs sample` writes the small sample
app; `node scripts/fixtures.mjs settings` a synthetic settings map (kinds, flags
and definition colors); `node scripts/fixtures.mjs opensource <before> <after>`
writes this repository's own tree at two revisions, read from Git objects
exactly as `repository-map` would (with line counts). The recorded pair has a
few directories renamed.
