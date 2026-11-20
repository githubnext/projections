# Saved extractions and CI artifacts

## Saved extractions

Saved extractions use `format: "projections.extraction"`, `version: 0`:

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

Extractors never write provenance; the runner adds it. Provenance records the
immutable revision, actual dirty state, extractor, definition and its digest,
reproducibility and limitations, and, for an extractor the runner ran,
`execution`, the run that observed it: where it ran (`source`: `local-in-place`,
`local-git-objects`, `local-workspace`, `local-materialized`, or `ci` when a
verified CI artifact supplied it), how faithful it is (`fidelity`: `exact`;
`approximate` when a toolchain borrowed dependencies installed for different
lockfiles; `stale` when the working tree changed while it ran), its
`determinism` class, the `environment` fingerprint (a hash of the Projections
version, `PATH` and the granted variables' values), when it ran (`at`, UTC), the
examined Git `tree`, the workspace `strategy`, the `prepared` environment steps
and the enforced `scope`. An extraction from a CI artifact has
`ci: {repository, run, workflow?, authentication?}`: like a test result, the run
the repository's own CI published is the commit's official extraction, even
though a rerun might differ. It is `official: true` only when the run was
authenticated (`authentication`: `download` when `--ci` downloaded it from a run
GitHub's API identified as the repository's own Projections workflow, never a
fork's; `attestation` when an imported artifact's attestation named such a run;
see [CI artifacts as a source](../runner/caches.md#ci-artifacts-as-a-source)).
An imported artifact nothing authenticated is `official: false`. Hosts show it
as _From CI_, _Imported_, _Local_, _Approximate_ or _Stale_, and the official
run for a commit by default. These fields describe how the CLI that wrote the
document obtained it; a saved document's own claim proves nothing to its reader.
A working-tree extraction records its base commit with `ref: "working-tree"`. An
extraction with [generated values](extractions.md#generated-values) records
`generated`: how many concrete generated values it holds (`values`), how many
carried a key and value the generation store already held (`reused`), and which
stores those came from (`sources`: `local`, or `ci` for values harvested from a
CI artifact). Do not persist temporary root paths, credentials or forwarded
environment values.

Saved documents' claims never grant trust. CI publishes them in one format, the
[CI artifact](#ci-artifacts).

## CI artifacts

The GitHub Action uploads an Actions artifact named `projections` whose root
holds `projections.artifact.json` (`format: "projections.artifact"`,
`version: 0`, [schema](../../packages/schemas/schemas/artifact/v0.json)) and one
document per projection at `projections/<id>.json`:

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

A push's `subject` is
`{"kind": "push", "ref": "refs/heads/main", "revision": "<sha>"}`. Statuses are
those of the CLI's batch items: `changed` and `unchanged` (a saved comparison
from `mergeBase` to `head`), `extracted` (a push's saved extraction),
`head-only` and `base-only` (one side's saved extraction), and `error` (no
document; bounded diagnostics). `sha256` is over the document file's bytes. At
most 60 projections and 8 MiB per document.

A hosted view accepts an artifact only when GitHub independently confirms it:
the artifact belongs to the latest successful run of the right event for the
exact head commit, in the same repository; that run's head repository is the
same repository too, never a fork's (a fork's pull request runs the fork's own
workflow files, which can upload anything, so its artifacts are never read); the
run is of the Projections workflow, a workflow file of the repository whose
content on the default branch uses `githubnext/projections` (as with
[`--ci`](../runner/caches.md#ci-artifacts-as-a-source), without its per-user
`ciWorkflows`); the manifest names that repository, run, pull request number and
head (or pushed commit); every file is listed with a matching SHA-256 and no
other file exists; every document passes the shared loader (extraction digests
recomputed, saved comparisons rerun by the default comparator); every document
describes exactly the manifest's clean commits; and GitHub's merge base of
`base` and `head` is `mergeBase`. A mismatch in the envelope (the archive, the
manifest, its repository, run, subject or merge base, duplicate IDs or paths, or
a file the manifest doesn't list) rejects the whole artifact. A document that
fails its own checks (its file's SHA-256, the loader or its commits) makes only
that projection unverified: it is listed without its document and the others are
shown. A comparison by a custom comparator, whose extractions and commits
verify, is listed as such when the view can't rerun it. A hosted view never runs
extractors or imports artifact-supplied code, and authorizes the signed-in user
for every read.

With the Action's `snapshots` input, PNG snapshots go to a separate artifact,
`projections-snapshots` (`<artifact-name>-snapshots`), never into `projections`,
which must contain only the files its manifest lists. Its `snapshots.json`
(`format: "projections.snapshots"`, `version: 0`) repeats the manifest's
`subject` and lists each image as
`{"id", "side"?: "before" | "after", "theme": "light" | "dark", "path", "sha256"}`,
with `skipped` and `failed` projections. It is informational: hosted views don't
read it.
