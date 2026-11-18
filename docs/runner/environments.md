# Environments, workspaces and isolation

## Environments and workspaces

A toolchain extractor (one that runs `tsc`, `dotnet`, `go list` or the project's
own code) examining a commit that isn't checked out needs that commit on disk
and its dependencies installed. Projections keeps a **workspace** for it, and
the repository declares how to prepare one in an **environment file**,
`.github/projections/environment.json` (or `.projections/environment.json`; the
name is reserved, so it is never read as a definition;
[schema](../reference/schemas/environment.md)):

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
| `prepare[].id` | Names the step in logs, records and failures |
| `prepare[].run` | An argv, run without a shell |
| `prepare[].key` | Globs (`*` within a segment, `**` across) of the files whose content decides whether the step runs again, typically lockfiles |
| `prepare[].directory` | The working directory, relative to the checkout (default `.`) |
| `prepare[].environment` | Variables passed through. Every step also receives `PATH`, the home, cache and temporary-directory variables and the proxy variables, so package managers find their global stores |
| `prepare[].timeoutMs` | Default 600000 (ten minutes), at most 3600000 |
| `toolchain` | Commands whose output identifies the toolchain; their output (hashed) is part of the environment fingerprint that keys cached `environmental` extractions. Run only with `--trust` |
| `workspace.strategy` | The team's workspace strategy (below) |
| `devcontainer` | Reported by `doctor`; not run |

Before a toolchain extractor runs in a workspace, each step runs there, in
order, only when its key hash (its argv, directory and variable names, and each
matched file's path and Git blob) differs from its last successful run in that
workspace; each run is recorded with its key, time, duration and a log (the
first 4 MiB), and a failure stops the extraction with an error naming the step,
its log and the log's last lines. Steps are repository code, so they run only
with `--trust`; they may use the network. They are stopped with their whole
process tree on timeout or cancellation. The environment file of the examined
commit applies, as CI uses each commit's own workflow. The extraction's
`provenance.execution.prepared` lists the steps and keys that applied.

**In the working tree nothing runs automatically**: it is your environment, as
for tests. `projections prepare --trust` runs the steps there on demand
(recorded under `prepared/<repository>/` in the per-user cache), and
`projections prepare --revision REV --trust` prepares the workspace for a commit
ahead of time. `projections doctor` reports what is declared, each step's state
in the working tree (`current`, `stale`, `failed` or never run), missing tools,
and the workspace strategy and why.

**Without an environment file** (or without `--trust`), a toolchain extraction
of another commit borrows the working tree's installed dependencies
(`request.repository.checkout` is your checkout). When any well-known lockfile
(`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `Cargo.lock`, `go.sum`,
`packages.lock.json`, `poetry.lock`, `uv.lock`, `Pipfile.lock`, `Gemfile.lock`,
`composer.lock` and the like) differs between the commit and the working tree,
the extraction is labelled `approximate`, with a limitation naming them.

**Workspace strategies.** Where a commit is checked out:

<!-- prettier-ignore -->
| Strategy | What |
|---|---|
| `fresh` | A temporary full copy per run, removed afterwards (prepare steps run every time) |
| `worktree` | A persistent linked Git worktree Projections owns under the per-user cache (`workspaces/<repository>/`). Switching commits rewrites only changed files, keeps ignored files (prepared dependencies, build caches) and removes untracked ones |
| `clone` | A worktree seeded with a copy-on-write clone of your checkout (APFS `clonefile`; btrfs or XFS reflink), so your installed dependencies come along nearly free; where the filesystem can't clone, a worktree, saying so |
| `sparse` | A worktree holding only the definition's `execution.scope` (Git's sparse checkout, which sets `extensions.worktreeConfig` in the repository); without a scope, a worktree, saying so |
| `none` | No copies: such an extraction fails, suggesting `--ci`, checking the commit out or another strategy |

The strategy is chosen by, in order: `--workspace STRATEGY` (the VS Code setting
`projections.workspace` passes it); the user configuration file, `config.json`
in the per-user configuration directory (`PROJECTIONS_CONFIG_DIR`, else
`~/Library/Application Support/projections` on macOS,
`$XDG_CONFIG_HOME/projections` or `~/.config/projections` on Linux and
`%APPDATA%\projections` on Windows):

```json
{"workspace": "clone", "ci": true, "repositories": {"/Users/me/src/monorepo": {"workspace": "none"}}}
```

then the environment file's `workspace.strategy`; and otherwise automatically:
`fresh` for fewer than 2,000 files and 20 MiB tracked, `worktree` when free disk
space is at least four times the tracked size, else `clone` where the filesystem
supports it, else `none`. (`"ci": true` in the configuration turns on `--ci`,
and `"ciWorkflows": [".github/workflows/ci.yml"]` names the workflow files whose
runs `--ci` accepts, as [`--ci-workflow`](caches.md#ci-artifacts-as-a-source)
does.) Each strategy keeps up to four slots per repository, each locked with an
OS file lock while a run uses it, so concurrent runs never share one.
`projections workspace list` shows them (strategy, commit, prepared steps,
whether in use) and `projections workspace clean` removes those not in use, with
their Git worktree registrations. Removing the cache directory is safe too;
`git worktree prune` then forgets them.

## Optional container isolation

```sh
projections -C /path/to/repository compare HEAD~1..HEAD -p services --trust \
  --container-engine docker \
  --container-image registry.example/extractors@sha256:REPLACE_WITH_64_HEX_DIGEST
```

Prepare the reviewed image explicitly first. The runner never pulls an image,
accepts only immutable digests, and supports repository-owned executable
extractors (not installation-owned built-in extractors) in this mode. It mounts
only a temporary copy of the revision, read-only, at `/repository` (and, when a
comparison applies another revision's definition, that revision read-only at
`/definition` as the working directory) and the `projections` Python module
read-only at `/projections/python`, first on `PYTHONPATH`, changes the request
root accordingly, drops capabilities, disables network, restricts resources,
uses a read-only container filesystem and a bounded writable `/tmp`. Container
provenance records the exact image digest as `pinned-toolchain`, not `hermetic`.
The daemon remains trusted; no socket, credential home or current checkout is
mounted. Container cleanup is explicit even after timeout/abort.
