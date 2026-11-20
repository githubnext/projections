# Repository map

This extractor maps every file in your repository inside its folder hierarchy,
weighted by byte size (and optionally line count). Drawn as nested circles, it
lets you see where the repository's weight lives—and across a pull request,
which files and folders were added, removed, grew, or shrank.

<!-- generated: facts -->

- ID: `repository-map`
- Extraction schema: [`graph/v0`](../../reference/schemas/graph.md)
- Drawn by default with: [`file-packing`](../renderers/file-packing.md)
- Needs `--trust`: No (`none`)
- Suggested when the repository has: `*`, `**/*`

<!-- end generated: facts -->

## When to use it

Use this extractor in any repository, regardless of language, to get a quick
visual sense of a change's footprint: a new package or folder landing, a
vendored library being removed, a generated file doubling in size, or large
assets committed by mistake. Because it only inspects file paths and sizes, it
runs on any pull request without `--trust`—and it is one of the two default
projections the CLI offers when a repository has no definitions yet.

It only measures file sizes, not code semantics, so it won't distinguish a
refactor from a same-sized rewrite or show how files depend on one another. For
lines of code broken down by language, use
[`code-statistics`](code-statistics.md); for cross-file references, use
[`scip-file-references`](scip-file-references.md).

## What it reads

- **The file list** for the revision: all tracked files plus untracked files
  that Git doesn't ignore. `.git` is always excluded.
- **File sizes**, read from each file's blob in that revision so results are
  deterministic. Symlinks are recorded as `symlink` entities sized by their
  target path length and are never followed.
- **Line counts** when `lines: true` is set. Any file with a NUL byte in its
  first 8,000 bytes is treated as binary (matching Git's heuristic) and skips
  line counting.

Each folder becomes a `directory` entity and each file becomes a `file` (or
`symlink`) entity carrying its `path`, `size`, and optional `lines`, linked by
`contains` relationships. Because IDs are based on paths (`file:src/index.ts`),
a file whose size changes shows up as a single modified file. Folders don't
store their own size; the renderer sums their contents.

## Options

<!-- generated: inputs -->

| Input     | Meaning                                                          |
| --------- | ---------------------------------------------------------------- |
| `exclude` | Array of globs to skip.                                          |
| `include` | Array of globs to map; default every file.                       |
| `lines`   | Boolean; also count the lines of each text file (default false). |

<!-- end generated: inputs -->

Both `include` and `exclude` accept glob arrays (`*` within a folder, `**`
across folders, `?` for a single character) matched against repository-relative
paths:

```json
"inputs": {"include": ["src/**", "docs/**"], "exclude": ["**/*.snap"], "lines": true}
```

Those filters drop paths from the extraction altogether. If you'd rather keep
them in the data and toggle visibility in the UI, use the
[`file-packing`](../renderers/file-packing.md) renderer's built-in controls:
**Hide dependencies and build output**, **Hide lockfiles**, per-folder toggles,
**Depth**, and **Size by** (Bytes or Lines, when line counts are enabled). You
can preset those in `presentation.rendererOptions`, for example
`{"hideLockfiles": true, "hideDependencies": true, "measure": "lines"}`.

## What a comparison shows

- **Added or removed files**, marked with a colored ring (dashed for removals)
  and a status label (`+ Added`, `− Removed`).
- **Modified files** whose size or line count changed: the circle grows or
  shrinks during the transition, and hovering reveals the new size and delta
  (`+1.2 KB (was 3.4 KB)`).
- **Added or removed folders** along with the files inside them.

The summary bar counts total files and directories alongside how many were
added, removed, or modified. The renderer doesn't add any extra computed facts.

## Start from this definition

<!-- generated: definition -->

```json
{
  "extractor": "repository-map",
  "id": "repository-map",
  "renderer": "file-packing",
  "title": "Repository map"
}
```

<!-- end generated: definition -->

## Limitations

- Because IDs are file paths, moving or renaming a file shows up as a removal
  and an addition. You can declare known moves in the definition's
  `correspondence` (`{"file:new/path.ts": ["file:old/path.ts"]}`) to track them
  as a single change.
- Edits that leave a file's byte size (and line count, if `lines` is enabled)
  identical won't show up as changes, since the extractor doesn't compare file
  contents.
- Git-ignored files (like installed dependencies or build output) aren't
  included.
- Extractions cap out at 10,000 files and folders. Larger repositories fail with
  an error rather than showing a partial map; use `include` or `exclude` to
  narrow the scope.

## Related

- [`file-packing`](../renderers/file-packing.md) — the renderer that draws the
  nested circles.
- [`code-statistics`](code-statistics.md) — lines of code by language for a
  different repository-wide view.
- [The default comparator](../comparators/default.md) — supports ordering steps
  by size (`order.by: data.size`).

## How it works

See the [package README](../../../packages/extractors/repository-map/README.md)
for details on what the extractor records for each file.

## Build your own

Consider writing a custom extractor when file sizes aren't the metric you want:

- **Different weights**, such as Git churn, test coverage, complexity, or bundle
  size per file. Emit a `treemap/v0` hierarchy weighted by `data.value` and the
  same renderer will draw it.
- **Metadata outside the filesystem**, like team ownership from `CODEOWNERS` or
  an internal inventory, deploying service, or generated-file markers.
- **A different grouping**, organizing by modules, services, or packages instead
  of directories.

Check whether the built-in options already do what you need first: `include` and
`exclude` narrow the map, `lines` switches to line counts, and the renderer's
controls hide dependencies, lockfiles, and folders without touching the
extraction. If you want to visualize the same file data differently, keep this
extractor and write a custom renderer.

**In VS Code**, open the Projections view, select **+ New Projection…**, choose
**Write a custom extractor, renderer or comparator** › **Custom extractor** (or
**Custom extractor and renderer**), and pick a language. That creates the
definition and a starter extractor (`extract.mjs`, `extract.py`, or
`extract.go`) under `.github/projections/<id>/`, paired with the built-in graph
renderer. You can also choose **Ask an agent to write it** and describe what you
want to see.

**With the CLI**, keep the `file-packing` renderer:

```sh
projections init <id> --language node --renderer file-packing
```

An extractor can be any program that prints an extraction. Test your changes as
you go with `projections show -p <id> --trust`. An open projection tab picks up
your uncommitted edits ("Your edits") and tells you when results are stale, and
the Testing view runs your projection's checks.
[Write your first extractor](../../guides/first-extractor.md) walks through a
complete example, and
[Extraction schema](../../guides/schemas.md#extraction-schema) documents the
output format.
