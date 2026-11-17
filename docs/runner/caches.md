# Caches and stores

## Helper cache

Interpreters need some built-in extractors' helpers (the Go helper source, the
Django and TypeScript helpers and the slim .NET helper) as files. The first
extraction that uses one unpacks the executable's complete helper set into a
per-user cache:

| Platform             | Directory                                                      |
| -------------------- | -------------------------------------------------------------- |
| Linux and other Unix | `$XDG_CACHE_HOME/projections` (default `~/.cache/projections`) |
| macOS                | `~/Library/Caches/projections`                                 |
| Windows              | `%LOCALAPPDATA%\projections`                                   |

`PROJECTIONS_CACHE_DIR` selects another absolute directory. Each set lives in
`helpers/<version>-<digest>`, named by the CLI version and the digest of every
embedded file, so versions never share or overwrite one another. It is written
under a private staging name and renamed into place, so it is either absent or
complete. Before every use the CLI verifies that the directory holds exactly the
embedded files, byte for byte by SHA-256, with no other entries or symlinks and,
on Unix, that the cache directories are owned by the current user and writable
only by them; anything else is replaced from the embedded copy, never run.
Removing the cache is always safe. A shared, group- or world-writable cache
directory is refused.

## Extraction cache

Extractions persist in the same per-user cache directory, under
`extractions/<repository>/` (the repository named by its Git common directory),
shared by every command, `serve --stdio` and `mcp`. An extraction is reused when
its key matches: the definition digest, the examined revision's Git tree (a
commit's, or the working tree's identity, below), the definition revision's tree
when a custom program comes from another revision, the access mode, container
isolation, and for an `environmental` extraction the environment fingerprint
(the Projections version, `PATH` and the granted variables' values, hashed). A
`pure` extraction is keyed by the tree alone; an `observed` one is never cached;
a toolchain's extraction of the working tree isn't either, because it also
depends on ignored files (installed dependencies, generated code) the tree can't
see; and neither is a `stale` one. A reused extraction is revalidated (schema,
digest and definition digest) and keeps the provenance of the run that made it,
including when it ran.

The working tree's identity is the tree `git add -A` would commit, written with
a temporary index seeded from the real one (`git write-tree`): Git rehashes only
files whose stat information changed, and the user's index and refs are not
touched. Changed files' blobs are written to the object store, as `git stash`
would write them, and `git gc` collects them.

The cache is capped at 512 MiB across repositories
(`PROJECTIONS_EXTRACTION_CACHE_BYTES` sets another cap), evicting the least
recently used entries. `--no-cache` bypasses it; removing it is always safe.

## Generation store

[Generated values](../contracts/extractions.md#generated-values), such as
summaries a language model wrote, are judged by their basis. So that an equal
basis also gives the same text, the runner keeps a generation store beside the
extraction cache:
`generations/<repository>/<SHA-256 of the projection ID>.jsonl`, one entry per
declared path and [basis digest](../contracts/extractions.md#generated-values).
The runner fills it from extractions that passed validation: the runs it makes,
extractions the cache supplies and those from verified
[CI artifacts](#ci-artifacts-as-a-source). A key already stored keeps its
earlier value, so text converges on the first generation. Before running an
extractor, the runner writes the projection's entries to a private temporary
file and names it in the request (`generations.file`); under container isolation
it is mounted read-only at `/generations.jsonl`. Extractors only read it. An
extraction with generated values records how many the store supplied in
`provenance.generated`.

A comparison extracts its before side first, so the after side reuses the base's
text for every unchanged basis even on a cold cache, as in CI. Each projection
keeps at most 16 MiB, least recently used first out, and the store is capped at
128 MiB across repositories (`PROJECTIONS_GENERATION_CACHE_BYTES` sets another
cap). `--regenerate` hands extractors no snapshot, so every generated value is
generated again; its results are recorded, but stored keys keep their values.
Removing the store is always safe.

## CI artifacts as a source

A commit the team's CI already extracted needn't be extracted again: as with
test results, CI's run is the commit's official extraction. `--artifact DIR`
names a downloaded `projections` artifact (a directory holding
`projections.artifact.json`), and `--ci` downloads the artifact of this
repository's newest successful GitHub Actions run for the commit with `gh` (the
repository is the `origin` remote; `PROJECTIONS_GH` names another `gh`), keeping
it under `artifacts/<repository>/<run>/` in the per-user cache, with a record of
the run beside it (`<run>.json`). Downloading, and verifying attestations, are
the only network requests this adds, and only with `--ci`. An extraction is
reused only when its file's SHA-256 matches the manifest, its own digest
verifies, it describes exactly that clean commit, and its definition digest
matches the definition being applied; its provenance then says `source: ci` and
names the run. Both sides of a pull request artifact's comparisons are
available, so a merge base CI compared is reused too.

Only an authenticated extraction is `official: true`. `--ci` downloads only from
a run that GitHub's API says succeeded in this repository for a `push`, or for a
`pull_request` whose head repository is this repository, never a fork's (whose
run uses the fork's own workflow files and can upload anything), and that ran
the Projections workflow: a workflow file `--ci-workflow FILE` or the
configuration's `ciWorkflows` (a path or file name, or a list;
[configuration](environments.md)) names, else one whose file on the default
branch uses `githubnext/projections`. Its provenance says
`ci: {repository, run, workflow, authentication: "download"}`. An `--artifact`
directory is authenticated only by its attestation: with `--ci`, the CLI runs
`gh attestation verify` on its manifest (the Action attests it with
[`attest: true`](../setup/ci.md#attesting-the-artifact)) and requires the
attestation to name a run that passes the same checks
(`authentication: "attestation"`). Any other imported extraction is still
reused, but with `official: false` and no `authentication`: its manifest alone
names the run, and nothing confirms it. Downloads an earlier version kept
without a record of their run aren't used; `--ci` checks and records the run
again.

`projections check --parity REV --ci` extracts a commit locally, with nothing
reused, and compares it with CI's artifact for the same commit and definition: a
difference is a measurement, not an error ("varies between this environment and
CI run 4242 on 12% of items"), and points at environment drift. As in `check`'s
rerun, differences only at the extraction's declared `volatile` fields, within
their tolerances, match.
