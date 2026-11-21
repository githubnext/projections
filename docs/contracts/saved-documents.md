# Saved extractions and CI artifacts

## Saved extractions

When the runner persists an extraction to disk or an artifact, it wraps the raw
extraction in a saved document with `format: "projections.extraction"` and
`version: 0`:

```json
{
  "format": "projections.extraction", "version": 0,
  "projection": {"id": "...", "title": "...", "renderer": "graph"},
  "extraction": {},
  "provenance": {
    "revision": {"kind": "commit", "ref": "<sha>", "commit": "<sha>", "dirty": false},
    "extractor": {"id": "...", "version": "..."},
    "definition": {}, "definitionDigest": "sha256:<hex>",
    "reproducibility": "local", "limitations": [], "toolchain": {},
    "execution": {"source": "local-git-objects", "fidelity": "exact", "tree": "<sha>"},
    "generated": {"values": 128, "reused": 126, "sources": ["local"]}
  },
  "digest": "<lowercase sha256 of canonical extraction bytes>"
}
```

Extractors never write provenance themselves—the runner attaches it. Provenance
captures the immutable revision, actual dirty state, extractor metadata,
definition and its digest, reproducibility class, and any limitations. When the
runner executes an extractor, it also records `execution` to describe how that
run happened:

- `source` records where the extraction came from (`local-in-place`,
  `local-git-objects`, `local-workspace`, `local-materialized`, or `ci` when
  supplied by a verified CI artifact).
- `fidelity` indicates how faithfully the revision was observed: `exact`,
  `approximate` (when a toolchain borrowed dependencies installed for different
  lockfiles), or `stale` (when the working tree changed while the extractor
  ran).
- Additional execution details include the `determinism` class, `environment`
  fingerprint (a hash of the Projections version, `PATH`, and granted
  environment values), UTC timestamp (`at`), examined Git `tree`, workspace
  `strategy`, `prepared` environment steps, and enforced `scope`.

An extraction sourced from a CI artifact carries
`ci: {repository, run, workflow?, authentication?}`. Just like a test result,
the run published by the repository's own CI serves as the commit's official
extraction even if a local rerun might differ. It is marked `official: true`
only when the run was authenticated—either via `authentication` set to
`download` (when `--ci` fetched it from a run GitHub's API confirmed as the
repository's own Projections workflow, never a fork's) or `attestation` (when an
imported artifact's attestation named such a run; see
[CI artifacts as a source](../runner/caches.md#ci-artifacts-as-a-source)). An
imported artifact with no authentication is marked `official: false`. Hosts
label extractions as _From CI_, _Imported_, _Local_, _Approximate_, or _Stale_,
and show the official run for a commit by default. Keep in mind that these
fields only describe how the writing CLI obtained the document—a saved
document's own claims prove nothing to a reader.

A working-tree extraction records its base commit alongside
`ref: "working-tree"`. If an extraction contains
[generated values](extractions.md#generated-values), provenance also includes
`generated`: the total count of concrete generated values (`values`), how many
matched an existing key and value in the generation store (`reused`), and which
stores supplied them (`sources`: `local`, or `ci` for values harvested from a CI
artifact). Never persist temporary root paths, credentials, or forwarded
environment values.

Claims inside saved documents never grant trust. CI publishes saved documents in
a single envelope format, the [CI artifact](#ci-artifacts).

## CI artifacts

The GitHub Action uploads an Actions artifact named `projections` containing
`projections.artifact.json` (`format: "projections.artifact"`, `version: 0`,
[schema](../../packages/schemas/schemas/artifact/v0.json)) at its root and one
saved document per projection at `projections/<id>.json`:

```json
{
  "format": "projections.artifact", "version": 0, "protocolVersion": 0,
  "producer": {"cli": "projections 0.1.0", "action": "githubnext/projections@v0"},
  "repository": {"provider": "github", "id": 123, "owner": "octo-org", "name": "delivery"},
  "run": {"id": 456, "attempt": 1},
  "subject": {"kind": "pull-request", "number": 42, "base": "<sha>", "head": "<sha>", "mergeBase": "<sha>", "definition": "base"},
  "trust": false,
  "projections": [
    {"id": "dependencies", "status": "changed", "path": "projections/dependencies.json", "sha256": "<hex>"},
    {"id": "flags", "status": "error", "title": "Feature flags", "diagnostics": [{"severity": "error", "code": "TRUST_REQUIRED", "path": "", "message": "..."}]}
  ]
}
```

For a push event, `subject` is
`{"kind": "push", "ref": "refs/heads/main", "revision": "<sha>"}`. Projection
statuses match the CLI's batch items: `changed` and `unchanged` (a saved
comparison from `mergeBase` to `head`), `extracted` (a push's saved extraction),
`head-only` and `base-only` (a single side's saved extraction), and `error` (no
document, with bounded diagnostics). Each entry's `sha256` hashes the document
file's bytes. Artifacts hold at most 60 projections and 8 MiB per document.

A hosted view only accepts an artifact after GitHub independently verifies every
part of its identity:

- The artifact belongs to the latest successful run of the expected event for
  the exact head commit in the same repository, and that run's head repository
  is also the same repository—never a fork (since a fork's pull request runs the
  fork's own workflow files and could upload arbitrary content).
- The run executed the Projections workflow—a workflow file in the repository
  whose content on the default branch uses `githubnext/projections` (matching
  [`--ci`](../runner/caches.md#ci-artifacts-as-a-source), without its per-user
  `ciWorkflows`).
- The manifest matches that repository, run, pull request number, and head (or
  pushed) commit, and GitHub's merge base of `base` and `head` equals
  `mergeBase`.
- Every file in the archive is listed in the manifest with a matching SHA-256,
  and no unlisted files are present.
- Every document passes the shared loader (which recomputes extraction digests
  and reruns saved comparisons with the default comparator) and describes the
  manifest's exact clean commits.

Any envelope mismatch—an invalid archive, a mismatched manifest repository, run,
subject, or merge base, duplicate IDs or paths, or an unlisted file—rejects the
entire artifact. A per-document failure (a bad file SHA-256, loader error, or
mismatched commits) only marks that single projection as unverified, listing it
without its document while still displaying the rest. When a comparison was
produced by a custom comparator and its extractions and commits verify, the
hosted view lists it as such if it cannot rerun that comparator. Hosted views
never run extractors or load artifact-supplied code, and they authorize the
signed-in user on every read.

When the Action's `snapshots` input is enabled, PNG snapshots are uploaded to a
separate artifact named `projections-snapshots` (`<artifact-name>-snapshots`),
never mixed into `projections` (which must contain only the files listed in its
manifest). Its `snapshots.json` (`format: "projections.snapshots"`,
`version: 0`) repeats the manifest's `subject` and lists each image as
`{"id", "side"?: "before" | "after", "theme": "light" | "dark", "path", "sha256"}`,
alongside any `skipped` and `failed` projections. Snapshot artifacts are purely
informational; hosted views do not read them.
