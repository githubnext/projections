# Environments, workspaces and isolation

## Environments and workspaces

When a toolchain extractor—one that invokes `tsc`, `dotnet`, `go list`, or your
project's own code—needs to examine a commit that isn't currently checked out,
it needs that commit on disk with its dependencies installed. Projections
manages a **workspace** for that commit, and your repository can declare how to
prepare it in an **environment file** at `.github/projections/environment.json`
(or `.projections/environment.json`; this filename is reserved and is never read
as a projection definition—see the
[environment schema](../reference/schemas/environment.md)):

```json
{
  "format": "projections.environment",
  "version": 0,
  "prepare": [
    {"id": "install", "run": ["npm", "ci", "--ignore-scripts"], "key": ["package-lock.json", "**/package.json"]},
    {"id": "restore", "run": ["dotnet", "restore"], "key": ["**/*.csproj"], "directory": "src", "environment": ["NUGET_PACKAGES"], "timeoutMs": 900000}
  ],
  "toolchain": [["node", "--version"]],
  "workspace": {"strategy": "worktree"},
  "devcontainer": ".devcontainer/devcontainer.json"
}
```

<!-- prettier-ignore -->
| Field | Meaning |
|---|---|
| `prepare[].id` | Names the step in logs, records, and failures |
| `prepare[].run` | Command argv, executed directly without a shell |
| `prepare[].key` | Globs (`*` within a segment, `**` across segments) matching the files whose contents decide whether the step needs to re-run, typically lockfiles |
| `prepare[].directory` | Working directory relative to the checkout (defaults to `.`) |
| `prepare[].environment` | Extra environment variables to pass through. Every step also receives `PATH`, home, cache, temp-directory, and proxy variables so package managers can reach their global stores |
| `prepare[].timeoutMs` | Step timeout in milliseconds (default 600000, or ten minutes; maximum 3600000) |
| `toolchain` | Commands whose output identifies the toolchain; their hashed output becomes part of the environment fingerprint that keys cached `environmental` extractions. Runs only with `--trust` |
| `workspace.strategy` | Default workspace strategy for the repository (see below) |
| `devcontainer` | Reported by `doctor`; not executed |

Before running a toolchain extractor in a workspace, Projections runs each
prepare step in order whenever its key hash—computed from its argv, directory,
variable names, and each matched file's path and Git blob—differs from the last
successful run in that workspace. Each run is recorded with its key, timestamp,
duration, and log (up to the first 4 MiB). If a step fails, the extraction stops
immediately with an error naming the step, its log path, and the tail of the
log.

Because prepare steps run repository code, they execute only with `--trust` and
are allowed to access the network. On timeout or cancellation, the runner stops
the entire process tree. Just as CI uses each commit's own workflow, Projections
reads the environment file from the commit being examined, and records the steps
and keys that ran in `provenance.execution.prepared`.

**Nothing runs automatically in your working tree**—that environment belongs to
you, just as it does for tests. You can run prepare steps on demand with
`projections prepare --trust` (recorded under `prepared/<repository>/` in the
per-user cache), or prepare a commit's workspace ahead of time with
`projections prepare --revision REV --trust`. Run `projections doctor` to see
what the environment declares, each step's status in the working tree
(`current`, `stale`, `failed`, or never run), any missing tools, and which
workspace strategy is active and why.

**Without an environment file** (or without `--trust`), a toolchain extraction
of another commit borrows your working tree's installed dependencies
(`request.repository.checkout` points to your checkout). If any well-known
lockfile (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `Cargo.lock`,
`go.sum`, `packages.lock.json`, `poetry.lock`, `uv.lock`, `Pipfile.lock`,
`Gemfile.lock`, `composer.lock`, and similar) differs between that commit and
your working tree, the extraction is marked `approximate` with a limitation
listing the differing lockfiles.

**Workspace strategies** control how Projections checks out another commit:

<!-- prettier-ignore -->
| Strategy | What |
|---|---|
| `fresh` | Creates a temporary full copy for each run and deletes it afterward (prepare steps run every time) |
| `worktree` | Maintains a persistent linked Git worktree under the per-user cache (`workspaces/<repository>/`). Switching commits rewrites only changed files, preserves ignored files (installed dependencies, build caches), and removes untracked ones |
| `clone` | Creates a worktree seeded with a copy-on-write clone of your checkout (APFS `clonefile`, or btrfs/XFS reflink) so installed dependencies come along nearly for free; falls back to a regular worktree with a note if the filesystem doesn't support cloning |
| `sparse` | Creates a worktree containing only the definition's `execution.scope` (using Git's sparse checkout, which sets `extensions.worktreeConfig` in the repository); falls back to a regular worktree with a note if no scope is declared |
| `none` | Never creates copies; extractions of other commits fail and suggest `--ci`, checking out the commit, or choosing another strategy |

Projections picks the workspace strategy in this precedence order:

1. `--workspace STRATEGY` on the command line (which the VS Code setting
   `projections.workspace` passes through).
2. Your user configuration file, `config.json`, in the per-user configuration
   directory (`PROJECTIONS_CONFIG_DIR`, or
   `~/Library/Application Support/projections` on macOS,
   `$XDG_CONFIG_HOME/projections` / `~/.config/projections` on Linux, and
   `%APPDATA%\projections` on Windows):

```json
{"workspace": "clone", "ci": true, "repositories": {"/Users/me/src/monorepo": {"workspace": "none"}}}
```

3. The environment file's `workspace.strategy`.
4. Automatic selection: `fresh` if the repository has fewer than 2,000 files and
   20 MiB tracked; otherwise `worktree` when free disk space is at least four
   times the tracked size; otherwise `clone` if the filesystem supports it;
   otherwise `none`.

In `config.json`, `"ci": true` enables `--ci` by default, and
`"ciWorkflows": [".github/workflows/ci.yml"]` restricts which workflow runs
`--ci` accepts, just like [`--ci-workflow`](caches.md#ci-artifacts-as-a-source).

Each strategy keeps up to four workspace slots per repository, guarded by OS
file locks so concurrent runs never step on each other. Use
`projections workspace list` to inspect them (strategy, commit, prepared steps,
and lock status) and `projections workspace clean` to remove unused slots along
with their Git worktree registrations. Deleting the cache directory is also
safe—run `git worktree prune` afterward to clean up the Git registrations.

## Optional container isolation

```sh
projections -C /path/to/repository compare HEAD~1..HEAD -p services --trust \
  --container-engine docker \
  --container-image registry.example/extractors@sha256:REPLACE_WITH_64_HEX_DIGEST
```

If you want to isolate repository-owned executable extractors in a container,
pull and review the image ahead of time. The runner never pulls images on its
own, accepts only immutable digests, and supports repository-owned executable
extractors in this mode (not installation-owned built-in extractors).

Inside the container, the runner mounts a temporary copy of the examined
revision read-only at `/repository` (and, when a comparison uses another
revision's definition, mounts that revision read-only at `/definition` as the
working directory), along with the `projections` Python module read-only at
`/projections/python` at the front of `PYTHONPATH`. It updates the request root
to match, drops Linux capabilities, disables networking, caps resources, uses a
read-only container filesystem, and provides a bounded writable `/tmp`.

Container provenance records the exact image digest as `pinned-toolchain` rather
than `hermetic`. The container daemon itself remains trusted, and no socket,
credential home, or live checkout is ever mounted. Containers are cleaned up
explicitly even after a timeout or abort.
