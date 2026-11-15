---
description: "A command's text output, compared line by line"
---

# Command output: runtime CLI output

`command-output` answers: **What text does this CLI print before and after a
change?** It runs each configured command in both repository revisions and
compares the captured stdout, not the source files. A whitespace change in
source with no output change is a no-op; even a whitespace change in stdout is
meaningful. Commands use stable IDs so the same invocation remains the same
entity across revisions. Adding or removing a command adds or removes an entity.

Place a definition in `.github/projections/parcel-output.json` in the CLI
repository:

```json
{
  "id": "parcel-output",
  "title": "Parcel CLI output",
  "extractor": "command-output",
  "renderer": "text-diff",
  "inputs": {
    "commands": [
      {
        "id": "report",
        "label": "parcel report shipments.json",
        "command": ["node", "cli.mjs", "report", "shipments.json"],
        "presentation": "formatted"
      },
      {
        "id": "help",
        "label": "parcel --help",
        "command": ["node", "cli.mjs", "--help"],
        "presentation": "formatted"
      }
    ]
  },
  "execution": {
    "timeoutMs": 5000,
    "network": false,
    "reproducibility": "local"
  }
}
```

Requires the specified executable and its historical dependencies at **both**
revisions. Commands are argv arrays, never shell strings. They run in the
revision checkout with only the extractor's standard environment (`PATH`,
`LANG`, `LC_ALL`, `TZ`, `TERM=dumb`, `NO_COLOR=1`) plus explicitly declared
`execution.environment` variables. Nonzero exits and missing tools are errors,
not empty output. At most 16 commands are accepted, with 256 KiB of UTF-8 stdout
per command, enforced while the command runs; malformed UTF-8 and control
characters other than tabs and line breaks are rejected. stderr is diagnostic,
not part of the diff. Each output becomes a `graph/v0` entity `output:<id>` with
`data.text` holding the captured text exactly and no relationships. This is the
renderer's complete contract: any extractor that emits stable, labeled `output`
entities with string `data.text` can use `"renderer": "text-diff"`, without
running commands or changing the renderer. Each command may set
`"presentation": "prose"` for proportional, wrapping text or
`"presentation": "formatted"` for whitespace-aligned monospace output; formatted
is the default. The extractor stores this choice as `data.presentation` on each
output entity. Other extractors can set the same entity field without using
commands. The renderer displays both revisions of each entity in the selected
style, preferring the newer revision's style when it changes.

The viewer's one-column/two-column layout is a presentation control, not a
extractor input. The host's native control uses unified/split diff rows; a host
without that control shows stacked/side-by-side text endpoints instead.

Use `projections compare <base>..<head> -p parcel-output --trust` only after
reviewing **both** revisions and their subprocesses. Trust is not a sandbox;
`execution.network: false` is a declaration, not network isolation. External
state, locale, dependencies, and tool versions can alter output, so pin them or
use the optional isolated container runner for reproducible results. Stdout is
stored in collection artifacts: avoid printing secrets. The
[polyglot example](../../../examples/polyglot/README.md) demonstrates the same
protocol independently in Node and Python, with exact historical scripts.
