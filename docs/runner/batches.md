# Batch runs and saved documents

## Batch runs and saved scenarios

`show --all [REVISION]` and `compare --all <BASE>[..<HEAD>]` run every
discovered projection. Results are ordered by ID and contain an
extraction/comparison or explicit per-item diagnostics; an error item includes
the `definition` whenever it resolved. Item statuses are `extracted`, `changed`,
`unchanged`, `error`, and for `compare --all`, `head-only` (or `base-only` with
`--definition head`): a projection the definition revision doesn't define is
shown at the other revision alone, with that revision's definition and a notice,
rather than compared. A compared item is `changed` exactly when it has a
reviewable change, one whose content (`added`, `removed`, `modified`) or
identity (`declared`, `split`, `merge`) changed; expected variation alone
(`unchanged` with `varied`) leaves it `unchanged`. It carries the engine's
counts in `review`: `{reviewable, content, identity, variation}` (see the
engine's [`review`](../contracts.md#one-implementation-native-and-browser)).
Unknown selected IDs, trust denial and tool failures do not discard successful
siblings. The CLI writes the complete bounded result then exits unsuccessfully
if any item failed. Invalid authored definitions, duplicate selected IDs and
cancellation fail the operation itself; abort stops further execution. Each item
that needs a copy receives its own.

The CLI explicitly injects the read-only `repository-map` and
`workspace-dependencies` defaults only when a revision has no authored
definitions (`repository-map` is presented by the `file-packing` renderer, files
as circles sized by their bytes, inspired by GitHub Next's 2021 Repo
Visualization), and `workspace-dependencies` only when the revision has a root
`package.json`; the engine does not own a builtin catalog. Malformed files never
trigger a fallback. Single operations keep the same explicit trust rules.

`list [--revision REF] [--json]` prints
`{"format": "projections.list", "version": 0, "revision", "projections": [{"id", "title", "renderer", "requiresTrust", "rendererRequiresTrust", "definition"}]}`
after reading only the definition directories. `requiresTrust` means the
extractor runs repository code. `rendererRequiresTrust` means the custom
renderer differs from the bundle at the revision's merge base with the default
branch (`refs/remotes/origin/HEAD`), or there is no default branch to compare
with; see [trust](../contracts.md#trust). The Inspector reports the same policy.

Save scenarios in the root `.projections-bookmarks.json`, not in a definition
directory:

```json
{
  "format": "projections.bookmarks",
  "version": 0,
  "bookmarks": [
    {"id": "working", "title": "Working changes", "projectionId": "files", "before": "HEAD"},
    {"id": "release", "title": "Release", "projectionId": "files", "before": "v1", "after": "v2"}
  ]
}
```

Omitted `after` means `working-tree`; explicit refs resolve through Git at run
time and artifacts record immutable commits/actual dirty state.
`bookmark list --json` prints the strict versioned document;
`bookmark run [ID]...` executes selected scenarios (from the working tree's
file) with per-item failures. Each applies its base revision's definition, or
the working tree's (beside the bookmarks file) when neither of its revisions
defines the projection, with a notice; `--definition base|head` and
`--definition-revision REV` choose one explicitly. At most 100 items are
supported. Missing bookmarks is an empty set; malformed, duplicated or symlinked
configuration fails explicitly.

## Saved documents

```sh
projections show HEAD -p services --trust --output /tmp/services.extraction.json
projections validate /tmp/services.extraction.json
projections compare --before-extraction /tmp/before.json --after-extraction /tmp/after.json
```

To save extractions that can be compared, extract every revision with one
definition:
`projections show HEAD -p services --definition-revision MERGE_BASE`. `--output`
writes a **new** file and never overwrites one. Saved extractions are limited to
16 MiB and saved comparisons to 32 MiB.

Reading validates strict raw JSON through the native engine, extraction
metadata, definition, immutable provenance and extraction digests, and refuses
symlinks and special files. Saved comparisons are recomputed by their
comparator, whose module digest they record, and reject tampered change claims;
compared extractions must share a `definitionDigest`. To publish projections
from CI, use the GitHub Action and its
[artifact contract](../contracts/saved-documents.md#ci-artifacts) (see the
[CI example](../../examples/ci/README.md)); a document's claims never grant
GitHub authorization.
