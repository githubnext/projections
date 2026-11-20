# Caches and stores

## Helper cache

Some built-in extractors rely on helper files that external interpreters need on
disk—specifically the Go helper source, the Django and TypeScript helpers, and
the slim .NET helper. The first time an extraction needs one, the CLI unpacks
its entire embedded helper set into a per-user cache directory:

| Platform             | Directory                                                      |
| -------------------- | -------------------------------------------------------------- |
| Linux and other Unix | `$XDG_CACHE_HOME/projections` (default `~/.cache/projections`) |
| macOS                | `~/Library/Caches/projections`                                 |
| Windows              | `%LOCALAPPDATA%\projections`                                   |

You can override this location with an absolute path in `PROJECTIONS_CACHE_DIR`.
Each unpacked set lives under `helpers/<version>-<digest>`, keyed by the CLI
version and the digest of every embedded file, so different CLI versions never
share or overwrite each other's helpers. Files are written to a private staging
directory and renamed into place atomically, so a helper directory is either
absent or complete.

Before every run, the CLI verifies that the directory contains the exact
embedded files—byte for byte by SHA-256—with no extra entries or symlinks. On
Unix, it also checks that the cache directories are owned by the current user
and writable only by them (shared, group-writable, or world-writable cache
directories are refused). Anything that fails verification is replaced from the
embedded copy rather than executed. Deleting the cache is always safe.

## Extraction cache

Extractions are stored in the same per-user cache directory under
`extractions/<repository>/` (keyed by the repository's Git common directory) and
shared across every command, `serve --stdio`, and `mcp`. A cached extraction is
reused when every part of its key matches:

- the definition digest
- the examined revision's Git tree (either a commit's tree or the working tree's
  identity, described below)
- the definition revision's tree, when a custom program comes from another
  revision
- the access mode and container isolation setting
- for an `environmental` extraction, the hashed environment fingerprint (the
  Projections version, `PATH`, and the granted variables' values)

A `pure` extraction is keyed by the tree alone. Several cases are never cached:
`observed` extractions, `stale` extractions, and toolchain extractions of the
working tree (since they can depend on ignored files like installed dependencies
or generated code that the Git tree doesn't capture). Whenever a cached
extraction is reused, it is revalidated (schema, digest, and definition digest)
and retains the provenance of the run that originally produced it, including its
timestamp.

To compute the working tree's identity without touching your index or refs, the
CLI seeds a temporary index from your real one and writes the tree that
`git add -A` would commit (`git write-tree`). Git only rehashes files whose stat
information changed, writing any new blobs to the object store just like
`git stash` does, where `git gc` later cleans them up.

The extraction cache is capped at 512 MiB across all repositories (override with
`PROJECTIONS_EXTRACTION_CACHE_BYTES`) and evicts least-recently-used entries.
Pass `--no-cache` to bypass it; deleting it manually is always safe.

## Generation store

[Generated values](../contracts/extractions.md#generated-values)—such as
summaries written by a language model—are judged by their basis. To keep the
same basis producing the same text, the runner maintains a generation store next
to the extraction cache at
`generations/<repository>/<SHA-256 of the projection ID>.jsonl`, with one entry
per declared path and
[basis digest](../contracts/extractions.md#generated-values).

The runner populates this store from extractions that pass validation, whether
they come from fresh runs, the extraction cache, or verified
[CI artifacts](#ci-artifacts-as-a-source). Once a key is stored, it keeps its
original value so the text converges on the first generation. Before invoking an
extractor, the runner writes the projection's stored entries to a private
temporary file and passes its path in the request (`generations.file`), or
mounts it read-only at `/generations.jsonl` under container isolation.
Extractors only read from it, and any extraction with generated values records
how many came from the store in `provenance.generated`.

When running a comparison, the runner extracts the before side first so the
after side can reuse the base's text for every unchanged basis—even on a cold
cache, such as in CI. Each projection keeps at most 16 MiB (evicting least
recently used entries first), with an overall cap of 128 MiB across repositories
(override with `PROJECTIONS_GENERATION_CACHE_BYTES`). Pass `--regenerate` to
withhold the snapshot from extractors so every generated value is produced
fresh; new results are recorded, though existing stored keys keep their earlier
values. Deleting the store is always safe.

## CI artifacts as a source

If CI has already extracted a commit, you don't need to extract it again
locally: just like test results, CI's run serves as the commit's official
extraction. Pass `--artifact DIR` to point at a downloaded `projections`
artifact (a directory containing `projections.artifact.json`), or pass `--ci` to
let the CLI download the artifact from this repository's newest successful
GitHub Actions run for that commit using `gh` (targeting the `origin` remote;
set `PROJECTIONS_GH` to use a different `gh` binary).

Downloaded artifacts are cached under `artifacts/<repository>/<run>/` in the
per-user cache, alongside a `<run>.json` record of the run. Downloading
artifacts and verifying attestations are the only network requests this feature
adds, and they happen only when `--ci` is passed. A CI extraction is reused only
when its file's SHA-256 matches the manifest, its own digest verifies, it
describes that exact clean commit, and its definition digest matches the active
definition. Reused extractions record `source: ci` and the run in their
provenance. Because both sides of a pull request artifact's comparisons are
stored, a merge base that CI already compared can be reused too.

Only authenticated extractions are marked `official: true`. With `--ci`, the CLI
downloads only from runs that GitHub's API reports as succeeded in this
repository for a `push` or for a `pull_request` whose head repository is this
same repository—never a fork's run, since a fork controls its own workflow files
and could upload arbitrary content. The run must also come from the Projections
workflow: either one named by `--ci-workflow FILE` or `ciWorkflows` in your
[configuration](environments.md) (a path, file name, or list), or otherwise a
workflow whose file on the default branch uses `githubnext/projections`. Its
provenance records
`ci: {repository, run, workflow, authentication: "download"}`.

An `--artifact` directory is authenticated only through its attestation: when
combined with `--ci`, the CLI runs `gh attestation verify` on its manifest (the
Action attests it when [`attest: true`](../setup/ci.md#attesting-the-artifact)
is enabled) and requires the attestation to name a run that passes those same
checks (`authentication: "attestation"`). Any other imported extraction is still
reused, but marked `official: false` with no `authentication` field because only
its manifest names the run. If GitHub cannot be reached (for example, `gh` is
unauthenticated, you are offline, or there is no `origin`), a matching import is
still used and labelled imported; if there is nothing to fall back on, the error
is reported.

Each download record captures the host, repository, run, workflow, and why the
workflow was accepted (`configured` or `uses-action`). It is reused only while
it still matches the current `origin` and passes the active policy—either named
by the current configuration, or accepted because it used the Projections Action
when no workflow is configured (never merely because an older configuration
named it). Older downloads without a complete record are ignored so `--ci`
re-checks and records the run cleanly. CI extractions are never copied into the
local extraction cache, ensuring their official status is evaluated fresh on
every run.

To check whether your local environment matches CI, run
`projections check --parity REV --ci`. It extracts the commit locally without
reusing anything and compares the result against CI's artifact for the same
commit and definition. Differences are reported as measurements rather than
errors (for example, "varies between this environment and CI run 4242 on 12% of
items") to surface environment drift. Just like `check`'s rerun comparison,
differences confined to declared `volatile` fields within their tolerances count
as a match.
