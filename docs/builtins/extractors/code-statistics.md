# Code statistics

How much of the repository is written in each language: files, and lines of
code, comments and blanks, split into test files and the rest. Compared across a
pull request, it answers "how much code did this change add or remove, in which
languages, and how much of it is tests?"

<!-- generated: facts -->

- ID: `code-statistics`
- Extraction schema: [`metrics/v0`](../../reference/schemas/metrics.md)
- Drawn by default with: [`code-statistics`](../renderers/code-statistics.md)
- Needs `--trust`: No (`none`)
- Suggested when the repository has: `*`, `**/*`

<!-- end generated: facts -->

## When to use it

Use it in any repository, whatever its languages, to see a change's size the way
people talk about it: "adds 2,000 lines of TypeScript and 600 of tests",
"removes the last of the CoffeeScript", "a third of this pull request is
generated JSON". It reads only files and runs nothing, so it is safe on any pull
request without `--trust`.

It is a measurement, not a model of the design: it can't say what the code does
or how its parts depend on each other. For the files themselves, sized and
placed in their folders, use [`repository-map`](repository-map.md).

## What it reads

Every file of the revision (tracked, and untracked files Git doesn't ignore)
that `include` selects and `exclude` doesn't. Unless `defaultExcludes` is
`false`, these are skipped too, because a vendored tree or a lockfile would
drown out the repository's own code: `node_modules`, `.git`, `dist`, `build`,
`out`, `bin`, `obj`, `target`, `vendor`, `__pycache__`, `.venv`, `venv`,
`coverage`, `.next` and `.nuxt` folders, `*.min.js`, `*.min.css`, `*.lock` and
`package-lock.json`.

Languages and line kinds come from [tokei](https://github.com/XAMPPRocky/tokei),
which recognizes a file by its name or extension:

- Every physical line is exactly one of code, comment or blank, so the three add
  up to the total. A line with both code and a comment counts as code.
- Documentation strings that span lines count as comments, and so does the prose
  of Markdown and plain text.
- Code embedded in another language (a `<script>` in HTML, a fenced block in
  Markdown, the sections of a Vue file) counts toward the host file's language.

A file is a test when its path matches a `tests` glob. By default those are
common conventions: `**/test/**`, `**/tests/**`, `**/__tests__/**`,
`**/spec/**`, `**/*.test.*`, `**/*.spec.*`, `**/*_test.*`, `**/*_spec.*`,
`**/test_*.py` and `**/*Tests.cs`.

Each language is one `language` entity, named as tokei names it (`Rust`,
`TypeScript`, `TSX`), with `files`, `code`, `comment`, `blank`, `lines` and
`bytes`, and the same counts for its test files (`testFiles`, `testCode`, …).
Every count is on one entity, so a language whose counts moved is one modified
language.

## Options

<!-- generated: inputs -->

| Input             | Meaning                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------- |
| `defaultExcludes` | Set false to count dependency, output and lockfile paths too.                               |
| `exclude`         | Array of globs to skip in addition to the defaults.                                         |
| `include`         | Array of globs to count; default every file.                                                |
| `languages`       | Map of file extension to a tokei language name.                                             |
| `tests`           | Array of globs classifying test files; default common test conventions; [] classifies none. |

<!-- end generated: inputs -->

Globs use `*` within a folder, `**` across folders and `?` for one character.
`languages` reassigns an extension to a language tokei already knows, for an
ambiguous one: tokei counts `.inc` as BitBake, so a PHP repository sets
`{"languages": {".inc": "PHP"}}`. Naming a language tokei doesn't know is an
error.

```json
"inputs": {"include": ["src/**", "tests/**"], "exclude": ["**/*.generated.ts"], "tests": ["tests/**"]}
```

The [`code-statistics`](../renderers/code-statistics.md) renderer's controls
choose what the chart shows, and a definition presets them in
`presentation.rendererOptions`: **Measure** (`measure`: `code`, `comment`,
`blank`, `lines` or `files`), **By language** (`byLanguage`, or the code,
comment and blank composition), **Chart** (`chart`: `bars`, `share` or `table`, with **Sort by**, `sort`, and
**Changes first**, `sortChangesFirst`) and
**Files** (`scope`: `all`, `tests` or `other`).

## What a comparison shows

- **Languages** added or removed: the first file in a language, or the last one
  gone.
- **Languages** modified, whose counts changed: each bar grows or shrinks in its
  step, with the lines gained and lost so far drawn inside it, and its signed
  change beside it.
- The summary bar counts the languages and their changes, then states the
  chart's total in After with its net change, in the words of the Measure and
  Files controls: `11 languages +2 −1 ~8 · 39,882 lines of code +2,056`, or
  `770 lines of code in tests +290`.

Every comparison mode works. A comparison opens in Diff, which shows each
language's Before count struck through beside its After count; Side by side,
Animated and Swipe are a click away.

## Start from this definition

<!-- generated: definition -->

```json
{
  "extractor": "code-statistics",
  "id": "code-statistics",
  "renderer": "code-statistics",
  "title": "Code statistics"
}
```

<!-- end generated: definition -->

## Limitations

- Only files tokei recognizes by name or extension are counted. Everything else,
  including an extensionless script recognizable only by its shebang, is skipped
  rather than guessed at; so are binary files, files over 8 MiB and symlinks.
  The extraction's `metadata.skipped` counts each.
- Tests are classified by path, not by content or test framework.
- Counts depend on tokei's language definitions, pinned for each release of
  Projections. A release that upgrades tokei can rename languages or count lines
  differently, so compare extractions made by the same release.
- The chart draws the 24 largest languages; the table view lists them all.

## Related

- [`code-statistics`](../renderers/code-statistics.md), the renderer that draws
  it.
- [`repository-map`](repository-map.md): every file, sized by bytes or lines,
  inside its folders.
- [The default comparator](../comparators/default.md), which can change the
  largest languages first (`order.by: data.code`).

## How it works

The [package README](../../../packages/extractors/code-statistics/README.md)
covers how tokei counts and what changed from the earlier counter.

## Build your own

Write your own extractor when lines per language aren't the measure your
reviewers care about:

- **Another measure**: cyclomatic complexity, test coverage, lint warnings or
  bundle size per package, from the tools that already compute them.
- **Another grouping**: lines per team (from `CODEOWNERS`), per service or per
  package, rather than per language.
- **Your own classification**: generated, vendored or migrated code told apart
  by markers in the files, not just by path.

Try the lighter options first: `include`, `exclude` and `tests` decide what
counts and what is a test, `languages` fixes an ambiguous extension, and the
renderer's controls switch measure, grouping and chart. To draw the same counts
differently, keep this extractor and write a renderer.

**In VS Code**, choose **+ New Projection…** in the Projections view, then
**Write a custom extractor, renderer or comparator** › **Custom extractor** (or
**Custom extractor and renderer**), and pick its language. It writes the
definition and a starter extractor (`extract.mjs`, `extract.py` or `extract.go`)
under `.github/projections/<id>/`, drawn by the built-in graph renderer. Or
choose **Ask an agent to write it** and describe what the projection should
show.

**With the CLI**, keep this chart's renderer:

```sh
projections init <id> --language node --renderer code-statistics
```

Its renderer draws `metrics/v0` entities with numeric `files`, `code`,
`comment`, `blank` and `lines`. An extractor is any program that prints an
extraction. Run it with `projections show -p <id> --trust` as you change it; an
open projection tab uses your uncommitted edits ("Your edits") and says when its
results are out of date, and the Testing view runs the projection's checks.
[Write your first extractor](../../guides/first-extractor.md) walks through one,
and [Extraction schema](../../guides/schemas.md#extraction-schema) describes
what it prints.
