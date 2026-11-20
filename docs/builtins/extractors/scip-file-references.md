# SCIP file references

This extractor maps which files in your repository reference definitions in
other files, using a [SCIP](https://github.com/scip-code/scip) index produced by
your project's own indexer. Compared across a pull request, it shows which files
now depend on which others, and which cross-file references were added or
removed.

<!-- generated: facts -->

- ID: `scip-file-references`
- Extraction schema: [`graph/v0`](../../reference/schemas/graph.md)
- Drawn by default with: [`graph`](../renderers/graph.md)
- Needs `--trust`: When it runs ecosystem tools or repository code
  (`when-executing-tools`)
- Suggested when the repository has: `*.scip`, `**/*.scip`

<!-- end generated: facts -->

## When to use it

Use this extractor when you want to see how far a change reaches across your
codebase—for example, a module starting to import from another architectural
layer, a file split in two and who now calls each half, or a helper losing its
last external caller. Because the SCIP indexer handles language semantics rather
than Projections, it works for any language with a SCIP indexer (TypeScript and
JavaScript, Rust, Go, Python, Java and other JVM languages, C and C++, Ruby,
.NET).

Running an indexer executes project tooling, so it requires `--trust`; reading a
pre-generated index already in the revision does not. This extractor works at
the file level—for package-level graphs, see
[`workspace-dependencies`](workspace-dependencies.md) or
[`cargo-dependencies`](cargo-dependencies.md), and for package exports, see
[`typescript-public-api`](typescript-public-api.md) and its sibling API
extractors.

## What it reads

Provide a SCIP index for each revision using one of two mutually exclusive
inputs:

- **`indexer`** — the command argv to run (without a shell) in the revision or
  in `root`. Any `{output}` placeholder is replaced with a private path outside
  the revision; if you omit it, the indexer is expected to write `index.scip` in
  its working directory, which is the standard SCIP default.

  | Language               | `indexer`                                                |
  | ---------------------- | -------------------------------------------------------- |
  | TypeScript, JavaScript | `["scip-typescript", "index", "--output", "{output}"]`   |
  | Rust                   | `["rust-analyzer", "scip", ".", "--output", "{output}"]` |
  | Go                     | `["scip-go", "--output", "{output}"]`                    |
  | Python                 | `["scip-python", "index", "--output", "{output}"]`       |

  Make sure the indexer version your project uses is installed. When examining a
  revision in a temporary copy, the extractor borrows your checkout's
  `node_modules` folders during indexing so external types resolve normally;
  indexers for other ecosystems locate their caches through variables you allow
  in `execution.environment`. Because indexing often exceeds the default
  30-second limit, raise the timeout:

  ```json
  "execution": {"timeoutMs": 120000}
  ```

- **`index`** — a repository-relative `.scip` file committed in the revision
  (for example, one generated in CI). Nothing executes, though the index must
  match the revision: referencing a document that doesn't exist in that revision
  fails with an error so a stale index never misleads you.

Any use of a symbol defined in another indexed repository file (including
imports) counts as a reference. Every file that references or is referenced by
another becomes a `file` entity with a percent-encoded path ID
(`file:src%2Fapi.ts`). Each pair of files is linked by a single `references`
relationship pointing from the caller to the defining file, recording the total
number of `references`, the number of distinct symbols (`symbolCount`), and the
first 50 symbol names. Package versions are stripped from symbol strings so a
dependency bump alone doesn't churn the graph.

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

- **Added or removed files** that begin or stop participating in cross-file
  references.
- **Added or removed references** when one file starts or stops using
  definitions from another.
- **Modified references** between the same pair of files when the reference
  count or referenced symbols change.

The [`graph`](../renderers/graph.md) renderer arranges files in layers along the
reference direction and keeps unchanged files in place across transitions. The
summary bar counts files and references along with added, removed, and modified
totals without adding extra computed facts. Large graphs open at a readable zoom
level (text at least 8 px) and scroll instead of shrinking everything until it's
illegible.

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

- Only cross-file references between files inside the repository are modeled.
  Same-file references, local symbols, and references to external dependencies
  are omitted (external ones are counted in `metadata.externalReferences`). Any
  indexed documents that aren't part of the revision—such as generated or
  ignored files—are skipped and counted in `metadata.excludedDocuments`.
- Moving or renaming a file appears as a removal and an addition. Declare known
  moves in the definition's `correspondence`
  (`{"file:src%2Fnew.ts": ["file:src%2Fold.ts"]}`) to compare them as one
  change.
- Every compared revision resolves external types against the packages currently
  installed in your checkout. References within the repository itself aren't
  affected by this.
- The renderer displays up to 500 files and notes when more exist; for larger
  repositories, scope indexing to a subdirectory with `root`.
- SCIP index files are capped at 128 MiB.

## Related

- [`graph`](../renderers/graph.md) — the renderer that draws the reference
  graph.
- [`repository-map`](repository-map.md) — every file sized and nested in its
  folders, without reference edges.
- [The default comparator](../comparators/default.md) — supports ordering steps
  by incoming references (`order.by: dependents`).

## How it works

See the
[package README](../../../packages/extractors/scip-file-references/README.md)
for details on running indexers, how installed packages are exposed, and the
extraction model.

## Build your own

Consider writing a custom extractor if file-to-file references aren't the right
level of abstraction:

- **Higher-level grouping**, rolling the same SCIP data up into modules,
  packages, services, or architectural layers.
- **Extra context**, annotating files with team ownership, architectural layer,
  or flagging references that violate layer boundaries.
- **Non-SCIP sources**, for languages without a SCIP indexer or for import/call
  graphs your own tools already produce.

Check the built-in options first: `root` narrows indexing to part of a monorepo,
and `index` reads an index built by CI. If you want to highlight specific
violations (such as a UI file reaching into the database layer), add a
comparator file; if you want a different layout, keep this extractor and write a
custom renderer.

**In VS Code**, open the Projections view, select **+ New Projection…**, choose
**Write a custom extractor, renderer or comparator** › **Custom extractor** (or
**Custom extractor and renderer**), and pick a language. That creates the
definition and a starter extractor (`extract.mjs`, `extract.py`, or
`extract.go`) under `.github/projections/<id>/`, paired with the built-in graph
renderer. You can also choose **Ask an agent to write it** and describe what you
want to see.

**With the CLI**:

```sh
projections init <id> --language node
```

The starter uses the same `graph` renderer. An extractor can be any program that
prints an extraction. Test changes as you go with
`projections show -p <id> --trust`. An open projection tab picks up your
uncommitted edits ("Your edits") and flags stale results, and the Testing view
runs your projection's checks.
[Write your first extractor](../../guides/first-extractor.md) walks through a
complete example, and
[Extraction schema](../../guides/schemas.md#extraction-schema) documents the
output format.
