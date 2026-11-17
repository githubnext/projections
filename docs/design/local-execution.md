# Local execution: materialize only as a last resort

Status: **adopted**. This page explains how the CLI decides where an extractor
runs and where its dependencies come from, and why. The contract is in
[the runner](../runner/execution.md#exact-source-and-explicit-execution) and
[the contracts](../contracts/extractors.md); the measurements that motivated it
are [below](#measurements).

## The problem

Projections in CI is like running tests in CI: the team makes the environment
right (checkout, toolchain, `npm ci`), and the run uses it. Locally it is like
running tests locally, which is harder: the developer's checkout is the
environment, and it only matches one revision, the one checked out.

Before this design the runner did one thing for every revision, including the
working tree and CI's own checkout: it wrote the whole revision out to a
temporary directory (`ls-tree` plus `cat-file`, or a copy of the working tree),
ran the extractor there and deleted the directory. Dependencies came from the
user's checkout through `request.repository.checkout`, so an old revision was
silently analysed against today's `node_modules`. Nothing was remembered between
processes. That was

- **wasteful**: a read-only extractor that reads three manifests paid for
  writing out 50,000 files, and an extractor running in CI's checkout paid for a
  second copy of it;
- **limited**: anything over 256 MiB or 50,000 files could not be extracted at
  all ([kubernetes](#measurements) is 270 MiB);
- **quietly approximate**: a toolchain extractor on an old revision used the
  current dependencies, and nothing said so;
- **forgetful**: comparing `main` with the working tree re-extracted `main`
  every time.

Declared paths can't fix this alone. An extractor may declare its top-level
export files and then crawl their imports, so a declaration is a promise, not a
fact, until something checks it. And no single strategy fits every repository:
some are too large to have two copies on one machine, others are small enough
for dozens of worktrees. It depends on the repository, its package manager, the
machine and the developer.

## Principles

1. **Run where the files already are.** The working tree, and CI's checkout, are
   the revision: extract them in place, the way tests run.
2. **Read Git, don't copy it.** An extractor that only reads files reads them
   straight from the object store.
3. **Copy only for a toolchain on another revision.** Running `tsc`, `dotnet` or
   `go list` on a commit that isn't checked out is the only case that needs
   files on disk, and then a reused, prepared workspace beats a fresh copy.
4. **Identity from Git.** What an extraction depends on is named by Git's own
   hashes, not by declarations.
5. **Say what happened.** Every extraction records where it came from and how
   faithful it is; nothing approximate is presented as exact.
6. **The repository declares its environment; the machine chooses the
   strategy.** How to install dependencies is the team's knowledge (as in CI);
   how many copies a machine can afford is the developer's.

## Per side: the cheapest trustworthy source

For each revision of a show or comparison, the runner takes the first that
applies:

<!-- prettier-ignore -->
| Source | When | Cost |
|---|---|---|
| **Cache** | The same definition digest, Git tree and environment fingerprint were extracted before, on this machine | A file read |
| **CI artifact** | A commit CI already extracted with the same definition digest, and artifacts are enabled (`--ci`, `--artifact DIR`) | A verified download, once |
| **In place** | The working tree; or a commit that is `HEAD` of a clean checkout (always in CI, with `--in-place` for a checkout with untracked build output) | None |
| **Git objects** | A built-in extractor that declares it only reads files (`access: files`), on any commit | Reading the blobs it asks for |
| **Workspace** | A toolchain or custom extractor on a commit that isn't checked out | Switching a reused workspace (see [strategies](#workspace-strategies)) |

The in-place run records the working tree's identity (its tree hash, below)
before and after. If the extractor, or the user, changed it meanwhile, the
result is labelled **stale** and never cached: it is not silently wrong.
Incremental build caches (`obj/`, `target/`, `.tsbuildinfo`) are ignored files,
so they survive and make the next run faster.

Git-object reads go through the extractor SDK. `read_source` and the file list
already mediated every read the read-only built-ins make, so they now take them
from a reader that is either a directory or the object store; the extractor
can't tell. A read-only built-in declares this with `access: files` in its
descriptor. In place, the same reader lists the files Git does (tracked plus
untracked, not ignored) and refuses an ignored path, so a working-tree
extraction depends on exactly what its tree hash covers.

## Identity from Git, and a persistent cache

The cache key is the SHA-256 of

- the **definition digest** (the canonical definition and its declared sources);
- the examined revision's **Git tree hash**, and the definition revision's when
  it differs (its program may read undeclared files);
- the access mode;
- for an `environmental` extraction, an **environment fingerprint**: the
  Projections version, `PATH` and the granted environment variables' values
  (hashed, never stored), the outputs of the environment file's `toolchain`
  commands, and the hashes of the prepare keys' files (or of the well-known
  lockfiles when no environment is declared). A `pure` extraction leaves it out;
  an `observed` one is never cached ([determinism](#determinism-and-authority)).

A commit's tree hash is free (`rev-parse <commit>^{tree}`). The working tree's
is computed with a temporary index seeded from the real one, `git add -A`, and
`git write-tree`: Git rehashes only files whose stat information changed, and
the user's index and refs are untouched. It writes blob objects for changed
files into the object store, as `git stash` would; `git gc` collects them.

The cache lives in the per-user cache directory (`extractions/<repository>/`,
where the repository is named by its Git common directory), holds saved
extraction documents, is shared by the CLI and `serve --stdio`, and is capped
(512 MiB by default, `PROJECTIONS_EXTRACTION_CACHE_BYTES`) with least recently
used eviction. Removing it is always safe. `--no-cache` bypasses it. A hit is
revalidated (schema, digest and definition digest) before use.

**What is not cached:** a toolchain extraction of the working tree. Its result
depends on ignored files (installed dependencies, generated code) that the tree
hash can't see, so it always runs. Read-only extractions of the working tree are
cached: they can only read what the tree hash covers.

## Scopes: optional, and enforced

By default an extraction depends on the whole revision, which is always correct.
A definition (`scope`) or a built-in (from its inputs) may narrow it to
repository-relative paths, files or directories. Paths rather than globs,
because Git can hash a path's subtree for free (`rev-parse <tree>:<path>`) and
sparse checkouts take paths. A narrower scope is enforced wherever execution is
mediated:

- **Git-object and in-place reads** through the SDK refuse a path outside it,
  naming the path; the file list holds only the scope;
- **workspaces** with the `sparse` strategy check out only the scope;
- **`projections check`** extracts once with the scope enforced (a sparse
  materialization) and once without, and records the scope as verified for that
  definition digest only when both agree. CI runs `check` too.

The cache keys a scoped extraction by the scope's subtree hashes, so an edit
outside the scope is a hit. That is only sound when the scope was enforced
(Git-object reads) or verified; otherwise the whole tree hash is used, so an
edit outside the scope is a miss. A toolchain extractor in place is not enforced
at the process level: a macOS sandbox profile or Linux Landlock could deny reads
outside the scope, and that remains future work.

## The environment: `prepare`

A repository describes how to make a usable environment once, as it does for CI,
in `.github/projections/environment.json` (or `.projections/environment.json`;
the file name is reserved, so discovery doesn't read it as a definition):

```json
{
  "format": "projections.environment",
  "version": 0,
  "prepare": [
    {
      "id": "install",
      "run": ["npm", "ci", "--ignore-scripts"],
      "key": ["package-lock.json", "**/package.json"],
      "timeoutMs": 600000
    },
    {
      "id": "restore",
      "run": ["dotnet", "restore"],
      "key": ["**/*.csproj", "Directory.Packages.props", "**/packages.lock.json"],
      "directory": "src",
      "environment": ["NUGET_PACKAGES"]
    }
  ],
  "toolchain": [["node", "--version"], ["dotnet", "--version"]],
  "workspace": {"strategy": "worktree"},
  "devcontainer": ".devcontainer/devcontainer.json"
}
```

<!-- prettier-ignore -->
| Field | Meaning | Why |
|---|---|---|
| `prepare[].id` | A name for the step: logs, records and failures name it | A failure must say which step failed |
| `prepare[].run` | An argv, run without a shell | Like extractors: no quoting ambiguity, no shell injection |
| `prepare[].key` | Globs of the files whose content decides whether the step must run again, typically lockfiles and manifests | Dependencies change when lockfiles change, not on every commit; switching between two commits with the same lockfile reruns nothing |
| `prepare[].directory` | The working directory, relative to the workspace root (default `.`) | Monorepos install in subdirectories |
| `prepare[].environment` | Variable names passed through, as `execution.environment` does for extractors | Registries and caches are configured by environment; secrets stay out unless named |
| `prepare[].timeoutMs` | Default 10 minutes, at most an hour | Installs are slow, but never unbounded |
| `toolchain` | Commands whose output identifies the toolchain (part of the cache fingerprint) | A `node` upgrade on the same `PATH` should invalidate the cache |
| `workspace.strategy` | The team's preferred [strategy](#workspace-strategies) | Some repositories are known to be too big for a second copy |
| `devcontainer` | A devcontainer that describes the same environment | Reported by `doctor`; running it is future work |

**Semantics.** Steps run in a workspace before a toolchain extractor runs there,
in order, each only when its key hash (the matched files' paths and bytes, the
argv, directory and environment names) differs from the last successful run in
that workspace. Each run is recorded with its key, duration, exit status and a
log. They run repository code, so they need `--trust` exactly as extractors do;
untrusted runs never prepare. Unlike extraction, they may use the network. Each
has a timeout, is cancelled with the operation, captures its output to a bounded
log (the last 4 MiB) and fails with an error that names the step and the log.

The environment of the **examined** revision is used, as CI uses each commit's
own workflow: an old revision with a different package manager prepares the way
it did then.

**The working tree is the user's.** Nothing runs there automatically, as with
tests. `projections prepare` runs the steps on demand (in the working tree), and
`projections prepare --revision REV` prepares the workspace for a revision.
`projections doctor` reports what is declared, what each workspace has prepared,
which steps are stale and which tools are missing.

**Global stores make a second workspace cheap.** pnpm, Go modules, Cargo, NuGet
and uv keep one store per machine and link or reference it, so preparing a
second workspace mostly creates links. npm and yarn classic copy every package
into each `node_modules`; they are the costly outliers
([measured](#measurements)).

**Without an environment.** A toolchain extractor on a commit borrows the user's
installed dependencies through `request.repository.checkout`, as before, but now
the runner compares the well-known lockfiles (`package-lock.json`,
`pnpm-lock.yaml`, `yarn.lock`, `Cargo.lock`, `go.sum`, `packages.lock.json`,
`poetry.lock`, `uv.lock`, `Pipfile.lock`, `Gemfile.lock`, `composer.lock`) of
the examined revision with the working tree's. When any differ, the extraction
is labelled **approximate**, with a limitation naming them.

### CI and the base side

The Action extracts the merge base as well as the head. The head is CI's own
checkout: in place, no copy. For the base, the Action first downloads the merge
base's own `projections` artifact (from the latest successful push run for that
commit, in a separate step that holds the token and runs nothing) and passes it
with `--artifact`; the CLI verifies it and reuses each extraction whose
definition digest matches. Projections it lacks run in a workspace, where the
declared `prepare` steps run first (with `trust: true`); without an environment
they borrow CI's prepared checkout and are labelled approximate when the
lockfiles differ.

## Workspace strategies

<!-- prettier-ignore -->
| Strategy | What | For |
|---|---|---|
| `fresh` | A temporary full copy per run, as before | Tiny repositories |
| `worktree` | One persistent linked Git worktree that Projections owns, under the user cache directory. Switching revisions rewrites only changed files, keeps ignored files (prepared dependencies, build caches) and removes untracked ones | The default |
| `clone` | A worktree seeded with a copy-on-write clone of the checkout (APFS `clonefile`, btrfs/XFS reflink), so the user's installed dependencies come along for free; then as `worktree`. Falls back to `worktree`, and says so, where the filesystem can't clone | Large repositories with large dependency trees |
| `sparse` | A worktree limited to the definition's scope | Very large repositories with scoped projections |
| `none` | No extra copies: cache, CI artifacts and in-place only; a toolchain extraction of another commit fails, saying how to get one | Repositories too large for a second copy |

**Precedence:** the machine's choice, then the team's, then automatic:

1. `--workspace STRATEGY`, the VS Code setting `projections.workspace` (passed
   as `--workspace`), or the user config file (`config.json` in the per-user
   config directory: `{"workspace": "clone"}` or per repository
   `{"repositories": {"/abs/path": {"workspace": "none"}}}`);
2. `workspace.strategy` in the environment file;
3. automatic: `fresh` under 2,000 files and 20 MiB; otherwise `worktree` when
   free disk space is at least four times the tracked size; else `clone` where
   the filesystem supports it; else `none`.

`projections doctor` says which was chosen and why. A workspace is locked (an OS
file lock) while a run uses it; a second concurrent run takes the next slot (at
most four per repository) or waits. `projections workspace list` shows them
(strategy, revision, prepared steps, size) and `projections workspace clean`
removes them.

## Provenance

Every extraction records `provenance.execution`:

<!-- prettier-ignore -->
| Field | Values |
|---|---|
| `source` | `ci` (a CI artifact), `local-in-place`, `local-git-objects`, `local-workspace` (with `strategy`), `local-materialized` (fresh or container) |
| `fidelity` | `exact`, `approximate` (borrowed dependencies whose lockfiles differ) or `stale` (the working tree changed during the run) |
| `tree` | The examined Git tree hash |
| `prepared` | The prepare steps that applied (ID and key hash) |

Hosts show it as **From CI**, **Imported**, **Local**, **Approximate** or
**Stale**. A **parity check** (`projections check --parity REV`) extracts a
commit locally and compares it with CI's artifact for the same commit and
definition. It measures stability rather than raising an error: "varies between
this environment and CI run 4242 on 12% of items", naming the first items and
fields.

## Determinism and authority

Extractions are treated the way test results are
([the model](../models/domain-model/extension-points.md#determinism-and-authority)):
an extraction is an observation made by one run, determinism is desirable but
measured rather than enforced, and the run CI publishes is a commit's official
result. Execution follows from that:

- **Authority.** A CI artifact's extraction is `official: true`, with its
  repository and run, when the run is authenticated as the repository's own CI
  (downloaded from a run GitHub's API identifies, or attested); an
  unauthenticated import is `official: false`. Hosts show the official one for a
  commit by default. Every run records its environment fingerprint and time
  (`environment`, `at`).
- **Classes decide reuse.** `pure` extractions are cached by tree and reused
  from any environment; `environmental` ones only within the same environment
  fingerprint; `observed` ones are never cached, and a reused CI observation
  says when it was made.
- **Measured like flaky tests.** `projections check` reruns every extraction
  that isn't `observed` with nothing reused and warns, naming the items and
  fields that varied, when the runs differ; `--strict-determinism` fails
  instead, for built-ins in CI. The Engine's `vary` judges the two runs:
  differences at fields the extraction declares `volatile`, within their
  tolerances, are expected variation and pass; the parity check and scope
  verification judge the same way. An extractor declared `pure` that marks
  fields volatile gets a warning.
- **Comparators don't change.** They stay deterministic, and verification reruns
  them over recorded extractions, never re-extracting.

## The request, changed

`repository.root` names the directory the extractor reads: the user's checkout
in place, a workspace, or a temporary materialization. It is absent in
Git-object mode, where `repository.git` (`directory`, `tree`) names the object
store and the tree. `repository.mode` says which (`in-place`, `workspace`,
`materialized`, `git-objects`). `repository.checkout` now means where the
project's dependencies are installed for this run: the root itself in place or
in a prepared workspace, the user's checkout when dependencies are borrowed.
`repository.scope` lists the enforced scope. These are breaking changes,
recorded in the contracts.

## Measurements

Measured on an Apple Silicon Mac (64 GiB, APFS SSD) with a release build of
today's runner (before this change), Git 2.50, warm filesystem caches, single
runs (so treat differences under 0.1 s as noise). The repositories:

- **tiny**: an acme-like npm workspace, 6 files;
- **mid**: this repository, 1,900 files, 27.6 MiB tracked;
- **large**: kubernetes (shallow, 30 commits), 31,749 files, 269.6 MiB tracked.

Today's runner, the default `repository-map` (a read-only built-in):

| Operation             | tiny   | mid                 | large                             |
| --------------------- | ------ | ------------------- | --------------------------------- |
| `show <older commit>` | 0.12 s | 1.81 s, 87 MiB RSS  | fails: _Revision exceeds 256 MiB_ |
| `show <HEAD commit>`  | 0.11 s | 1.85 s              | fails                             |
| `show` (working tree) | 0.12 s | 2.01 s              | fails after 80.7 s of copying     |
| `compare older..HEAD` | 0.17 s | 5.27 s, 133 MiB RSS | fails                             |

The primitives the new paths are made of:

| Operation                                                      | tiny        | mid       | large      |
| -------------------------------------------------------------- | ----------- | --------- | ---------- |
| Commit identity: `rev-parse <commit>^{tree}`                   | 0.03 s      | 0.03 s    | 0.03 s     |
| Working-tree identity: temporary index, `add -A`, `write-tree` | 0.05 s      | 0.11 s    | 0.65 s     |
| Git objects: list the tree with sizes (`ls-tree -r -l`)        | 0.03 s      | 0.26 s    | 0.08 s     |
| Git objects: read every blob (`cat-file --batch`)              | 0.03 s      | 0.31 s    | 0.47 s     |
| Fresh: `git archive \| tar` of everything                      | 0.07 s      | 0.88 s    | 9.7 s      |
| Worktree: create                                               | 0.07 s      | 1.0 s     | 7.6 s      |
| Worktree: disk                                                 | ~0          | 31 MiB    | 384 MiB    |
| Worktree: switch between the two commits                       | 0.04–0.05 s | 0.2–2.0 s | 0.17–6.0 s |
| Worktree: switch to the same commit                            | 0.04 s      | 1.4 s     | 1.0 s      |
| Clone: APFS `clonefile` of the checkout                        | 0.07 s      | 1.7 s     | 10.4 s     |
| Clone: disk                                                    | ~0          | 5 MiB     | 22 MiB     |
| Sparse worktree of one directory: create                       | 0.06 s      | 0.16 s    | 0.12 s     |
| In place                                                       | 0           | 0         | 0          |

A second workspace's dependencies, for this repository (warm caches, scripts
off):

| Package manager                                             | First workspace | Second workspace |
| ----------------------------------------------------------- | --------------- | ---------------- |
| npm (`npm ci`)                                              | 11.3 s, 564 MiB | 8.9 s, 539 MiB   |
| pnpm (`pnpm install --frozen-lockfile`, root manifest only) | 6.0 s, 53 MiB   | 2.3 s, ~0 MiB    |

pnpm's figure covers only the root manifest: converting this npm workspace's
lockfile with `pnpm import` fails on its unpublished workspace packages, so it
is a lower bound on the work, not a like-for-like comparison. The shape holds:
npm copies every package into each workspace (half a gigabyte here), pnpm links
its global store. yarn classic copies like npm; it wasn't installed to measure.

The implemented paths, best of three runs of a release build, at a load average
under 10 (the today's-runner figures above were single runs, so compare
magnitudes rather than tens of milliseconds). On large, `repository-map` exceeds
its 10,000-node limit on the whole repository, so a definition limited to
`pkg/kubelet/**` stands in, applied with `--definition-revision working-tree`;
today's runner fails on large regardless, before extracting:

| Operation                                                  | tiny   | mid    | large  |
| ---------------------------------------------------------- | ------ | ------ | ------ |
| `show <older commit>`: Git objects                         | 0.14 s | 0.38 s | 0.95 s |
| `show <HEAD commit>`: Git objects                          | 0.14 s | 0.37 s | 0.93 s |
| `show` (working tree): in place, identity before and after | 0.24 s | 0.51 s | 1.96 s |
| `compare older..HEAD`                                      | 0.23 s | 1.53 s | 1.47 s |
| `show <older commit>`, cached                              | 0.12 s | 0.20 s | 0.83 s |
| `show` (working tree), cached                              | 0.20 s | 0.33 s | 1.23 s |

A toolchain extractor (a trivial custom command) on older kubernetes commits:

<!-- prettier-ignore -->
| Workspace | Time | Disk |
|---|---|---|
| `worktree`, first use (creates it) | 11.9 s | 351 MiB |
| `worktree`, switching 10 commits | 8.2 s | |
| `worktree`, the same commit again | 2.6 s | |
| `clone`, first use (APFS clone of the checkout, then a checkout) | 24.1 s | 351 MiB apparent, mostly shared blocks |
| `clone`, switching | 3.0 s | |
| `fresh` | fails: kubernetes exceeds the 256 MiB copy cap | |

The automatic strategy for kubernetes on this machine is `worktree` (31,749
files, 269.6 MiB tracked, 690 GiB free).

What they mean:

- **Read-only built-ins stop copying.** On mid, today's 1.8 s per commit was
  almost all materialization; listing the tree with sizes is 0.26 s and reading
  every blob 0.31 s. On large, today's runner can't run at all; Git-object reads
  take under half a second.
- **The working tree costs its identity, not a copy.** 0.65 s on kubernetes
  versus a failed 80 s copy.
- **A persistent worktree beats a fresh copy after the first use.** Creating one
  costs about as much as one fresh copy (7.6 s versus 9.7 s on large), and every
  later switch costs only the changed files, while each fresh copy pays the full
  price again and keeps no dependencies.
- **Copy-on-write clones are nearly free on disk** (22 MiB for kubernetes) but
  not in time (10 s, dominated by metadata), so `clone` is for disk-bound
  machines, not speed; `none` remains for the largest.
- **npm and yarn classic dominate a second workspace's cost**, which is why
  prepare keys skip installs when lockfiles match, and why `doctor` names them.

## Not done

- **Process-level read sandboxing** of toolchain extractors (a macOS sandbox
  profile, Linux Landlock) to enforce a scope in place. Scopes are enforced only
  where reads are mediated.
- **Running the devcontainer** named by the environment. It is reported, not
  used.
