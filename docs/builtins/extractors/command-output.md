# Command output

This extractor runs commands you configure in both revisions and compares what
they print line by line—whether that is a CLI's `--help` text, a generated
report, a schema dump, or a list of build outputs. It answers what a source diff
cannot show directly: how a change affects the actual text your commands
produce.

<!-- generated: facts -->

- ID: `command-output`
- Extraction schema: [`graph/v0`](../../reference/schemas/graph.md)
- Drawn by default with: [`text-diff`](../renderers/text-diff.md)
- Needs `--trust`: When it runs ecosystem tools or repository code
  (`when-executing-tools`)
- Never suggested by `projections explore`: add it yourself

<!-- end generated: facts -->

## When to use it

Use this extractor when a command's printed output is the behavior you want to
review—CLI help text and error messages, generated reports or snapshots,
framework route tables, or rendered configuration templates. A whitespace tweak
in source code that leaves the output untouched shows nothing, while even a
single-character change in the output stands out immediately.

Because it executes your commands, it always requires `--trust`; make sure you
review both revisions before comparing them. Projections never suggests this
extractor automatically, so add the definition yourself. If your commands output
structured data that would be better compared item by item, see
[Build your own](#build-your-own).

## What it reads

The extractor captures standard output from each entry in `commands`, running
every command in both revisions:

```json
"inputs": {
  "commands": [
    {"id": "help", "label": "mycli --help", "command": ["node", "cli.mjs", "--help"]},
    {"id": "report", "label": "mycli report sample.json", "command": ["node", "cli.mjs", "report", "sample.json"], "presentation": "formatted"}
  ]
}
```

- `id` gives the output a stable name (letters, digits, `.`, `_`, and `-`) so
  Projections can match the same command across revisions.
- `label` sets the heading shown above the output, usually the command itself.
- `command` is an argv array executed directly from the revision root without a
  shell.
- `presentation` (optional) controls formatting: `formatted` (the default) uses
  an aligned, unwrapped monospace font, while `prose` wraps the text in a
  standard text font.

Each command runs in a minimal environment containing `PATH`, a UTF-8 locale,
`TZ=UTC`, `TERM=dumb`, and `NO_COLOR=1`, plus any variables granted in
`execution.environment`. Every command must exit with status 0. Standard error
is kept for diagnostics and is never compared. Whatever tools and dependencies
your commands need must be available for both revisions, and
`execution.timeoutMs` (30 seconds by default) applies to all commands combined:

```json
"execution": {"timeoutMs": 60000, "environment": ["HOME"]}
```

Each command becomes a single `output` entity (`output:<id>`) holding its exact
printed `text`, with no relationships.

## Options

<!-- generated: inputs -->

| Input      | Meaning                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------- |
| `commands` | Array of {id, label, command} with stable ID and executable argv; each command runs in both revisions (requires --trust). |

<!-- end generated: inputs -->

You can configure up to 16 commands, each producing up to 256 KiB of UTF-8 text.
Output containing control characters other than tabs and line breaks is
rejected—setting `NO_COLOR=1` and `TERM=dumb` prevents most tools from emitting
ANSI color codes.

You can preset the [`text-diff`](../renderers/text-diff.md) renderer's
**Layout** control in `presentation.rendererOptions` via `textDiffLayout`
(`split` for two columns, which is the default, or `unified` for a single
column).

## What a comparison shows

- **Added or removed outputs** appear whenever a command is added to or removed
  from the definition.
- **Modified outputs** render as a line-by-line diff, with removed lines marked
  `−`, added lines marked `+`, and changed words highlighted within each line.
  Changes to line endings or trailing newlines are called out explicitly.
  Unchanged runs longer than six lines fold automatically, leaving three lines
  of context around each change.
- The summary bar tallies the outputs and their changes, followed by the total
  lines in After and the net lines added and removed (for example,
  `4 outputs +1 −1 ~2 · 21 lines +11 −9`).

Comparisons render strictly as a text diff (without animated, side-by-side, or
swipe modes), since a classic diff is the clearest way to read line-by-line text
changes.

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

- Command output can be affected by factors outside the revision—installed tool
  versions, external services, files outside the repository, or the system
  clock. Pin what you can and keep commands focused on what the revision itself
  determines.
- `execution.network: false` is a declaration recorded with the extraction, not
  network isolation, and `--trust` is not a sandbox.
- Standard output is saved inside the extraction, so make sure your commands
  never print secrets.
- Each output displays at most 2,000 diff rows.

## Related

- [`text-diff`](../renderers/text-diff.md) is the renderer that displays these
  outputs.
- [`github-actions-jobs`](github-actions-jobs.md) compares how a pipeline is
  declared rather than what a command prints.
- [Volatile data](../../guides/how-it-works.md#volatile-data) explains how to
  handle extractions whose values shift between runs.

## How it works

See the [package README](../../../packages/extractors/command-output/README.md)
for how commands are executed and what limits apply.

## Build your own

Consider writing a custom extractor when plain text is not the best way to
compare what your commands produce:

- **Structured output**, such as JSON listing routes, feature flags,
  dependencies, or an OpenAPI document. Comparing structured data as entities
  means a renamed route shows as one change and a reordered list shows as no
  change at all. Parse it in a custom extractor and pair it with a renderer that
  fits its shape.
- **Output that varies between runs**, like timestamps, durations, or generated
  IDs that would mark every run as changed. Strip them out in your extractor, or
  declare them volatile so they only register beyond a tolerance.
- **Larger or more complex runs** that exceed 16 commands or 256 KiB per output,
  or that require setup steps beforehand.

Try the lighter options first: add commands to this extractor, or point a
command at a small wrapper script that normalizes output before printing it. If
your tool already emits an extraction, you can run it directly as an extractor
(`projections init <id> --command '["node","tools/routes.mjs"]'`). To display
the same outputs differently, keep this extractor and write a custom renderer.

**In VS Code**, open the Projections view, choose **+ New Projection…**, and
select **Write a custom extractor, renderer or comparator** › **Custom
extractor** (or **Custom extractor and renderer**). Pick a language to scaffold
the definition and a starter extractor (`extract.mjs`, `extract.py`, or
`extract.go`) under `.github/projections/<id>/`, paired with the built-in graph
renderer. You can also choose **Ask an agent to write it** and describe what you
want to see.

**With the CLI**, scaffold a new extractor while keeping the text-diff renderer
(any extractor emitting `output` entities with a string `data.text` works with
it):

```sh
projections init <id> --language node --renderer text-diff
```

An extractor is any program that prints an extraction. Run
`projections show -p <id> --trust` while you iterate—an open projection tab
picks up your uncommitted edits ("Your edits") and flags stale results, and the
Testing view runs your projection's checks. Walk through
[Write your first extractor](../../guides/first-extractor.md) to get started,
and check [Extraction schema](../../guides/schemas.md#extraction-schema) for the
output format.
