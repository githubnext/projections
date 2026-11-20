# API

This renderer lists a library's exported declarations one per row, with each
name beside its signature. Across a pull request, it shows which declarations
were added, removed, or altered and exactly how each signature changed. Pair it
with the `api-compatibility` comparator file and it also tells you which of
those changes break consumers.

<!-- generated: facts -->

- Name: `api`
- Draws: [`api/v0`](../../reference/schemas/api.md)
- Comparison modes: Diff, Side by side; a comparison opens in Diff
- Package: `@githubnext/projections-renderer-api`

<!-- end generated: facts -->

## When to use it

Use the API renderer to review changes to a public surface—a removed export, a
new parameter, or a widened return type. Because it uses a compact list rather
than a diagram, it stays readable even across hundreds of changes. It works the
same way for TypeScript, Rust, Go, Swift, and .NET public APIs, as well as Rails
routes ([`rails-routes`](../extractors/rails-routes.md)). Pair it with the
[`api-compatibility`](../../../packages/comparators/api-compatibility/README.md)
comparator file to classify each change using that ecosystem's compatibility
rules.

It doesn't show relationships between declarations such as inheritance or module
imports; use [`graph`](graph.md) when you need that view.

Built-in extractors that use it by default:

<!-- generated: extractors -->

| Built-in extractor                                                | Its default `renderer` |
| ----------------------------------------------------------------- | ---------------------- |
| [`typescript-public-api`](../extractors/typescript-public-api.md) | `api`                  |
| [`rust-public-api`](../extractors/rust-public-api.md)             | `api`                  |
| [`go-public-api`](../extractors/go-public-api.md)                 | `api`                  |
| [`swift-public-api`](../extractors/swift-public-api.md)           | `api`                  |
| [`dotnet-public-api`](../extractors/dotnet-public-api.md)         | `api`                  |
| [`rails-routes`](../extractors/rails-routes.md)                   | `api`                  |

<!-- end generated: extractors -->

## What it draws

Each declaration gets one row, sorted by ID. The left side shows the
declaration's label in bold, with its qualified name underneath when it's nested
(for example `Response.headers`, built from its enclosing declarations—or its
readable ID if two declarations would otherwise share a name). Its signature
(`data.signature`) sits to the right, or stacks underneath in narrow frames;
entities without a signature show their kind instead.

Labels, names, and signatures are rendered in monospace. Long labels truncate
with an ellipsis only when the column runs out of room, with the full label in a
tooltip. Containment relationships aren't drawn. The list caps at 500
declarations with a notice; in Diff mode, changed declarations come first so any
truncation only drops unchanged rows.

## Options

When the comparison comes from the `api-compatibility` comparator file, the host
shows one toggle. Set its initial value in `presentation.rendererOptions`:

| Control       | ID             | Values                                       | Default |
| ------------- | -------------- | -------------------------------------------- | ------- |
| Breaking only | `breakingOnly` | `true` (list only breaking changes), `false` | `false` |

There is no zoom. Comparisons support Diff and Side by side (choose the default
with `presentation.mode`). Animated and Swipe modes aren't offered, since
scrubbing between two lists would just pop rows in and out.

## What a comparison shows

- **Diff** merges every declaration from both revisions into one list. Changed
  rows state their status in the footer (`+ Added`, `− Removed`, `~ Modified`,
  `→ Renamed`) and highlight how the signature changed: added and removed
  declarations appear as a single `+` or `−` line, small edits strike through
  removed runs and underline added runs inline, and heavily rewritten signatures
  split into a removed line above an added line. Relabelled declarations strike
  through the old label before the new one, and changed qualified names show
  `old → new`.
- **Side by side** lists each revision's declarations in its own pane and order.
  When change highlighting is on, each pane marks its own side with the status
  and a `−` (Before) or `+` (After) line for modified signatures, highlighting
  the runs missing from the other revision.

Every row reserves space for its footer so toggling status labels never shifts
the layout, and removed and added runs use strikethrough and underline rather
than relying on color alone. Turning highlighting off removes change colors and
status words while keeping the markers and runs intact.

The **summary bar** totals every declaration regardless of kind into one figure
(`36 declarations +10 −1 ~6`).

**With the `api-compatibility` comparator file**, each change also gets a
compatibility level:

- The summary bar breaks changes down by level, breaking first, with each count
  acting as a filter:
  `2 breaking changes · 1 change of unknown compatibility · 5 additive changes · 1 compatible change`.
  Hovering a count shows the rules that produced it
  (`Rules: ApiCompat (default mode), reproduced`).
- Each changed row's footer adds its level right after its status
  (`~ Modified ! Breaking`, `+ Added ⊕ Additive`, `= Compatible`, `? Unknown`),
  with the reason in a tooltip. In Diff mode, the reason also appears directly
  under the signature (`Binary and source: Return type changed from …`), and any
  classification notices stay pinned above the list.
- Diff mode sorts breaking changes to the top; Side by side keeps each
  revision's original order.
- Parameter changes are explained in terms of how they affect callers. In
  TypeScript and Rust, renaming a parameter is compatible ("Parameter `a` was
  renamed to `b`; arguments are passed by position"), and making a required
  TypeScript parameter optional is additive ("Parameter `timeout` is now
  optional; calls may omit it"). In .NET, where callers can use named arguments,
  renaming a parameter is breaking (`CP0017`).

Selecting any declaration highlights it across every pane and in the host's
table, where the details panel shows the comparator's summary.

## Start from this definition

<!-- generated: definition -->

```json
{
  "extractor": "typescript-public-api",
  "id": "typescript-public-api",
  "renderer": "api",
  "title": "TypeScript public API"
}
```

<!-- end generated: definition -->

## Screenshot

Here is a TypeScript job queue's API in Diff mode with the default comparator:
added declarations appear as a single `+` line, and modified ones underline
their added runs inline.

![The API renderer in Diff: createdAt and timeout marked Added, delay and priority marked Modified with their added signature runs underlined](../../images/comparators/api-compatibility-default.png)

## Limitations

- It shows declarations and signatures only—not doc comments, attributes, or
  relationships between declarations.
- Without the `api-compatibility` comparator file (or another comparator that
  writes `metadata.compatibility`), every change is simply added, removed, or
  modified, with no indication of whether it is breaking.
- At most 500 declarations are shown (changed rows first in Diff mode). Use
  **Breaking only** to focus a classified comparison, or check the host's table
  for the full list.
- Very long signatures are diffed as whole lines (one removed, one added) rather
  than inline run by run.

## Related

- Default extractors:
  [`typescript-public-api`](../extractors/typescript-public-api.md),
  [`rust-public-api`](../extractors/rust-public-api.md),
  [`go-public-api`](../extractors/go-public-api.md),
  [`swift-public-api`](../extractors/swift-public-api.md), and
  [`dotnet-public-api`](../extractors/dotnet-public-api.md).
- The
  [`api-compatibility`](../../../packages/comparators/api-compatibility/README.md)
  comparator file and
  [the API compatibility model](../../models/api-compatibility.md) behind its
  rules.
- [The default comparator](../comparators/default.md), used when a definition
  doesn't name a comparator file.
- The [`api/v0` schema](../../reference/schemas/api.md).

## How it works

See the [package README](../../../packages/renderers/api/README.md) for how
signatures are diffed and how compatibility classifications are rendered.

## Build your own

The API renderer is a flat list optimized for reading signatures. Build your own
renderer when your team needs to see the API differently:

- **Hierarchy and shape** — modules, namespaces, or types arranged as a tree or
  map, with members nested inside their types instead of sorted by ID.
- **Custom grouping or signals** — grouping by owning team or stability level
  (stable, preview, deprecated), showing caller counts, or surfacing custom
  badges from your extractor.
- **Domain-specific notation** — HTTP routes and methods, CLI commands and
  flags, or a schema language's native syntax.

Check the lighter options first. If you just want to classify which changes
matter, use the `api-compatibility` comparator file or write your own comparator
that outputs `metadata.compatibility`—this renderer already knows how to draw
levels, reasons, summary counts, and the **Breaking only** toggle. You can also
set `presentation.mode` to open in Diff or Side by side, or switch to
[`graph`](graph.md) with a `graph/v0` extractor if you want structure rather
than signatures.

**In VS Code**, select **+ New Projection…** in the Projections view, choose
**Write a custom extractor, renderer or comparator** › **Custom renderer**, and
pick one of the built-in public API extractors. VS Code creates the definition
(`.github/projections/<id>.json`) and a TypeScript, Vite, and React renderer
package built on the renderer kit (`.github/projections/<id>/renderer`), then
opens both the definition and the projection tab. You can also choose **Ask an
agent to write it** and describe what you want shown.

**With the CLI**:

```sh
projections init <id> --extractor typescript-public-api --renderer custom
```

Inside the generated renderer package, run `npm install`, then use `npm run dev`
for a hot-reloading dev server, `npm run workbench` to preview your scenarios in
the browser, and `npm test` to run renderer checks across every scenario.

In VS Code, an open projection tab picks up your uncommitted definition changes
("Your edits"), and saving renderer source files automatically rebuilds and
reloads the view in a trusted workspace (using the package's `watch` or `build`
script). Run projection and renderer checks from the Testing view or via
`projections check -p <id>`. For a full walkthrough, see
[Develop a renderer](../../guides/develop-a-renderer.md), the
[renderer kit guide](../../guides/renderer-kit.md), and the
[renderer kit API](../../reference/renderer-kit.md)—including `ValueChange` for
displaying before-and-after values.
