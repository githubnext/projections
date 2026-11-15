# File standards

[Considered](https://github.com/quitepicky/considered) holds every hand-written
file to the standards in [`.considered.yaml`](../../.considered.yaml):

| Metric                    | Standard                                                                                           |
| ------------------------- | -------------------------------------------------------------------------------------------------- |
| `filesystem.bytes`        | at most 50,000 bytes                                                                               |
| `scc.code_lines`          | at most 500 lines of code                                                                          |
| `scc.complexity`          | at most 60, [scc](https://github.com/boyter/scc)'s count of branches and loops over the whole file |
| `filesystem.longest_line` | at most 400 bytes, a backstop behind the formatters                                                |

`npm run check:considered` runs it, as do `npm run check`,
`npm run tools -- check` and CI. It reports files within 10% of a standard as
warnings, which don't fail.

## Installing it

`tools/scripts/considered.mjs` runs the pinned release.
`node tools/scripts/considered.mjs install` downloads it from GitHub for your
platform, verifies its checksum and keeps it in your user cache; CI does the
same. A `considered` on `PATH` at the pinned version works too, and
`CONSIDERED=/path/to/considered` overrides both. To move to a new release,
change the version and checksums in the script (from the release's
`checksums.txt`) and fix whatever the new release reports.

## What it measures

The standards are for files that people write and read. The configuration
excludes the rest:

- Tests, vendored code, dependencies, generated files, assets and configuration
  whose shape another tool imposes (`package.json`, `Cargo.toml`,
  `tsconfig.json`), by Considered's categories.
- Rust test modules in their own `tests.rs` files: move a large inline
  `#[cfg(test)] mod tests { … }` into one with `#[cfg(test)] mod tests;`.
- Fixtures, snapshots, renderer `scenarios.json` files and the outputs the
  [generated-file registry](../../tools/cli/src/lib/generated.ts) lists, such as
  the JSON Schemas, the reference docs and `*.generated.ts`.
- Comparators (`*.comparator.yaml`): one file is one comparator and its digest,
  and the format has no include, so a comparator's size follows the rules it
  holds.
- Design records (`docs/design/`, including proposals): a record is one decision
  read end to end, so it stays one page however long it is.

Documentation counts, and so do GitHub Actions workflows: they are YAML, but
they are programs.

## Line length

The formatters own line length: oxfmt wraps code at 140 columns and Markdown
prose at 80, and rustfmt wraps Rust at 140 (`rustfmt.toml`). Don't wrap lines by
hand. What they can't wrap, such as long string literals and table rows, is
fine; the 400-byte limit only catches minified, pasted or generated-looking
content.

Long CLI help (clap's `long_about` and `after_help`) is Markdown in
`packages/cli/src/commands/help/`, so oxfmt wraps it like any prose. The CLI
loads each file with `include_str!` and `help_text::from_markdown`, which joins
a paragraph's lines back into one and prints ` ```text ` fences (examples and
aligned columns) as written, so what `--help` prints doesn't depend on the
wrapping.

oxfmt aligns every Markdown table, padding each column to its widest cell. A
table that would be wider than 140 columns aligned keeps its compact form
instead, marked with `<!-- prettier-ignore -->` on the line before it. A table
whose cells are paragraphs reads better as a list.

## When a file exceeds a standard

Most of the time a large or complex file deserves to be broken down: split it
along its responsibilities into a directory module (or a guide into focused
pages), extract helpers and simplify its functions. A split page keeps its path
as an index that links to a page per topic beside it, as
[`runner.md`](../runner.md) and [`runner/`](../runner/) do.

Where keeping it together is truly better engineering, add a variance to
`.considered.yaml` rather than contort the code:

```yaml
variances:
  path/to/file.rs:
    kind: declarative
    reason: Why this file reads best as one.
    metrics:
      scc.code_lines:
        max: 612
```

A variance names one file and the metrics it exceeds, with a specific reason,
and its limit is the file's current value, so it can't grow unnoticed. Its kind
is `declarative` for a table, vocabulary or rule list that reads best as one
list, or `cohesion` for code that is clearer in one place than split. Every
report lists the variances, so they stay visible. Remove a variance once the
file meets the standard again. (`npm run considered -- variance add` writes one
too, but it drops the file's comments.)
