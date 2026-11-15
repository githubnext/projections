---
description: Files and lines per language, via tokei (metrics/v0)
---

# Code statistics — `metrics/v0`

`code-statistics` counts physical files and lines for every language
[tokei](https://github.com/XAMPPRocky/tokei) recognizes in the repository at a
commit, and splits each language's counts into test and other files. It is a
**pure** extractor: it reads the checked out files the runtime already lists,
executes nothing, and therefore never requires `--trust`.

Unlike the other extractors, this one does not claim to model a design. It
reports a measurement, and its value is that the measurement is comparable
across two commits: the
[`code-statistics` renderer](../../renderers/code-statistics/README.md) draws
the quantity gained or lost per language as a green or red band and animates the
bar through it as the states morph.

Measure, language/composition grouping and bars/share display are selected once
in the comparison toolbar and apply to both revisions, including when switching
between Side by side, Animated and Swipe. Each revision keeps its own totals.
Grouping and chart choices use the same small segmented control as the
comparison modes, including selected, focus, and theme styling. Standalone React
SDK users can pass `statisticsOptions` to the renderer and use
`CodeStatisticsControls` in their host toolbar; omitting those options retains
the renderer's self-contained controls.

## Inputs

<!-- prettier-ignore -->
| Key | Meaning |
|---|---|
| `include` | Array of globs. When present, only matching paths are considered. Default: every file. |
| `exclude` | Array of globs skipped **in addition to** the defaults below. |
| `defaultExcludes` | Set `false` to count dependency, output and lockfile paths too. Default `true`. |
| `languages` | Map of file extension (including the leading `.`) to a [tokei language](https://github.com/XAMPPRocky/tokei/blob/master/languages.json) name, for repositories that use a nonstandard or ambiguous extension. |
| `tests` | Array of globs that classify a counted file as a test. Default: the [test conventions](#test-files) below. `[]` classifies nothing as a test. |

Globs use the runtime's shared syntax: `**/` matches any number of directory
segments, `*` matches within one segment, and `?` matches one character. Paths
are repository-relative and POSIX-separated.

`languages` only _reassigns_ an extension to a language tokei already knows how
to read; naming an unknown language is a configuration error rather than a
silent fallback. Names match tokei's display names case-insensitively (`PHP`,
`C++`, `Objective-C`). It is the escape hatch for genuinely ambiguous
extensions: tokei counts `.m` as Objective-C and `.inc` as BitBake, so a PHP
repository sets `{ "languages": { ".inc": "PHP" } }`.

```json
{
  "id": "code-statistics",
  "extractor": "code-statistics",
  "renderer": "code-statistics",
  "inputs": {
    "include": ["src/**", "tests/**"],
    "exclude": ["**/*.generated.ts"],
    "tests": ["tests/**", "**/*.test.ts"]
  }
}
```

### Default excludes

`node_modules`, `.git`, `dist`, `build`, `out`, `bin`, `obj`, `target`,
`vendor`, `__pycache__`, `.venv`, `venv`, `coverage`, `.next`, `.nuxt`, the
projections caches, `*.min.js`, `*.min.css`, `*.lock` and `package-lock.json`.
These are excluded because a vendored dependency tree or a lockfile dominates
every count and drowns out the repository's own movement.

### Test files

A counted file is a test when its path matches any `tests` glob. The defaults
cover common conventions across ecosystems: `**/test/**`, `**/tests/**`,
`**/__tests__/**`, `**/spec/**`, `**/*.test.*`, `**/*.spec.*`, `**/*_test.*`
(Go, Elixir), `**/*_spec.*` (Ruby), `**/test_*.py` (pytest) and `**/*Tests.cs`
(.NET). The classification is by path only; it does not inspect file contents or
run a test framework. Test lines are a subset of each language's totals, so
`code - testCode` is the language's non-test code.

## Counting

Languages and line classification come from
[tokei](https://github.com/XAMPPRocky/tokei) (MIT OR Apache-2.0), used as a
library and pinned to one exact release (`metadata.counter`). Its maintained
language definitions decide which files are recognized and how their comments,
strings and embedded languages are read. Upgrading tokei is a deliberate change
to the measurement, because counts are only comparable when both revisions were
measured by the same definitions.

tokei is used with its default features off, but its library still depends on
crates its command line uses, among them `table_formatter`, which brings in
`colored` (MPL-2.0); their notices ship in the CLI's `THIRD_PARTY_NOTICES.txt`.
A tokei feature that makes those dependencies optional would be a welcome
upstream change, shrinking the CLI and its dependency tree.

- Every **physical** line is classified as exactly one of code, comment or
  blank, so the three always sum to the total.
- A line carrying **both code and a comment counts as code**.
- String literals are tracked so that a comment marker inside one is not counted
  as a comment.
- Documentation strings (Python docstrings and similar) that span lines count as
  comments.
- Code embedded in another language (a fenced block in Markdown, a `<script>` in
  HTML, the sections of a Vue file) counts toward its **host file's** language.
- Literate formats (Markdown, plain text) count their prose as comments.

## Model

One entity per language, `id: language:<Name>`, `kind: language`, where `<Name>`
is tokei's display name. There are no relationships — languages have no
relationships to assert.

<!-- prettier-ignore -->
| `data` field | Meaning |
|---|---|
| `language` | The language name. |
| `files` | Files counted. |
| `code`, `comment`, `blank` | Lines of each kind. |
| `lines` | `code + comment + blank`. |
| `bytes` | Total bytes read. |
| `testFiles`, `testCode`, `testComment`, `testBlank`, `testLines` | The same measurements for the files classified as tests, included in the totals above. |
| `value`, `unit` | The `metrics/v0` headline measurement, mirroring `code`. |

Every measurement lives on one entity rather than being split into a entity per
metric, so the renderer can pivot between measures without changing identity —
and so a language whose line counts moved reports as `modified` rather than as a
removal paired with an addition. The
[`code-statistics` renderer](../../renderers/code-statistics/README.md) reads
`files`, `code`, `comment`, `blank` and `lines`; the test fields are available
to tables, comparator ordering (`order.by: "data.testCode"`) and custom
renderers.

`confidence` is `derived`: the counts are computed from the file contents.
Evidence lists the counted paths, capped at 25 per language; evidence is
stripped before states are compared, so the cap cannot affect a diff.

## Skipped files

A file tokei does not recognize by filename or extension is **not counted at
all**. The extractor never guesses a language, because an inferred count is
indistinguishable from a measured one once it reaches the chart. Files are also
skipped when they contain a NUL byte in the first 8000 bytes (binary), exceed 8
MiB, or cannot be read — including anything reached through a symlink, which the
shared path resolver rejects.

Every skip is tallied in collection `metadata.skipped` as `unrecognized`,
`binary`, `oversize` and `unreadable`, so an unexpectedly small count is
explainable. Metadata does not participate in canonicalization, so these tallies
cannot make an otherwise unchanged state compare as changed.

## Differences from the earlier built-in counter

Earlier versions used a hand-maintained table of about 40 languages and a
home-grown line classifier. Moving to tokei changes these results:

- **Many more languages are counted**, including Markdown, plain text, JSON,
  CSS, HTML, SVG and XML, which the earlier table skipped as unrecognized.
  Exclude them with `exclude` if they are noise for a repository.
- **Some language names changed**, which changes their entity IDs:
  `TypeScript JSX` is now `TSX`, `JavaScript JSX` is `JSX`, and `Terraform`
  (`.tf`) is `HCL`. Shell scripts are split by dialect (`Shell`, `BASH`, `Zsh`).
  Extract both revisions with the same release before comparing them.
- **Extensionless scripts recognized only by a shebang are not counted.** tokei
  probes shebangs by opening files itself, which would bypass the runner's
  no-follow reader; filenames such as `Makefile` and `Dockerfile` are still
  recognized.
- **Classification follows tokei's rules**: for example, a single-line Python
  docstring counts as code, and multi-line strings are tracked across lines.

## Tests

`tests/golden.rs` extracts the fixture repositories under `tests/fixtures/`
(Rust, Python, TypeScript, TSX, Go, Markdown with an embedded block, HTML with a
script, shell, Make, Docker, a BOM and CRLF file, binary, unrecognized and
excluded files, and an options case) and compares them with the checked-in
`expected.json` files. After an intentional change, regenerate them with
`PROJECTIONS_UPDATE_GOLDEN=1 cargo test -p projections-extractor-code-statistics`
and review the diff.
