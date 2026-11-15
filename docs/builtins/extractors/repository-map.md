# Repository map

Every file in the repository, inside its folders, with its size in bytes (and,
when you ask, its line count). Drawn as circles packed inside circles, it
answers "where is this repository's weight, and which files and folders did this
change add, remove, grow or shrink?"

<!-- generated: facts -->

- ID: `repository-map`
- Extraction schema: [`graph/v0`](../../reference/schemas/graph.md)
- Drawn by default with: [`file-packing`](../renderers/file-packing.md)
- Needs `--trust`: No (`none`)
- Suggested when the repository has: `*`, `**/*`

<!-- end generated: facts -->

## When to use it

Use it in any repository, whatever its languages, for a picture of a change's
footprint: a new package or folder arriving, a vendored library leaving, a
generated file that doubled in size, assets committed by mistake. It reads only
the file list and file sizes, so it runs on any pull request without `--trust`,
and it is one of the two projections the CLI shows for a repository with no
definitions of its own.

It measures files, not what's in them: it can't tell a refactor from a rewrite
of the same size, or say how code depends on other code. For lines of code per
language use [`code-statistics`](code-statistics.md); for references between
files, [`scip-file-references`](scip-file-references.md).

## What it reads

- The revision's file list: tracked files and untracked files Git doesn't
  ignore. `.git` is never mapped.
- Each file's size: the size of its blob in the revision, so the same revision
  always maps the same way. A symlink is listed as a `symlink`, sized by the
  length of its target path, and never followed.
- With `lines: true`, each text file's content, to count its lines. A file with
  a NUL byte in its first 8,000 bytes is binary, as Git decides, and gets no
  line count.

Each folder is a `directory` entity and each file a `file` (or `symlink`) entity
with its `path` and `size` (and `lines`), joined by `contains` relationships.
IDs are paths (`file:src/index.ts`), so a file whose size changed is one
modified file. Folders carry no size of their own; the renderer adds up what
they hold.

## Options

<!-- generated: inputs -->

| Input     | Meaning                                                          |
| --------- | ---------------------------------------------------------------- |
| `exclude` | Array of globs to skip.                                          |
| `include` | Array of globs to map; default every file.                       |
| `lines`   | Boolean; also count the lines of each text file (default false). |

<!-- end generated: inputs -->

`include` and `exclude` are glob arrays (`*` within a folder, `**` across
folders, `?` one character) matched against repository-relative paths:

```json
"inputs": {"include": ["src/**", "docs/**"], "exclude": ["**/*.snap"], "lines": true}
```

These remove paths from the extraction itself. To keep them in the extraction
but hide them in the picture, use the
[`file-packing`](../renderers/file-packing.md) renderer's controls instead:
**Hide dependencies and build output**, **Hide lockfiles**, a toggle per
top-level folder, **Depth**, and **Size by** Bytes or Lines (offered when the
extraction counts lines). A definition presets them in
`presentation.rendererOptions`, for example
`{"hideLockfiles": true, "hideDependencies": true, "measure": "lines"}`.

## What a comparison shows

- **Files** added or removed, each with a change-colored ring (dashed when
  removed) and its status in words: `+ Added`, `− Removed`.
- **Files** modified, whose size (or line count) changed: the circle grows or
  shrinks during its step, and hovering it shows the new size and the change
  (`+1.2 KB (was 3.4 KB)`).
- **Folders** added or removed with the files in them.

The summary bar counts files and directories, and how many of each were added,
removed and modified. The renderer adds no facts of its own.

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

- A move or rename is a removed file and an added one, because IDs are paths.
  Declare known moves in the definition's `correspondence`
  (`{"file:new/path.ts": ["file:old/path.ts"]}`) to compare them as one change.
- An edit that leaves a file's size unchanged (and, with `lines`, its line
  count) isn't a change: the extraction records sizes, not content.
- Git-ignored files (installed dependencies, build output) aren't mapped.
- An extraction is limited to 10,000 files and folders. A larger repository
  fails with an error rather than a partial map; narrow it with `include` or
  `exclude`.

## Related

- [`file-packing`](../renderers/file-packing.md), which draws it.
- [`code-statistics`](code-statistics.md): lines of code by language, for the
  same repository-wide view in another measure.
- [The default comparator](../comparators/default.md), which can order steps by
  size (`order.by: data.size`).

## How it works

The [package README](../../../packages/extractors/repository-map/README.md)
covers what the extraction records for each file.

## Build your own

Write your own extractor when files and sizes aren't the measure you need:

- **Another weight**: churn, test coverage, complexity or bundle contribution
  per file, which only your tools know. Emit a `treemap/v0` hierarchy sized by
  `data.value` and the same renderer draws it.
- **Facts the file system doesn't have**: which team owns each folder (from
  `CODEOWNERS` or your own inventory), which service deploys it, or which files
  are generated.
- **Another hierarchy**: modules, services or packages instead of folders.

Try the lighter options first: `include` and `exclude` scope the map, `lines`
sizes files by lines, and the renderer's controls hide dependencies, lockfiles
and folders without changing the extraction. To draw the same files differently,
keep this extractor and write a renderer.

**In VS Code**, choose **+ New Projection…** in the Projections view, then
**Write a custom extractor, renderer or comparator** › **Custom extractor** (or
**Custom extractor and renderer**), and pick its language. It writes the
definition and a starter extractor (`extract.mjs`, `extract.py` or `extract.go`)
under `.github/projections/<id>/`, drawn by the built-in graph renderer. Or
choose **Ask an agent to write it** and describe what the projection should
show.

**With the CLI**, keep this map's renderer:

```sh
projections init <id> --language node --renderer file-packing
```

An extractor is any program that prints an extraction. Run it with
`projections show -p <id> --trust` as you change it; an open projection tab uses
your uncommitted edits ("Your edits") and says when its results are out of date,
and the Testing view runs the projection's checks.
[Write your first extractor](../../guides/first-extractor.md) walks through one,
and [Extraction schema](../../guides/schemas.md#extraction-schema) describes
what it prints.
