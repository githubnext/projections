# Text diff

Captured text, such as the output of commands run at each revision, compared
line by line as a classic diff. Compared across a pull request, it answers "what
does this command print differently now?"

<!-- generated: facts -->

- Name: `text-diff`
- Draws: [`graph/v0`](../../reference/schemas/graph.md)
- Comparison modes: Diff
- Package: `@githubnext/projections-renderer-text-diff`

<!-- end generated: facts -->

## When to use it

Use it when the clearest picture of a change is text: a CLI's `--help`, a
generated schema or lockfile summary, a `terraform plan`, a test report, a
tool's version listing. The [`command-output`](../extractors/command-output.md)
extractor runs the commands you name at both revisions and captures what they
print; this renderer diffs the results.

It draws only captured outputs: `graph/v0` extractions whose entities are all of
kind `output`, with a string `data.text` and no relationships. Anything else is
reported as an error rather than drawn, so although other `graph/v0` extractors
are listed as accepted, give them [`graph`](graph.md) or
[`file-packing`](file-packing.md) instead.

Built-in extractors that draw with it by default:

<!-- generated: extractors -->

| Built-in extractor                                  | Its default `renderer` |
| --------------------------------------------------- | ---------------------- |
| [`command-output`](../extractors/command-output.md) | `text-diff`            |

<!-- end generated: extractors -->

## What it draws

Each output is a titled panel: its label (the command, say) in a header band,
then its numbered lines. An output's `data.presentation` decides how its text is
set: `formatted` (the default) in the monospace font, never wrapping and
scrolling sideways; `prose` in the text font, wrapping. Outputs keep the
extraction's order.

## Options

For a comparison with output, the host draws one control; set its starting value
in the definition's `presentation.rendererOptions`:

| Control | ID               | Values                                        | Default |
| ------- | ---------------- | --------------------------------------------- | ------- |
| Layout  | `textDiffLayout` | `split` (Two columns), `unified` (One column) | `split` |

In a frame narrower than 640 px, two columns read as one. It has no zoom.

It presents a comparison only as Diff: a text changes line by line, which a diff
shows better than an animation, two unaligned columns of text or a swipe.

## What a comparison shows

Every output of both revisions, in order. Its header ends in its status
(`+ Added`, `− Removed`, `~ Modified`), and a removed output's label is struck
through; an output whose text didn't change shows as plain numbered lines.

- **Two columns**: Before on the left and After on the right, each with its own
  line numbers. A changed line sits beside its replacement, and a line on one
  side only faces a blank row, so unchanged lines stay aligned.
- **One column**: a unified diff with old and new line numbers; within each
  change, removed lines come before added ones.

Removed lines are tinted and marked `−`, added lines tinted and marked `+`;
where a removed line pairs with an added one, the words they don't share are
tinted more strongly. Line-ending and final-newline changes show, annotated.
Runs of more than six unchanged lines fold into an "N unchanged lines" row,
keeping three lines of context around each change; activating it shows them.
With highlighting off, the rows, markers and layout stay, without tints or
status words.

The **summary bar** counts the outputs, with their changes, then every line in
After, with the lines the diff inserts and deletes across all outputs:
`4 outputs +1 −1 ~2 · 21 lines +11 −9`; in one revision, `21 lines`.

Selecting an output's label selects it in the host's table.

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

- It compares text, not meaning: reordered keys or a changed timestamp are
  changes like any other. Make the commands' output stable (sorted, without
  dates) at the source.
- It shows at most 2,000 rows per output; beyond a work budget, the changed
  middle of a very large output is shown as wholly replaced, with a notice.
- It has only a Diff mode.
- It draws only `output` entities, with no relationships.

## Related

- [`command-output`](../extractors/command-output.md), the extractor it draws by
  default.
- [`graph`](graph.md) and [`file-packing`](file-packing.md), for other
  `graph/v0` extractions.
- [The default comparator](../comparators/default.md), which decides which
  outputs changed.

## How it works

The [package README](../../../packages/renderers/text-diff/README.md) covers the
extraction shape and how lines are compared.

## Build your own

Text diff treats every output as lines. Write your own renderer when the text
has structure worth drawing:

- **Structured output**: JSON, YAML or a table compared field by field or cell
  by cell, rather than line by line.
- **A domain notation**: a test report as passed, failed and skipped tests; a
  benchmark as numbers with their change; a plan as the actions it takes.
- **Your own emphasis**: the lines that matter (errors, warnings, version
  numbers) brought forward and the rest folded away.

Try the lighter options first. **Layout** (and its
`presentation.rendererOptions`) chooses one or two columns, and a command that
prints sorted, stable text makes a smaller, clearer diff. When the output is
structured, an extractor that parses it into entities, drawn by
[`graph`](graph.md) or another built-in that accepts its schema, often beats a
new renderer.

**In VS Code**, choose **+ New Projection…** in the Projections view, then
**Write a custom extractor, renderer or comparator** › **Custom renderer**, and
pick the built-in extractor it draws. It writes the definition
(`.github/projections/<id>.json`) and a TypeScript, Vite and React renderer
package built on the renderer kit (`.github/projections/<id>/renderer`), and
opens the definition and the projection's tab. Or choose **Ask an agent to write
it** and describe what the projection should show.

**With the CLI**:

```sh
projections init <id> --extractor command-output --renderer custom
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
[renderer kit API](../../reference/renderer-kit.md) cover the pieces.
