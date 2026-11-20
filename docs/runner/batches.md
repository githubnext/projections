# Batch runs and saved documents

## Batch runs and saved scenarios

When you want to run every projection in a repository at once, use
`show --all [REVISION]` or `compare --all <BASE>[..<HEAD>]`. Results come back
ordered by ID, with either the extraction or comparison result or explicit
per-item diagnostics (failed items still include their `definition` whenever it
resolved).

Each item gets a status of `extracted`, `changed`, `unchanged`, or `error`. For
`compare --all`, an item can also be `head-only` (or `base-only` when using
`--definition head`): if the definition revision doesn't define a projection,
that projection is shown on the other revision alone with its own definition and
a notice rather than being compared. A compared item is `changed` if and only if
it has a reviewable change—one whose content (`added`, `removed`, `modified`) or
identity (`declared`, `split`, `merge`) changed; expected variation alone
(`unchanged` with `varied`) leaves it `unchanged`. It also carries the engine's
counts in `review`: `{reviewable, content, identity, variation}` (see the
engine's [`review`](../contracts.md#one-implementation-native-and-browser)).

Individual failures—such as unknown selected IDs, trust denials, or tool
errors—never discard successful siblings. The CLI writes the complete bounded
result first and then exits with a nonzero status if any item failed. By
contrast, invalid authored definitions, duplicate selected IDs, and cancellation
fail the entire operation, and aborting stops any remaining work. Each item that
needs a materialized copy gets its own.

If a revision has no authored definitions at all, the CLI falls back to the
read-only built-in defaults: `repository-map` (which uses the `file-packing`
renderer to draw files as circles sized by byte count, inspired by GitHub Next's
2021 Repo Visualization) and `workspace-dependencies` (included only when the
revision has a root `package.json`). The engine itself does not own a built-in
catalog. Malformed definition files never trigger this fallback, and single
operations follow the same explicit trust rules.

To inspect what a revision defines without running any extractors, run
`list [--revision REF] [--json]`. It reads only the definition directories and
prints
`{"format": "projections.list", "version": 0, "revision", "projections": [{"id", "title", "renderer", "requiresTrust", "rendererRequiresTrust", "definition"}]}`.
Here `requiresTrust` indicates that the extractor runs repository code, while
`rendererRequiresTrust` means the custom renderer differs from the bundle at the
revision's merge base with the default branch (`refs/remotes/origin/HEAD`), or
that there is no default branch to compare against (see
[trust](../contracts.md#trust)). The Inspector reports the same policy.

You can also save reusable comparison scenarios in `.projections-bookmarks.json`
at the project root (not inside a definition directory):

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

Omitting `after` defaults it to `working-tree`. Explicit refs are resolved
through Git at run time, and the resulting artifacts record immutable commits
and the actual dirty state. Use `bookmark list --json` to print the strict
versioned document, and `bookmark run [ID]...` to run selected scenarios from
the working tree's file with per-item failure reporting.

Each bookmark uses its base revision's definition—or, if neither revision
defines the projection, falls back to the working tree's definition alongside
the bookmarks file with a notice. You can override that choice explicitly with
`--definition base|head` or `--definition-revision REV`. Up to 100 bookmarks are
supported. A missing bookmarks file is treated as an empty set, while malformed,
duplicated, or symlinked configurations fail explicitly.

## Saved documents

You can save extractions to disk, validate them, and compare them later without
re-running extractors:

```sh
projections show HEAD -p services --trust --output /tmp/services.extraction.json
projections validate /tmp/services.extraction.json
projections compare --before-extraction /tmp/before.json --after-extraction /tmp/after.json
```

To produce extractions that can be compared later, extract every revision with
the same definition:
`projections show HEAD -p services --definition-revision MERGE_BASE`. The
`--output` flag always writes a **new** file and refuses to overwrite an
existing one. Saved extractions are capped at 16 MiB and saved comparisons at 32
MiB.

When reading saved documents, the CLI validates strict raw JSON through the
native engine—checking extraction metadata, the definition, immutable
provenance, and extraction digests—and rejects symlinks and special files. Saved
comparisons are recomputed by their comparator (whose module digest they record)
so tampered change claims are rejected, and any two compared extractions must
share the same `definitionDigest`. To publish projections from CI, use the
GitHub Action and its
[artifact contract](../contracts/saved-documents.md#ci-artifacts) (see the
[CI example](../../examples/ci/README.md)); claims inside a document never grant
GitHub authorization.
