# Text diff

This renderer compares captured text—such as command output from each
revision—line by line in a classic diff view. Across a pull request, it answers
a straightforward question: "what does this command print differently now?"

<!-- generated: facts -->

- Name: `text-diff`
- Draws: [`graph/v0`](../../reference/schemas/graph.md)
- Comparison modes: Diff
- Package: `@githubnext/projections-renderer-text-diff`

<!-- end generated: facts -->

## When to use it

Use text diff whenever plain text is the clearest way to inspect a change—a
CLI's `--help`, a generated schema or lockfile summary, a `terraform plan`, a
test report, or a version listing. The
[`command-output`](../extractors/command-output.md) extractor runs the commands
you specify on both revisions and captures stdout; this renderer diffs the
results.

It expects `graph/v0` extractions whose entities are all of kind `output` with a
string `data.text` and no relationships. Anything else triggers an error rather
than rendering, so even though it technically accepts `graph/v0`, use
[`graph`](graph.md) or [`file-packing`](file-packing.md) for other `graph/v0`
extractors.

Built-in extractors that use it by default:

<!-- generated: extractors -->

| Built-in extractor                                  | Its default `renderer` |
| --------------------------------------------------- | ---------------------- |
| [`command-output`](../extractors/command-output.md) | `text-diff`            |

<!-- end generated: extractors -->

## What it draws

Each captured output appears in its own titled panel—its label (such as the
command) in the header, followed by numbered lines—in the order the extraction
emitted them. The `data.presentation` field controls text formatting:
`formatted` (the default) uses monospace without wrapping and scrolls
horizontally, while `prose` uses the body font and wraps to fit.

## Options

When a comparison has output, the host provides one layout control. Set its
starting value in `presentation.rendererOptions`:

| Control | ID               | Values                                        | Default |
| ------- | ---------------- | --------------------------------------------- | ------- |
| Layout  | `textDiffLayout` | `split` (Two columns), `unified` (One column) | `split` |

Frames narrower than 640 px automatically fall back to a single column, and
there is no zoom.

Only Diff mode is supported, since line-by-line text changes are far clearer in
a diff than in an animation, swipe, or unaligned side-by-side panes.

## What a comparison shows

Every output from both revisions appears in order. Each panel header ends with
its status (`+ Added`, `− Removed`, `~ Modified`), removed outputs strike
through their label, and unchanged outputs show as plain numbered lines.

- **Two columns** puts Before on the left and After on the right, each with its
  own line numbers. Modified lines sit beside their replacements, and one-sided
  lines pair with blank spacers so unchanged context stays aligned.
- **One column** renders a unified diff with old and new line numbers, showing
  removed lines before added ones inside each hunk.

Removed lines are tinted and marked `−`, and added lines are tinted and marked
`+`. When a removed line pairs with an added one, the differing words receive a
stronger tint. Line-ending and trailing-newline changes are annotated
explicitly. Runs of more than six unchanged lines fold into an "N unchanged
lines" row (keeping three lines of context around every change) that you can
click to expand. Turning highlighting off removes tints and status words while
preserving rows, markers, and layout.

The **summary bar** counts outputs with their deltas, followed by the total
lines in After and the inserted/deleted line counts across all outputs
(`4 outputs +1 −1 ~2 · 21 lines +11 −9`, or `21 lines` in a single revision).

Clicking an output's label selects it in the host's table.

## Start from this definition

<!-- generated: definition -->

```json
{
  "extractor": "command-output",
  "id": "command-output",
  "renderer": "text-diff",
  "title": "Command output"
}
```

<!-- end generated: definition -->

## Limitations

- It compares raw text rather than semantics, so reordered keys or changing
  timestamps show up as diffs. Keep command output deterministic (sorted and
  free of dates) at the source.
- Each output caps at 2,000 rows. For very large outputs that exceed the diff
  budget, the changed middle section is shown as a full replacement with a
  notice.
- Only Diff mode is supported.
- Only `output` entities without relationships are accepted.

## Related

- [`command-output`](../extractors/command-output.md) — the default extractor.
- [`graph`](graph.md) and [`file-packing`](file-packing.md) — for other
  `graph/v0` extractions.
- [The default comparator](../comparators/default.md) — determines which outputs
  changed.

## How it works

See the [package README](../../../packages/renderers/text-diff/README.md) for
details on the extraction shape and line-diffing logic.

## Build your own

Text diff treats every output as plain lines. Build a custom renderer when your
output has structure worth visualizing directly:

- **Structured diffs** — JSON, YAML, or tabular data compared field by field or
  cell by cell instead of line by line.
- **Domain-specific views** — test reports showing passed, failed, and skipped
  counts; benchmarks with numeric deltas; or execution plans broken down by
  action.
- **Custom signal-to-noise** — surfacing errors, warnings, or version numbers at
  the top and folding away boilerplate.

Check the lighter options first. **Layout** (via `presentation.rendererOptions`)
switches between split and unified diffs, and sorting or normalizing your
command output often makes diffs much cleaner on its own. If the output is
structured, writing an extractor that parses it into entities for
[`graph`](graph.md) or another built-in renderer is often simpler than building
a renderer from scratch.

**In VS Code**, select **+ New Projection…** in the Projections view, choose
**Write a custom extractor, renderer or comparator** › **Custom renderer**, and
pick the built-in extractor it draws. VS Code scaffolds the definition
(`.github/projections/<id>.json`) and a TypeScript, Vite, and React renderer
package built on the renderer kit (`.github/projections/<id>/renderer`), then
opens both the definition and the projection tab. You can also choose **Ask an
agent to write it** and describe what you want shown.

**With the CLI**:

```sh
projections init <id> --extractor command-output --renderer custom
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
[renderer kit API](../../reference/renderer-kit.md).
