# File packing

This renderer turns a repository into nested circles: every file is a circle
whose area reflects its size, packed inside its parent folder and colored by
language or file type. Across a pull request, it shows where in the directory
tree a change landed and how much it added, removed, or grew.

<!-- generated: facts -->

- Name: `file-packing`; also answers to `treemap`
- Draws: [`treemap/v0`](../../reference/schemas/treemap.md),
  [`graph/v0`](../../reference/schemas/graph.md)
- Comparison modes: Diff, Side by side, Animated, Swipe; a comparison opens in
  Diff
- Package: `@githubnext/projections-renderer-file-packing`

<!-- end generated: facts -->

## When to use it

Use file packing when you want a bird's-eye view of an entire repository and
where a change lands—a new package, a deleted directory, generated files that
ballooned, or a language taking over a folder. It renders the
[`repository-map`](../extractors/repository-map.md) file tree as well as any
weighted hierarchy (`treemap/v0`, where each leaf is sized by `data.value`),
keeping every leaf in view at once.

It focuses on size and location rather than file contents or dependencies. For
per-language totals, use [`code-statistics`](code-statistics.md); for
connections between items, use [`graph`](graph.md).

The renderer also responds to `treemap`, which renders identically: file trees
(entities with `data.path`) are colored by file type and unlock the exclusion
and folder controls below, while other hierarchies are colored by entity kind
and sized by weight.

Built-in extractors that use it by default:

<!-- generated: extractors -->

| Built-in extractor                                  | Its default `renderer` |
| --------------------------------------------------- | ---------------------- |
| [`repository-map`](../extractors/repository-map.md) | `file-packing`         |

<!-- end generated: extractors -->

## What it draws

- **Sizes.** Each file's circle area is proportional to its byte size
  (`data.size`), or its line count (`data.lines`) when **Size by** is set to
  Lines; weighted hierarchies use `data.value`. Folders appear as outlined
  circles wrapping their contents.
- **Colors.** Programming and markup languages use muted GitHub language colors
  (TypeScript blue, Rust tan, Go cyan) so change rings always stand out. Data,
  config, docs, and asset files draw distinct colors from the theme palette, and
  the rarest types share a neutral gray. Language colors match `code-statistics`
  and stay consistent from Before to After. The host renders the legend with the
  largest types followed by "N other types".
- **Kinds and flags (weighted hierarchies).** Leaves are colored by entity kind.
  You can assign a semantic color in `presentation.kinds` (for example,
  `"secret": {"color": "danger"}`, mapped to theme tokens); remaining kinds pick
  the most distinct unused palette colors. Additional leaf attributes in
  `data.flags` (strings) appear as colored dots along the bottom of the circle
  (up to four drawn, with all of them listed in the hover card, accessible name,
  and legend).
- **Labels.** Files large enough to fit a label show their name in the center.
  Folders place their name along the top edge (abbreviated when long, with the
  full path on hover), or along the bottom edge if a crowded parent already
  claims the top. Names use a monospace font, and overlapping labels are
  omitted.
- **Layout.** The packing fills the viewport so everything stays visible at
  once. Each circle settles consistently in the same part of its folder, so a
  revision always packs identically and resizing one file only nudges its
  neighbors.

Hovering or focusing any circle shows its path and size—plus its size delta
(such as `+1.2 KB`) in a comparison. At most 6,000 circles are drawn; if more
exist, the smallest ones are omitted with a notice.

## Options

The host provides these controls; set their starting values in
`presentation.rendererOptions`:

<!-- prettier-ignore -->
| Control | ID | Values | Default |
|---|---|---|---|
| Depth | `maxDepth` | `1` up to the tree's depth (at most `32`); deeper folders are drawn as one circle in their largest type's color | The tree's depth (everything) |
| Size by | `measure` | `bytes`, `lines` (offered when the extraction counts lines) | `bytes` |
| Hide dependencies and build output | `hideDependencies` | `true`, `false`: skip `node_modules`, `dist`, `build`, `target`, `.next` and similar folders | `false` |
| Hide lockfiles | `hideLockfiles` | `true`, `false`: skip `package-lock.json`, `Cargo.lock`, `go.sum` and others | `false` |
| One per top-level folder, named after it (`docs/`) | `show.<folder>` (`show.docs`, `show.github` for `.github`) | `true`, `false` | `true` |

The exclusion controls appear for file trees, and top-level folder toggles
appear whenever the tree has at least two top-level folders (up to 24).
Everything is visible by default so a comparison never hides a change unless you
explicitly ask it to:

```json
"presentation": {"rendererOptions": {"hideLockfiles": true, "hideDependencies": true}}
```

There is no zoom. All four comparison modes are supported—Side by side,
Animated, Swipe, and Diff—and `presentation.mode` picks which one opens first.

## What a comparison shows

- **Side by side and Swipe** pack each revision in its own pane and mark its
  side's changes when the host's highlighting is on.
- **Animated** packs every stage of the comparison into the same area, moving
  circles only during their own step: removed files fade out before their
  neighbors close the gap, added files open space before fading in, and resized
  files grow or shrink in place. The Before and After endpoints match the exact
  packing of each revision on its own.
- **Diff** combines both revisions into one packing at After sizes. Unchanged
  files keep their After size, removed files stay in place faded with a dashed
  outline, and added files appear in their new spots.

Changed circles get a colored ring (dashed for removals) and a status label
(`+ Added`, `− Removed`, `~ Modified`) inside the circle when space permits,
falling back to the glyph alone or to the accessible name on the smallest
circles. All marks follow the host's highlighting toggle.

The **summary bar** counts files and directories along with their deltas
(`412 files +6 −2 ~31 · 58 directories +1`), with each figure acting as a
filter.

Selecting any circle highlights that file or folder across every pane and in the
host's table.

## Start from this definition

<!-- generated: definition -->

```json
{
  "extractor": "repository-map",
  "id": "repository-map",
  "renderer": "file-packing",
  "title": "Repository map"
}
```

<!-- end generated: definition -->

## Limitations

- Area is the only numeric dimension shown; metrics like churn, age, or
  ownership aren't displayed unless your extractor maps them to size.
- Circles too small for a label don't show their name on the canvas; hover them
  or look them up in the host's table.
- At most 6,000 circles are drawn.
- `hideDependencies` and `hideLockfiles` match a fixed list of folder and file
  names. To filter anything else, use the folder toggles or configure `include`
  and `exclude` globs on the extractor.

## Related

- [`repository-map`](../extractors/repository-map.md) — the default extractor;
  enabling its `lines` input unlocks **Size by** Lines.
- [`code-statistics`](code-statistics.md) — shares the same language colors.
- [`graph`](graph.md) — draws the same `graph/v0` extractions as cards and
  arrows.
- [The default comparator](../comparators/default.md) — can order animation
  steps by size with `order.by: data.size`.

## How it works

See the [package README](../../../packages/renderers/file-packing/README.md) for
details on the circle-packing algorithm, colors, and credits.

## Build your own

File packing excels at showing how big each part of a tree is and where it sits.
Build a custom renderer when you want the tree to communicate something else:

- **Another visual layout** — a rectangular treemap, sunburst, icicle chart, or
  custom regions matching your architecture diagram.
- **Non-folder grouping** — files grouped by owning team (`CODEOWNERS`),
  package, or service instead of directory path.
- **Data-driven emphasis** — churn, test coverage, age, or complexity encoded as
  color or size, with hotspots called out directly.

Check the lighter options first. **Depth**, **Size by**, and the exclusion and
folder controls (via `presentation.rendererOptions`) let you tailor what gets
packed, and `presentation.mode` controls the opening comparison mode. Because
`treemap/v0` sizes leaves by whatever `data.value` you emit, a custom extractor
alone can pack changed lines, coverage gaps, or any other weight. You can also
set `order.by` on the default comparator to order steps by size.

**In VS Code**, select **+ New Projection…** in the Projections view, choose
**Write a custom extractor, renderer or comparator** › **Custom renderer**, and
pick the built-in extractor it draws. VS Code scaffolds the definition
(`.github/projections/<id>.json`) and a TypeScript, Vite, and React renderer
package built on the renderer kit (`.github/projections/<id>/renderer`), then
opens both the definition and the projection tab. You can also choose **Ask an
agent to write it** and describe what you want shown.

**With the CLI**:

```sh
projections init <id> --extractor repository-map --renderer custom
```

Inside the generated renderer package, run `npm install`, then use `npm run dev`
for a hot-reloading dev server, `npm run workbench` to preview your scenarios in
the browser, and `npm test` to run renderer checks across every scenario.

In VS Code, an open projection tab picks up your uncommitted definition edits
("Your edits"), and saving renderer source files automatically rebuilds and
reloads the view in a trusted workspace (using its `watch` or `build` script).
Run projection and renderer checks from the Testing view or via
`projections check -p <id>`. For a full walkthrough, see
[Develop a renderer](../../guides/develop-a-renderer.md), the
[renderer kit guide](../../guides/renderer-kit.md), and the
[renderer kit API](../../reference/renderer-kit.md)—including the language
palette this renderer uses.
