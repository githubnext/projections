# Command output

What your own commands print, run in both revisions and compared line by line: a
CLI's `--help`, a generated report, a schema dump, a build's list of outputs. It
answers "what does this change do to the text these commands print?", which no
source diff shows directly.

<!-- generated: facts -->

- ID: `command-output`
- Extraction schema: [`graph/v0`](../../reference/schemas/graph.md)
- Drawn by default with: [`text-diff`](../renderers/text-diff.md)
- Needs `--trust`: When it runs ecosystem tools or repository code
  (`when-executing-tools`)
- Never suggested by `projections explore`: add it yourself

<!-- end generated: facts -->

## When to use it

Use it when a command's output is the behavior to review: help text and error
messages a CLI shows its users, a report or snapshot a script generates, the
routes a framework lists, a configuration rendered from templates. A whitespace
change in the source that leaves the output alone shows nothing; a one-character
change in the output shows.

It runs your commands, so it always needs `--trust`: review both revisions
before you compare them. Nothing in a repository suggests it, so add the
definition yourself. If the commands print structured data you'd rather compare
item by item, see [Build your own](#build-your-own).

## What it reads

The standard output of each command in `commands`, run in both revisions:

```json
"inputs": {
  "commands": [
    {"id": "help", "label": "mycli --help", "command": ["node", "cli.mjs", "--help"]},
    {"id": "report", "label": "mycli report sample.json", "command": ["node", "cli.mjs", "report", "sample.json"], "presentation": "formatted"}
  ]
}
```

- `id`: a stable name (letters, digits, `.`, `_` and `-`), so the same command
  is the same output across revisions.
- `label`: the output's heading, typically the command line.
- `command`: an argv array, run without a shell in the revision's root.
- `presentation` (optional): `formatted` (the default) shows the text in a
  monospace font, aligned and unwrapped; `prose` wraps it in the text font.

Each command runs with a minimal environment: `PATH`, a UTF-8 locale, `TZ=UTC`,
`TERM=dumb` and `NO_COLOR=1`, plus the variables the definition's
`execution.environment` grants. It must exit with status 0. Standard error is
kept as a diagnostic, never compared. The tools, and the dependencies each
revision's commands need, must be available for both revisions. The definition's
`execution.timeoutMs` (30 seconds by default) covers every command together:

```json
"execution": {"timeoutMs": 60000, "environment": ["HOME"]}
```

Each command is one `output` entity, `output:<id>`, with its `text` exactly as
printed, and no relationships.

## Options

<!-- generated: inputs -->

| Input      | Meaning                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------- |
| `commands` | Array of {id, label, command} with stable ID and executable argv; each command runs in both revisions (requires --trust). |

<!-- end generated: inputs -->

At most 16 commands, each printing at most 256 KiB of UTF-8 text. Output with
control characters other than tabs and line breaks is rejected; `NO_COLOR=1` and
`TERM=dumb` keep most tools from printing color codes.

The [`text-diff`](../renderers/text-diff.md) renderer's **Layout** control
(`textDiffLayout`: `split` for two columns, the default, or `unified` for one)
is preset in `presentation.rendererOptions`.

## What a comparison shows

- **Outputs** added or removed, when a command is added to or removed from the
  definition.
- **Outputs** modified, whose text differs: a line diff, removed lines marked
  `−` and added lines `+`, with the words that changed within a line marked more
  strongly. Line-ending and final-newline changes show, annotated. Unchanged
  runs longer than six lines fold, keeping three lines of context around each
  change.
- The summary bar counts the outputs and their changes, then every line in After
  with the lines the diff added and removed:
  `4 outputs +1 −1 ~2 · 21 lines +11 −9`.

A comparison is shown only as a diff (no animation, side by side or swipe): text
changes line by line, and the classic diff shows that best.

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

- Output can depend on more than the revision: installed tool versions, external
  services, files outside the repository, the clock. Pin what you can, and keep
  commands to what the revision decides.
- `execution.network: false` is a declaration recorded with the extraction, not
  network isolation, and `--trust` is not a sandbox.
- Standard output is stored with the extraction: don't print secrets.
- Each output shows at most 2,000 diff rows.

## Related

- [`text-diff`](../renderers/text-diff.md), the renderer that draws it.
- [`github-actions-jobs`](github-actions-jobs.md), for how a pipeline is
  declared rather than what a command prints.
- [Volatile data](../../guides/how-it-works.md#volatile-data), for extractions
  whose values vary between runs.

## How it works

The [package README](../../../packages/extractors/command-output/README.md)
covers how commands are run and what they're allowed.

## Build your own

Write your own extractor when text isn't the best way to compare what your
commands produce:

- **Structured output**: a command that prints JSON (routes, feature flags, a
  dependency list, an OpenAPI document) compares better as entities, so a
  renamed route is one change and a reordered list is none. Parse it in an
  extractor and pick a renderer for its shape.
- **Output that varies between runs**: timestamps, durations or generated IDs
  that would mark every run changed. Leave them out, or declare them volatile so
  they only count beyond a tolerance.
- **More than this extractor allows**: more than 16 commands, outputs over 256
  KiB, or output that needs setup first.

Try the lighter options first: add commands, or point one at a script that
normalizes the output before printing it. If your program already prints an
extraction, use it as the extractor directly
(`projections init <id> --command '["node","tools/routes.mjs"]'`). To draw the
outputs differently, keep this extractor and write a renderer.

**In VS Code**, choose **+ New Projection…** in the Projections view, then
**Write a custom extractor, renderer or comparator** › **Custom extractor** (or
**Custom extractor and renderer**), and pick its language. It writes the
definition and a starter extractor (`extract.mjs`, `extract.py` or `extract.go`)
under `.github/projections/<id>/`, drawn by the built-in graph renderer. Or
choose **Ask an agent to write it** and describe what the projection should
show.

**With the CLI**, keep the text diff (any extractor whose entities are `output`s
with a string `data.text` can use it):

```sh
projections init <id> --language node --renderer text-diff
```

An extractor is any program that prints an extraction. Run it with
`projections show -p <id> --trust` as you change it; an open projection tab uses
your uncommitted edits ("Your edits") and says when its results are out of date,
and the Testing view runs the projection's checks.
[Write your first extractor](../../guides/first-extractor.md) walks through one,
and [Extraction schema](../../guides/schemas.md#extraction-schema) describes
what it prints.
