# Code statistics

This extractor breaks down a repository by language, counting files along with
lines of code, comments, and blank lines, split between test files and
everything else. Compared across a pull request, it shows how much code a change
adds or removes, which languages it touches, and how much of that diff is tests.

<!-- generated: facts -->

- ID: `code-statistics`
- Extraction schema: [`metrics/v0`](../../reference/schemas/metrics.md)
- Drawn by default with: [`code-statistics`](../renderers/code-statistics.md)
- Needs `--trust`: No (`none`)
- Suggested when the repository has: `*`, `**/*`

<!-- end generated: facts -->

## When to use it

Use this extractor in any repository, regardless of language, to see the size of
a change the way engineers actually talk about it—"adds 2,000 lines of
TypeScript and 600 of tests," "removes the last of the CoffeeScript," or "a
third of this pull request is generated JSON." Because it only reads files and
never executes code, it is safe to run on any pull request without `--trust`.

Keep in mind that this is a measurement rather than a structural model. It tells
you how much code moved, not what the code does or how components depend on each
other. If you want to see individual files sized inside their folder hierarchy,
use [`repository-map`](repository-map.md).

## What it reads

The extractor scans every file in the revision (both tracked files and untracked
files not ignored by Git) that matches `include` and is not filtered out by
`exclude`. Unless you set `defaultExcludes` to `false`, common generated and
vendored paths are skipped automatically so lockfiles and dependencies do not
drown out your own code: `node_modules`, `.git`, `dist`, `build`, `out`, `bin`,
`obj`, `target`, `vendor`, `__pycache__`, `.venv`, `venv`, `coverage`, `.next`,
and `.nuxt` folders, plus `*.min.js`, `*.min.css`, `*.lock`, and
`package-lock.json`.

Language detection and line classification come from
[tokei](https://github.com/XAMPPRocky/tokei), which identifies each file by its
name or extension:

- Every physical line counts as exactly one of code, comment, or blank, so the
  three always sum to the total. Lines containing both code and a comment count
  as code.
- Multi-line docstrings count as comments, as does prose in Markdown and plain
  text files.
- Embedded code—like a `<script>` block in HTML, a fenced code block in
  Markdown, or sections of a Vue file—counts toward the host file's language.

A file counts as a test when its path matches any glob in `tests`. By default,
that covers standard conventions: `**/test/**`, `**/tests/**`,
`**/__tests__/**`, `**/spec/**`, `**/*.test.*`, `**/*.spec.*`, `**/*_test.*`,
`**/*_spec.*`, `**/test_*.py`, and `**/*Tests.cs`.

Each language becomes a single `language` entity using tokei's naming (`Rust`,
`TypeScript`, `TSX`). It records `files`, `code`, `comment`, `blank`, `lines`,
and `bytes`, along with matching counts for test files (`testFiles`, `testCode`,
…). Because all counts live on the same entity, any change in a language's
totals shows up as one modified language.

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

Globs support `*` within a folder, `**` across folders, and `?` for a single
character. Use `languages` to reassign an ambiguous extension to a language
tokei already recognizes—for example, tokei treats `.inc` as BitBake by default,
so a PHP repository can set `{"languages": {".inc": "PHP"}}`. Passing a language
name that tokei does not recognize results in an error.

```json
"inputs": {"include": ["src/**", "tests/**"], "exclude": ["**/*.generated.ts"], "tests": ["tests/**"]}
```

You can preset the [`code-statistics`](../renderers/code-statistics.md)
renderer's controls in `presentation.rendererOptions`: **Measure** (`measure`:
`code`, `comment`, `blank`, `lines`, or `files`), **By language** (`byLanguage`,
or the code/comment/blank breakdown), **Chart** (`chart`: `bars`, `share`, or
`table`, along with **Sort by** via `sort` and **Changes first** via
`sortChangesFirst`), and **Files** (`scope`: `all`, `tests`, or `other`).

## What a comparison shows

- **Added or removed languages** appear when the first file in a language is
  introduced or the last one is deleted.
- **Modified languages** update their bars in place as counts shift, showing
  lines gained and lost inside each bar alongside the signed delta.
- The summary bar tallies languages and their changes, then shows the After
  total and net delta phrased to match your active Measure and Files
  controls—for example, `11 languages +2 −1 ~8 · 39,882 lines of code +2,056` or
  `770 lines of code in tests +290`.

All comparison modes are supported. Comparisons open in Diff mode, showing each
language's Before count struck through next to its After count, and you can
switch to Side by side, Animated, or Swipe with a click.

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

- Only files that tokei recognizes by name or extension are counted. Everything
  else—including extensionless scripts identifiable only by a shebang, binary
  files, files over 8 MiB, and symlinks—is skipped rather than guessed at, with
  counts recorded in `metadata.skipped`.
- Test files are identified strictly by path globs, not by file contents or test
  framework conventions.
- Counts reflect tokei's language definitions, which are pinned per Projections
  release. Upgrading Projections to a newer tokei version can rename languages
  or shift line counts, so compare extractions generated by the same release.
- The chart displays the 24 largest languages; switch to the table view to see
  them all.

## Related

- [`code-statistics`](../renderers/code-statistics.md) is the renderer that
  draws these metrics.
- [`repository-map`](repository-map.md) displays individual files sized by bytes
  or lines inside their folders.
- [The default comparator](../comparators/default.md) can order steps so the
  largest languages appear first (`order.by: data.code`).

## How it works

See the [package README](../../../packages/extractors/code-statistics/README.md)
for how tokei counts lines and what changed from the earlier counter.

## Build your own

Consider writing a custom extractor when lines per language is not the metric
your reviewers need:

- **A different metric**, such as cyclomatic complexity, test coverage, lint
  warnings, or bundle size per package, pulled from the tools that already
  compute them.
- **A different grouping**, such as lines per team (from `CODEOWNERS`), per
  service, or per package instead of per language.
- **Content-based classification** that separates generated, vendored, or
  migrated code using markers inside the files rather than path globs.

Try the built-in options first: `include`, `exclude`, and `tests` control what
gets counted and how tests are classified, `languages` fixes ambiguous
extensions, and the renderer controls switch measures, groupings, and chart
types. If you only want a different visualization, keep this extractor and write
a custom renderer.

**In VS Code**, open the Projections view, choose **+ New Projection…**, and
select **Write a custom extractor, renderer or comparator** › **Custom
extractor** (or **Custom extractor and renderer**). Pick a language to scaffold
the definition and a starter extractor (`extract.mjs`, `extract.py`, or
`extract.go`) under `.github/projections/<id>/`, paired with the built-in graph
renderer. You can also choose **Ask an agent to write it** and describe what you
want to see.

**With the CLI**, scaffold a new extractor while keeping this chart's renderer:

```sh
projections init <id> --language node --renderer code-statistics
```

The renderer draws any `metrics/v0` entities that provide numeric `files`,
`code`, `comment`, `blank`, and `lines` fields. An extractor is any program that
prints an extraction. Run `projections show -p <id> --trust` while you
iterate—an open projection tab picks up your uncommitted edits ("Your edits")
and flags stale results, and the Testing view runs your projection's checks.
Walk through [Write your first extractor](../../guides/first-extractor.md) to
get started, and check
[Extraction schema](../../guides/schemas.md#extraction-schema) for the output
format.
