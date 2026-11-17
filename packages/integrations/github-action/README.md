---
description: "The Projections GitHub Action's Node scripts"
icon: workflow
---

# Projections GitHub Action

`action.yml` at the repository root; these are its dependency-free Node scripts.
Usage, inputs, permissions, trust and retention are in the
[setup guide](../../../docs/setup/ci.md); the artifact format is in the
[contracts](../../../docs/contracts/saved-documents.md#ci-artifacts).

```yaml
- uses: actions/checkout@v6
  with:
    fetch-depth: 0
    persist-credentials: false
- uses: githubnext/projections@v0
```

- `src/install.mjs`: Downloads `gh-projections-<os>-<arch>[.exe]` and its
  `.sha256` from the release (`gh release download`), checks the SHA-256, then
  the build provenance attestation (`gh attestation verify`). With
  `build-from-source: true`, builds the CLI from the action's own checkout
  (`cargo build --release -p projections-cli`) instead.
- `src/base.mjs`: On pull requests (unless `reuse-base-artifact: false`),
  downloads the merge base's own `projections` artifact from the newest
  successful run of this workflow file for that commit, for a push or a pull
  request whose head is this repository (never a fork's), with
  `gh run download`, holding the token and running nothing from the repository.
  A failure is a warning.
- `src/collect.mjs`: Reads the `pull_request` or `push` event, computes the
  merge base with Git, runs
  `compare --all <merge-base>..<head> --definition base --json` or
  `show --all <commit> --json` (`--trust` only when `trust: true`), and splits
  the batch into `projections/<id>.json` plus `projections.artifact.json`. It
  passes `--in-place` (CI's checkout is the revision, so a checked-out head is
  extracted in place, with the dependencies the workflow installed) and
  `--artifact` with the base step's download, whose verified extractions the CLI
  reuses for the base, labelled imported; projections it lacks are extracted, in
  a workspace prepared by the repository's environment file when `trust: true`.
  Failed projections become annotations and manifest entries with diagnostics.
- `src/snapshot.mjs`: With `snapshots`, renders each listed projection from the
  collected documents with `projections snapshot --from` (no extractor runs
  again; no token in its environment): both sides of a pull request's comparison
  or the pushed extraction, light and dark, into
  `<id>[.<before|after>].<theme>.png` plus a `snapshots.json` index. Failures
  are warnings.
- `src/publish.mjs`: Commits the snapshots through the Git database API (blobs,
  tree, commit, ref; never forced, no credentials on disk): on a push to the
  default branch with `snapshots-commit`, into `snapshots-path`, unless
  unchanged or the branch moved on; on a pull request from this repository with
  `snapshots-branch`, under `pull/<number>/` on that branch. Outputs the
  commit-pinned image URLs. A read-only token produces a warning.
- `src/summary.mjs`: Writes the job summary from the collected documents alone
  (no token in its environment): what was compared, a table of results, then
  each projection's steps and changes in words (or its diagnostics), and how to
  review the artifact (**Projections: Open Artifact…** in VS Code, or
  `projections pr`). Repository text is escaped and can't mention anyone;
  details that don't fit GitHub's limit are left out with a note. A hosted view
  is linked only when `hosted-url` is set.
- `src/comment.mjs`: With `comment: true`, creates or updates one comment marked
  `<!-- projections:sticky-comment -->` holding the same summary, with before
  and after thumbnails (`<picture>` switching with the reader's theme) when
  `publish.mjs` committed them, else a link to the snapshots artifact. A
  read-only token (pull requests from forks) produces a warning, not a failure.

With `attest: true`, `actions/attest` attests the manifest (on pushes and pull
requests from this repository), so `projections --ci --artifact DIR` can
authenticate a downloaded copy.

`actions/upload-artifact` uploads the directory as the `projections` artifact,
and the snapshots as a separate `<artifact-name>-snapshots` artifact, so the
artifact holds exactly the files its manifest lists, as the
[contract](../../../docs/contracts/saved-documents.md#ci-artifacts) requires.
Workflow expressions reach scripts only through environment variables, and the
CLI runs with an argument vector, never a shell string. The release token is
passed to the install and comment steps only, never to the step that runs
extractors.

```sh
npm test --workspace @githubnext/projections-action
```

The tests cover the pure helpers (the summary's wording, escaping and size limit
included), run `collect.mjs` and `summary.mjs` against real Git repositories
with the built CLI (pull request and push), run `snapshot.mjs` with the built
CLI and the local Chrome, Chromium or Edge (skipped with a message when none is
installed, except in CI), run `publish.mjs` against an in-memory stand-in for
GitHub's Git database API, and run `install.mjs` with a fake `gh` to prove the
checksum is enforced before the attestation. To run the Action itself in CI on a
synthetic repository (with `build-from-source: true`),
`PROJECTIONS_TEST_EVENT_NAME`, `PROJECTIONS_TEST_EVENT_PATH` and
`PROJECTIONS_TEST_REF` replace the workflow's own event; they are for that test
only.
