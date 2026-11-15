# File packing

A repository as nested circles: every file a circle whose area is its size,
packed inside its folder's circle and colored by its language or file type.
Compared across a pull request, it answers "where in the tree did this change
land, and how much did it add, remove or grow?"

<!-- generated: facts -->

- Name: `file-packing`; also answers to `treemap`
- Draws: [`treemap/v0`](../../reference/schemas/treemap.md),
  [`graph/v0`](../../reference/schemas/graph.md)
- Comparison modes: Diff, Side by side, Animated, Swipe; a comparison opens in
  Diff
- Package: `@githubnext/projections-renderer-file-packing`

<!-- end generated: facts -->

## When to use it

Use it for a picture of a whole repository and where a change falls in it: a new
package, a folder deleted, generated files that ballooned, a language taking
over a directory. It draws the
[`repository-map`](../extractors/repository-map.md) extractor's file tree, and
any weighted hierarchy (`treemap/v0`, each leaf sized by `data.value`), with
every leaf in view at once.

It shows sizes and where things are, not what files contain or how they depend
on each other; for per-language totals use
[`code-statistics`](code-statistics.md), for connections [`graph`](graph.md).

The renderer also answers to `treemap`. The name doesn't change what it draws: a
file tree (entities with `data.path`) is colored by file type and offers the
exclusion and folder controls below, and any other hierarchy is colored by
entity kind and sized by weight.

Built-in extractors that draw with it by default:

<!-- generated: extractors -->

| Built-in extractor                                  | Its default `renderer` |
| --------------------------------------------------- | ---------------------- |
| [`repository-map`](../extractors/repository-map.md) | `file-packing`         |

<!-- end generated: extractors -->

## What it draws

- **Sizes**: a file's circle has an area proportional to its bytes
  (`data.size`), or its lines (`data.lines`) when **Size by** is Lines; a
  weighted hierarchy uses `data.value`. Folders are outlined circles around what
  they hold.
- **Colors**: programming and markup languages take their GitHub colors
  (TypeScript blue, Rust tan, Go cyan), muted so change rings always stand out;
  data, configuration, docs and assets take distinct colors from the theme's
  palette, and the rarest types share one gray. A language is the same color
  here as in `code-statistics`, and keeps its color from Before to After. The
  host draws the legend: the largest types, then "N other types".
- **Kinds and flags** (a weighted hierarchy): leaves are colored by entity kind.
  The definition's `presentation.kinds` can give a kind a meaning or hue
  (`"secret": {"color": "danger"}`, painted with theme tokens); other kinds take
  the free palette colors farthest from those in use, so no two look alike. A
  leaf's further attributes, `data.flags` (strings), are dots along its bottom
  in the colors of the kinds of those names (up to four drawn; its hover card
  and accessible name list them all), and the legend names them.
- **Labels**: files large enough show their name in the middle; folders show
  theirs along their top edge, abbreviated when long (hover for the whole path),
  and along their bottom edge when a crowded parent's name takes the top. Names
  are code, in the monospace font; a name that would overlap another is left
  out.
- **Layout**: the packing fills the frame, and the whole packing is always in
  view. Each circle settles on the same side of its folder whatever else
  changes, so the same revision always packs the same way and a resized file
  only nudges its neighbours.

Hovering or focusing a circle shows its path and size, and in a comparison how
its size changed (`+1.2 KB`). At most 6,000 circles are drawn; the smallest
beyond that are left out, with a notice.

## Options

The host draws these controls; set their starting values in the definition's
`presentation.rendererOptions`:

<!-- prettier-ignore -->
| Control | ID | Values | Default |
|---|---|---|---|
| Depth | `maxDepth` | `1` up to the tree's depth (at most `32`); deeper folders are drawn as one circle in their largest type's color | The tree's depth (everything) |
| Size by | `measure` | `bytes`, `lines` (offered when the extraction counts lines) | `bytes` |
| Hide dependencies and build output | `hideDependencies` | `true`, `false`: skip `node_modules`, `dist`, `build`, `target`, `.next` and similar folders | `false` |
| Hide lockfiles | `hideLockfiles` | `true`, `false`: skip `package-lock.json`, `Cargo.lock`, `go.sum` and others | `false` |
| One per top-level folder, named after it (`docs/`) | `show.<folder>` (`show.docs`, `show.github` for `.github`) | `true`, `false` | `true` |

The exclusion and folder controls are offered for a file tree, the folder
toggles when it has at least two top-level folders (up to 24 of them).
Everything is shown by default, so a comparison never hides a change unless you
ask it to:

```json
"presentation": {"rendererOptions": {"hideLockfiles": true, "hideDependencies": true}}
```

It has no zoom. It presents a comparison in every mode: Side by side, Animated,
Swipe and Diff. `presentation.mode` picks the one a comparison opens in.

## What a comparison shows

- **Side by side and Swipe**: each pane packs one revision; while the host
  highlights changes, each marks its side of them.
- **Animated**: every stage of the comparison is packed into the same area, and
  circles move only during their own step: a removed file fades out, then its
  neighbours close over its room; an added file's room opens, then it fades in
  where it belongs; a resized file grows or shrinks. Before and After are
  exactly the packing of that revision alone.
- **Diff**: one packing of both revisions at After's sizes. Unchanged files keep
  their After size, removed files stay where they were (faded, with a dashed
  outline) and added files appear where they are.

A changed circle gets a ring in its change's color (dashed when removed) and its
status as text, `+ Added`, `− Removed`, `~ Modified`, inside the circle when it
fits, else its glyph alone; the smallest circles state it in their accessible
name. Marks follow the host's highlighting.

The **summary bar** counts files and directories, with their changes
(`412 files +6 −2 ~31 · 58 directories +1`); every figure filters to its items.
It states no other facts.

Selecting a circle selects its file or folder in every pane and in the host's
table.

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

- Area is the only quantity it shows: a file's churn, age or owner isn't drawn
  unless your extractor makes it the size.
- A circle too small to label has no name on it; hover it, or find it in the
  host's table.
- At most 6,000 circles are drawn.
- `hideDependencies` and `hideLockfiles` match a fixed list of folder and file
  names; for anything else, use the folder toggles or the extractor's own
  `include` and `exclude` globs.

## Related

- [`repository-map`](../extractors/repository-map.md), the extractor it draws by
  default; its `lines` input makes **Size by** Lines available.
- [`code-statistics`](code-statistics.md), which shares its language colors.
- [`graph`](graph.md), which draws the same `graph/v0` extractions as cards and
  arrows.
- [The default comparator](../comparators/default.md), which can order the steps
  by size (`order.by: data.size`).

## How it works

The [package README](../../../packages/renderers/file-packing/README.md) covers
the packing, its colors and its credits.

## Build your own

File packing shows one thing well: how big each part of a tree is, and where it
sits. Write your own renderer when the tree should say something else:

- **Another visual language**: a rectangular treemap, a sunburst, an icicle
  chart, or the repository drawn as your architecture diagram's regions.
- **Grouping it doesn't do**: files grouped by owning team (`CODEOWNERS`), by
  package or by service, rather than by folder.
- **Emphasis from your data**: churn, test coverage, age or complexity as color
  or size, or hot spots called out.

Try the lighter options first. **Depth**, **Size by** and the exclusion and
folder controls (and their `presentation.rendererOptions`) change what's packed,
and `presentation.mode` the mode a comparison opens in. A `treemap/v0`
extraction sizes leaves by any `data.value` you compute, so a custom extractor
alone can pack lines changed, coverage gaps or anything else you can weigh. To
order the steps by size, set the default comparator's `order.by`.

**In VS Code**, choose **+ New Projection…** in the Projections view, then
**Write a custom extractor, renderer or comparator** › **Custom renderer**, and
pick the built-in extractor it draws. It writes the definition
(`.github/projections/<id>.json`) and a TypeScript, Vite and React renderer
package built on the renderer kit (`.github/projections/<id>/renderer`), and
opens the definition and the projection's tab. Or choose **Ask an agent to write
it** and describe what the projection should show.

**With the CLI**:

```sh
projections init <id> --extractor repository-map --renderer custom
```

Then, in the renderer package, run `npm install`, then `npm run dev` for a
development server with hot updates, `npm run workbench` to open its scenarios
in the fixtures workbench in a browser, and `npm test` to run the renderer
checks on every scenario. In VS Code an open projection tab uses your
uncommitted definition edits ("Your edits"), and saving the renderer's sources
rebuilds it (in a trusted workspace, while its tab is open, with its `watch` or
`build` script) and reloads the view; the Testing view runs each projection's
checks (`projections check -p <id>`, renderer checks included).
[Develop a renderer](../../guides/develop-a-renderer.md) walks through it; the
[renderer kit guide](../../guides/renderer-kit.md) and the
[renderer kit API](../../reference/renderer-kit.md) cover the pieces, such as
the language palette this renderer uses.
