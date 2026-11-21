# File standards

We use [Considered](https://github.com/quitepicky/considered) to keep
hand-written files readable and maintainable, using the limits in
[`.considered.yaml`](../../.considered.yaml):

| Metric                    | Standard                                                                                           |
| ------------------------- | -------------------------------------------------------------------------------------------------- |
| `filesystem.bytes`        | at most 50,000 bytes                                                                               |
| `scc.code_lines`          | at most 500 lines of code                                                                          |
| `scc.complexity`          | at most 60, [scc](https://github.com/boyter/scc)'s count of branches and loops over the whole file |
| `filesystem.longest_line` | at most 400 bytes, a backstop behind the formatters                                                |

Run it directly with `npm run check:considered`, or as part of `npm run check`,
`npm run tools -- check`, and CI. Files within 10% of a threshold show up as
non-failing warnings so you see them coming before they break the build.

## Installing it

`tools/scripts/considered.mjs` wraps the pinned release. Running
`node tools/scripts/considered.mjs install` downloads the right binary for your
platform from GitHub, verifies its checksum, and caches it in your user
directory (CI uses the same path). If you already have `considered` at the
pinned version on your `PATH`, that works too, and setting
`CONSIDERED=/path/to/considered` overrides both.

To upgrade to a newer release, update the version and checksums in the script
from the release's `checksums.txt`, then address any new findings it reports.

## What it measures

These limits apply to files that people actually write and read. The config
excludes everything else:

- Tests, vendored code, dependencies, generated files, assets, and tool-shaped
  configuration (`package.json`, `Cargo.toml`, `tsconfig.json`), handled by
  Considered's built-in categories.
- Separate Rust test modules in `tests.rs` files — if an inline
  `#[cfg(test)] mod tests { … }` block grows large, move it into a sibling file
  with `#[cfg(test)] mod tests;`.
- Fixtures, snapshots, renderer `scenarios.json` files, and outputs tracked in
  the [generated-file registry](../../tools/cli/src/lib/generated.ts) (JSON
  Schemas, reference docs, `*.generated.ts`, and so on).
- Comparators (`*.comparator.yaml`), since each file is a self-contained
  comparator with its own digest and no include mechanism, so its length scales
  with its rules.
- Design records under `docs/design/` (including proposals), because a decision
  record is meant to be read end to end as a single page.

Documentation and GitHub Actions workflows _are_ checked — workflows may be
YAML, but they're still programs.

## Line length

Let the formatters handle line wrapping: oxfmt wraps code at 140 columns and
Markdown prose at 80, and rustfmt wraps Rust at 140 (`rustfmt.toml`). Don't wrap
lines manually. Things the formatters can't wrap — long string literals, wide
table rows — are fine; the 400-byte limit is just a safety net for minified,
pasted, or generated-looking content.

Long CLI help text (clap's `long_about` and `after_help`) lives as Markdown in
`packages/cli/src/commands/help/` so oxfmt wraps it like normal prose. The CLI
embeds each file with `include_str!` and passes it through
`help_text::from_markdown`, which rejoins wrapped paragraph lines while leaving
` ```text ` fenced blocks (examples and aligned columns) untouched. That way
`--help` output never depends on source line breaks.

oxfmt also aligns Markdown tables by padding each column to its widest cell. If
aligning a table would push it past 140 columns, put `<!-- prettier-ignore -->`
on the line above it to keep the compact layout. If a table's cells have grown
into full paragraphs, consider rewriting it as a list instead.

## When a file exceeds a standard

Usually, hitting a limit is a signal to break the file up: split it along
natural responsibilities into a directory module (or split a long guide into
focused pages), extract helpers, and simplify branching. When you split a doc
page, keep the original path as an index linking to topic pages alongside it,
the way [`runner.md`](../runner.md) and [`runner/`](../runner/) do.

When keeping a file together is genuinely the cleaner design, add a variance to
`.considered.yaml` instead of twisting the code to fit:

```yaml
variances:
  path/to/file.rs:
    kind: declarative
    reason: Why this file reads best as one.
    metrics:
      scc.code_lines:
        max: 612
```

Each variance names one file, the specific metrics it exceeds, and why, with the
limit set to the file's current value so it can't quietly keep growing. Use
`declarative` for tables, vocabularies, or rule lists that read best in one
place, and `cohesion` for code that is clearer together than split apart.
Variances are printed in every report so they stay visible; remove one as soon
as the file drops back under the standard. (You can also run
`npm run considered -- variance add`, though be aware it strips comments from
the YAML file.)
