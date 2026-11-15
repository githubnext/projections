---
description: Which files refer to which, from a SCIP index (graph/v0)
---

# SCIP file references — `graph/v0`

`scip-file-references` answers: **which files refer to definitions in other
files, and how does that change between revisions?** It reads a
[SCIP](https://github.com/scip-code/scip) index, which by default it produces at
each revision by running the project's own SCIP indexer.

SCIP replaces LSIF, which this extractor read in earlier versions
(`lsif-file-references`). LSIF is obsolete: its major indexers moved to SCIP,
and SCIP indexers exist for TypeScript and JavaScript, Rust, Go, Python, Java
and other JVM languages, C and C++, Ruby and .NET.

## Running the project's indexer

Name the indexer the project already uses as an argv. `{output}` is replaced
with a private path outside the revision where the indexer writes its index:

```json
{
  "id": "impact",
  "title": "Cross-file references",
  "extractor": "scip-file-references",
  "renderer": "graph",
  "inputs": { "indexer": ["scip-typescript", "index", "--output", "{output}"] },
  "execution": { "timeoutMs": 120000 }
}
```

| Indexer                | `inputs.indexer`                                         |
| ---------------------- | -------------------------------------------------------- |
| TypeScript, JavaScript | `["scip-typescript", "index", "--output", "{output}"]`   |
| Rust                   | `["rust-analyzer", "scip", ".", "--output", "{output}"]` |
| Go                     | `["scip-go", "--output", "{output}"]`                    |
| Python                 | `["scip-python", "index", "--output", "{output}"]`       |

Without `{output}`, the indexer must write `index.scip` in its working
directory, which is where SCIP indexers write by default, so
`["rust-analyzer", "scip", "."]` also works. The extractor reads that file and
removes it. If the revision already contains an `index.scip` there, extraction
fails rather than reading a file the indexer may not have written.

Running an indexer runs project tooling, which can load the project's
configuration, compile code or resolve dependencies, so it **requires
`--trust`**. The indexer runs without a shell in the revision (or
`inputs.root`), within the definition's `execution.timeoutMs`, with only the
environment `execution.environment` allows. Indexers are the project's own
tools: install the version the project uses, as its own build does.

### Installed packages

A materialized revision omits ignored files such as `node_modules`. While the
indexer runs, every `node_modules` directory installed in the repository
checkout is linked into the revision at the same relative path (for each
directory the revision has), so the indexer resolves external types the way it
would in the checkout, as the [Node helper](../typescript-support/README.md)
resolves the project's own packages there. The links are removed when the
indexer exits. This has limits:

- One installation serves every compared revision. If a revision changes the
  project's dependencies, its external types still come from the packages the
  checkout has installed.
- Nothing is linked for a revision that is the checkout itself, or where the
  revision already has a `node_modules` path.
- Only `node_modules` is linked. Other ecosystems' indexers resolve dependencies
  from their own caches outside the repository (`CARGO_HOME`, `GOMODCACHE`, a
  Python environment); grant them through `execution.environment`.
- The links point into the checkout, so an indexer that writes into installed
  packages writes into the checkout's copies.

References to definitions inside the repository never depend on installed
packages; only external references (counted in `metadata.externalReferences`)
do.

## Reading an existing index

`inputs.index` reads a SCIP index file committed to the revision, such as one
generated in CI, instead of running an indexer. Reading executes nothing and
does not require `--trust`. The index must match the revision: a document absent
from the revision is an error, because a stale index explains the wrong code.

| Key       | Meaning                                                                                                          |
| --------- | ---------------------------------------------------------------------------------------------------------------- |
| `indexer` | Indexer argv run at each revision. Requires `--trust`.                                                           |
| `index`   | Repository-relative index to read instead. Exactly one of `indexer` and `index` is required.                     |
| `root`    | Repository-relative directory the indexer runs in and the index's document paths are relative to. Default `"."`. |

Indexes are limited to 128 MiB and parsed with the
[`scip`](https://crates.io/crates/scip) crate, the SCIP project's own Rust
bindings (Apache-2.0).

## Model

File entities, `file:<path>`, for every file that refers to or is referred to
from another file, with repository-relative path identities. A `references`
relationship from the referring file to the defining file records:

<!-- prettier-ignore -->
| `data` field | Meaning |
|---|---|
| `references` | Distinct reference occurrences (position and symbol). |
| `symbolCount` | The number of distinct SCIP symbols referred to. |
| `symbols` | Those symbols, without their package version, sorted; at most the first 50, so an extraction stays bounded however many symbols one file uses from another. |

A reference is an occurrence of a global symbol without the `Definition` or
`ForwardDefinition` role; its targets are the files with a `Definition`
occurrence of the same symbol. Imports count as references. Symbols omit the
package version so a version bump alone doesn't change the graph; adding or
removing a reference, or referring to a different symbol, does. Evidence records
up to 25 representative reference locations per relationship; positions never
affect identity. A file move **is** meaningful to this physical-file view; use
the standard correspondence mechanism to pair file identities across a rename.

Only **in-repository, cross-file** references are represented. Same-file
references, local symbols, and references to symbols defined outside the indexed
repository files are not modeled; `metadata.externalReferences` counts the last.
When the extractor runs the indexer, documents that are not files of the
revision (generated or ignored files) are excluded and counted in
`metadata.excludedDocuments`. `metadata.tool` names the indexer and version the
index records.

## Tests

`tests/references.rs` builds indexes with the `scip` bindings and runs a
stand-in indexer process. `tests/fixtures/scip-typescript` holds a small
TypeScript project and the `index.scip` that `scip-typescript index` 0.6.1 wrote
for it, which the CLI's collector tests read. The opt-in native suite runs a
real `scip-typescript` at two revisions:

```sh
PROJECTIONS_NATIVE_ECOSYSTEMS=1 PROJECTIONS_SCIP_TYPESCRIPT=/path/to/scip-typescript \
cargo test -p projections-cli --test native_tools native_scip
```
