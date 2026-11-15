# SCIP file references

Which files in the repository refer to definitions in other files, read from a
[SCIP](https://github.com/scip-code/scip) index that the project's own indexer
produces. Compared across a pull request, it answers "which files now depend on
which others, and which cross-file references did this change add or remove?"

<!-- generated: facts -->

- ID: `scip-file-references`
- Extraction schema: [`graph/v0`](../../reference/schemas/graph.md)
- Drawn by default with: [`graph`](../renderers/graph.md)
- Needs `--trust`: When it runs ecosystem tools or repository code
  (`when-executing-tools`)
- Suggested when the repository has: `*.scip`, `**/*.scip`

<!-- end generated: facts -->

## When to use it

Use it to review a change's reach in code: a module that starts importing from
another layer, a file split in two and who now refers to each half, a helper
whose last caller in another file went away. It is language-agnostic: it works
wherever a SCIP indexer does (TypeScript and JavaScript, Rust, Go, Python, Java
and other JVM languages, C and C++, Ruby, .NET), because the indexer, not
Projections, understands the language.

Running the indexer runs project tooling, so it needs `--trust`; reading an
index the revision already contains doesn't. It works at the grain of files; for
a package-level graph use [`workspace-dependencies`](workspace-dependencies.md)
or [`cargo-dependencies`](cargo-dependencies.md), and for what a package
exports, [`typescript-public-api`](typescript-public-api.md) and its siblings.

## What it reads

A SCIP index of the revision, from one of two sources (set exactly one):

- **`indexer`**: the indexer's argv, run without a shell in the revision (or in
  `root`) at each revision you compare. `{output}` in it is replaced with a
  private path outside the revision; without it, the indexer must write
  `index.scip` in its working directory, as SCIP indexers do by default.

  | Language               | `indexer`                                                |
  | ---------------------- | -------------------------------------------------------- |
  | TypeScript, JavaScript | `["scip-typescript", "index", "--output", "{output}"]`   |
  | Rust                   | `["rust-analyzer", "scip", ".", "--output", "{output}"]` |
  | Go                     | `["scip-go", "--output", "{output}"]`                    |
  | Python                 | `["scip-python", "index", "--output", "{output}"]`       |

  Install the indexer version the project uses. A revision examined in a copy
  borrows the `node_modules` folders installed in your checkout while the
  indexer runs, so external types resolve as they do there; other ecosystems'
  indexers find dependencies in their own caches, which the definition grants
  through `execution.environment`. Indexing usually takes longer than the
  default 30-second timeout:

  ```json
  "execution": {"timeoutMs": 120000}
  ```

- **`index`**: a repository-relative `.scip` file in the revision, such as one
  CI generated. It runs nothing, but the index must match the revision: a
  document the revision doesn't have is an error, because a stale index explains
  the wrong code.

A reference is a use of a symbol defined in another indexed file of the
repository; imports count. Each file that refers to or is referred to from
another file is a `file` entity, its ID the percent-encoded path
(`file:src%2Fapi.ts`). Each pair of files is one `references` relationship from
the referring file to the defining one, with how many distinct `references` it
makes, how many distinct symbols (`symbolCount`), and the first 50 of those
symbols. Symbols leave out their package version, so upgrading a dependency
alone doesn't change the graph.

## Options

<!-- generated: inputs -->
<!-- prettier-ignore -->
| Input | Meaning |
|---|---|
| `index` | Repository-relative SCIP index to read instead of running an indexer; it must match the revision. |
| `indexer` | SCIP indexer argv run at each revision, such as ["scip-typescript","index","--output","{output}"]; {output} names a private index path, otherwise the indexer writes index.scip in its working directory. Requires --trust. |
| `root` | Repository-relative directory the indexer runs in and the index's document paths are relative to; default ".". |

<!-- end generated: inputs -->

## What a comparison shows

- **Files** added or removed: a file that starts or stops referring to, or being
  referred to from, another file.
- **References** added or removed: a file that starts or stops using definitions
  from another.
- **References** modified: the same two files, with more or fewer references or
  different symbols.

The [`graph`](../renderers/graph.md) renderer lays the files out in layers along
the references and keeps survivors in place through the change. Its summary bar
counts files and references, and how many of each were added, removed and
modified; it adds no facts of its own. A large graph opens at a readable size
(text no smaller than 8 px) and scrolls, rather than fitting everything at a
size nobody can read.

## Start from this definition

<!-- generated: definition -->

```json
{
  "extractor": "scip-file-references",
  "id": "scip-file-references",
  "inputs": {
    "indexer": [
      "scip-typescript",
      "index",
      "--output",
      "{output}"
    ]
  },
  "renderer": "graph",
  "title": "SCIP file references"
}
```

<!-- end generated: definition -->

## Limitations

- Only cross-file references between files of the repository are modeled.
  References within a file, local symbols and references to dependencies aren't
  (the extraction's `metadata.externalReferences` counts the last), and
  documents the indexer reports that aren't files of the revision (generated or
  ignored files) are left out and counted in `metadata.excludedDocuments`.
- A moved or renamed file is a removed file and an added one. Declare known
  moves in the definition's `correspondence`
  (`{"file:src%2Fnew.ts": ["file:src%2Fold.ts"]}`) to compare them as one
  change.
- The installed packages the indexer sees are your checkout's, for every
  revision compared, so a revision that changes dependencies resolves external
  types against the checkout's versions. References inside the repository don't
  depend on them.
- The renderer draws at most 500 files, and says so; for a larger repository,
  index a part of it with `root`.
- Indexes are limited to 128 MiB.

## Related

- [`graph`](../renderers/graph.md), which draws it.
- [`repository-map`](repository-map.md): every file, sized and placed in its
  folders, without the references between them.
- [The default comparator](../comparators/default.md), which can order steps by
  how many files refer to each (`order.by: dependents`).

## How it works

The
[package README](../../../packages/extractors/scip-file-references/README.md)
covers running indexers, the installed packages they see, and the model.

## Build your own

Write your own extractor when file-to-file references aren't the structure you
need to see:

- **Another grain**: modules, packages, services or architectural layers instead
  of files, by grouping the same SCIP data under your own names.
- **Facts the index doesn't have**: which team owns each file, which layer it
  belongs to, or which references cross a boundary your architecture forbids.
- **No SCIP indexer**: a language without one, or references your own tools
  already compute (an import graph, a call graph).

Try the lighter options first: `root` indexes one part of a monorepo, and
`index` reads an index your CI already produces. To draw the same graph
differently, keep this extractor and write a renderer; to flag references that
matter (a UI file reaching into the database layer), add a comparator file.

**In VS Code**, choose **+ New Projection…** in the Projections view, then
**Write a custom extractor, renderer or comparator** › **Custom extractor** (or
**Custom extractor and renderer**), and pick its language. It writes the
definition and a starter extractor (`extract.mjs`, `extract.py` or `extract.go`)
under `.github/projections/<id>/`, drawn by the built-in graph renderer. Or
choose **Ask an agent to write it** and describe what the projection should
show.

**With the CLI**:

```sh
projections init <id> --language node
```

The starter is drawn by the same `graph` renderer. An extractor is any program
that prints an extraction. Run it with `projections show -p <id> --trust` as you
change it; an open projection tab uses your uncommitted edits ("Your edits") and
says when its results are out of date, and the Testing view runs the
projection's checks.
[Write your first extractor](../../guides/first-extractor.md) walks through one,
and [Extraction schema](../../guides/schemas.md#extraction-schema) describes
what it prints.
