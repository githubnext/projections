# Local execution: materialize only as a last resort

Status: **adopted**. This note explains how the CLI decides where an extractor
runs, where its dependencies come from, and why. See
[the runner docs](../runner/execution.md#exact-source-and-explicit-execution)
and [the extractor contract](../contracts/extractors.md) for the formal spec;
the benchmarks that drove this design are [below](#measurements).

## The problem

Running Projections in CI is like running tests in CI: the pipeline sets up the
environment (checkout, toolchain, `npm ci`), and the run just uses it. Running
locally is harder because your checkout only matches one revision — the one
currently checked out.

Previously, the runner handled every revision the same way — even the working
tree and CI's own checkout. It dumped the entire revision into a temporary
directory (via `ls-tree` and `cat-file`, or by copying the working tree), ran
the extractor there, and deleted the copy afterward. Dependencies were borrowed
from your checkout through `request.repository.checkout`, meaning an older
commit was quietly analyzed against today's `node_modules`, and nothing was
cached across runs. That caused four real problems:

- **Wasteful.** A read-only extractor that only needed three manifests still
  paid to write out 50,000 files, and CI paid to duplicate its own checkout.
- **Hard limits.** Any repository over 256 MiB or 50,000 files couldn't be
  extracted at all ([kubernetes](#measurements) is 270 MiB).
- **Quietly approximate.** A toolchain extractor running on an older commit used
  today's installed dependencies without telling anyone.
- **Forgetful.** Comparing `main` against your working tree re-extracted `main`
  from scratch every single time.

Declared file paths alone don't solve this. An extractor might declare its
top-level entry files and then chase their imports, so a declaration is just a
promise until something enforces it. Nor is there one strategy that fits every
repo: some repositories are too large for two copies on one laptop, while small
repos can effortlessly keep several worktrees. The right choice depends on the
repository, its package manager, the machine, and the developer.

## Principles

1. **Run where the files already are.** The working tree and CI's checkout are
   already the revision — extract them in place, just like running tests.
2. **Read Git directly instead of copying.** An extractor that only reads files
   can read them straight from the Git object store.
3. **Copy only for a toolchain on another revision.** Running `tsc`, `dotnet`,
   or `go list` against a commit that isn't checked out is the only case that
   needs files on disk, and even then a reused, prepared workspace beats a fresh
   copy.
4. **Derive identity from Git.** What an extraction depends on is identified by
   Git's own hashes, not hand-written declarations.
5. **Be transparent about what happened.** Every extraction records where it
   came from and how faithful it is, so nothing approximate is ever passed off
   as exact.
6. **The repository declares its environment; the machine picks the strategy.**
   The team knows how to install dependencies (just like in CI); the developer's
   machine knows how many copies it can afford.

## Per side: the cheapest trustworthy source

For each side of a show or comparison, the runner picks the first source that
applies:

<!-- prettier-ignore -->
| Source | When | Cost |
|---|---|---|
| **Cache** | The same definition digest, Git tree and environment fingerprint were extracted before, on this machine | A file read |
| **CI artifact** | A commit CI already extracted with the same definition digest, and artifacts are enabled (`--ci`, `--artifact DIR`) | A verified download, once |
| **In place** | The working tree; or a commit that is `HEAD` of a clean checkout (always in CI, with `--in-place` for a checkout with untracked build output) | None |
| **Git objects** | A built-in extractor that declares it only reads files (`access: files`), on any commit | Reading the blobs it asks for |
| **Workspace** | A toolchain or custom extractor on a commit that isn't checked out | Switching a reused workspace (see [strategies](#workspace-strategies)) |

In-place runs capture the working tree's identity (its tree hash, explained
below) both before and after extraction. If the user or the extractor modifies
the working tree mid-run, the result is marked **stale** and never cached so it
can't silently lie. Ignored incremental build caches (`obj/`, `target/`,
`.tsbuildinfo`) stay intact and speed up subsequent runs.

Git-object reads go straight through the extractor SDK. Because `read_source`
and the file-listing helpers already mediated every read made by read-only
built-ins, they now pull from a reader backed by either a directory or the Git
object store — transparently to the extractor. A read-only built-in opts in with
`access: files` in its descriptor. In place, that same reader lists only what
Git sees (tracked plus non-ignored untracked files) and rejects ignored paths,
guaranteeing a working-tree extraction depends strictly on what its tree hash
covers.

## Identity from Git, and a persistent cache

Each cache key is the SHA-256 of:

- the **definition digest** (the canonical definition plus its declared
  sources);
- the examined revision's **Git tree hash**, along with the definition
  revision's tree hash when they differ (since its program might read undeclared
  files);
- the access mode;
- for `environmental` extractions, an **environment fingerprint**: the
  Projections version, `PATH`, hashed values of granted environment variables
  (never stored in plaintext), outputs of the environment file's `toolchain`
  commands, and hashes of the prepare keys' files (or well-known lockfiles when
  no environment is declared). `pure` extractions omit this fingerprint, and
  `observed` extractions are never cached
  ([determinism](#determinism-and-authority)).

A commit's tree hash is essentially free (`rev-parse <commit>^{tree}`). For the
working tree, we compute it using a temporary index seeded from the real one,
followed by `git add -A` and `git write-tree`. Git only rehashes files whose
stat metadata changed, leaving your real index and refs untouched. Any changed
files get written as loose blobs in the object store (just like `git stash`),
which `git gc` cleans up normally.

The cache lives in the per-user cache directory (`extractions/<repository>/`,
keyed by the repository's Git common directory). Both the CLI and
`serve --stdio` share it, and it evicts least-recently-used entries once it hits
its cap (512 MiB by default, configurable via
`PROJECTIONS_EXTRACTION_CACHE_BYTES`). Deleting the cache directory is always
safe, `--no-cache` skips it, and every cache hit is revalidated (schema, digest,
and definition digest) before use.

**What isn't cached:** toolchain extractions of the working tree. Because they
can depend on ignored files like installed packages or generated code that the
tree hash doesn't see, they always re-run. Read-only extractions of the working
tree _are_ cached because they can only read what the tree hash covers.

## Scopes: optional, and enforced

By default, an extraction depends on the whole revision, which is always safe. A
definition (`scope`) or a built-in (derived from its inputs) can narrow that to
specific repository-relative files or directories. We use literal paths rather
than globs because Git can hash any subtree for free (`rev-parse <tree>:<path>`)
and sparse checkouts take paths. Narrower scopes are enforced wherever reads are
mediated:

- **Git-object and in-place reads** through the SDK reject any path outside the
  scope (naming the offending path) and only list files inside the scope.
- **Workspaces** using the `sparse` strategy check out only the scoped paths.
- **`projections check`** runs extraction once with the scope enforced (sparse
  materialization) and once without, marking the scope as verified for that
  definition digest only if both outputs match. CI runs `check` as well.

Scoped extractions cache by their subtree hashes, so edits outside the scope hit
the cache — but only when the scope is enforced (Git-object reads) or verified;
otherwise the cache falls back to the full tree hash so outside edits safely
miss. In-place toolchain extractors aren't sandboxed at the OS process level
yet; adding macOS sandbox profiles or Linux Landlock to block out-of-scope reads
remains future work.

## The environment: `prepare`

A repository can declare how to set up a runnable environment once — just like
in CI — in `.github/projections/environment.json` (or
`.projections/environment.json`; that filename is reserved so discovery won't
mistake it for a projection definition):

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

**How prepare steps run.** Before a toolchain extractor executes in a workspace,
the runner executes each prepare step in order — skipping any step whose key
hash (covering matched file paths and contents, argv, directory, and environment
variable names) matches the last successful run in that workspace. Each run logs
its key, duration, exit status, and up to the last 4 MiB of output. Because
prepare steps run repository code, they require `--trust` just like extractors
and never run when untrusted. Unlike extractors, they may access the network.
Each step honors its timeout, cancels with the parent operation, and names both
the failing step and its log on error.

We always use the **examined** revision's environment file — just as CI uses
each commit's own workflow — so an older commit with a different package manager
still prepares the way it used to.

**Your working tree stays untouched.** Nothing runs there automatically. You can
run `projections prepare` on demand for the working tree, or
`projections prepare --revision REV` for a specific revision's workspace.
`projections doctor` reports the declared environment, what each workspace has
prepared, which steps are stale, and any missing tools.

**Global stores make a second workspace cheap.** Package managers with a
machine-wide store — pnpm, Go modules, Cargo, NuGet, and uv — mostly just create
links in a second workspace. npm and yarn classic copy every package into each
`node_modules`, making them the expensive outliers ([measured](#measurements)).

**When no environment is declared.** A toolchain extractor on another commit
falls back to borrowing your checkout's dependencies via
`request.repository.checkout`, just as before — except now the runner compares
well-known lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`,
`Cargo.lock`, `go.sum`, `packages.lock.json`, `poetry.lock`, `uv.lock`,
`Pipfile.lock`, `Gemfile.lock`, `composer.lock`) between the examined revision
and your working tree. If any differ, the extraction is tagged **approximate**
with a limitation listing the mismatched lockfiles.

### CI and the base side

In CI, the Action extracts both the merge base and the head. The head runs in
place on CI's checkout with zero copying. For the merge base, the Action first
fetches that commit's `projections` artifact from its latest successful push run
(in a separate step that holds the token and executes nothing) and hands it to
the CLI via `--artifact`. The CLI verifies the artifact and reuses every
extraction whose definition digest matches. Any missing projections run in a
workspace using declared `prepare` steps (under `trust: true`), or borrow CI's
checkout and get marked approximate if lockfiles differ.

## Workspace strategies

<!-- prettier-ignore -->
| Strategy | What | For |
|---|---|---|
| `fresh` | A temporary full copy per run, as before | Tiny repositories |
| `worktree` | One persistent linked Git worktree that Projections owns, under the user cache directory. Switching revisions rewrites only changed files, keeps ignored files (prepared dependencies, build caches) and removes untracked ones | The default |
| `clone` | A worktree seeded with a copy-on-write clone of the checkout (APFS `clonefile`, btrfs/XFS reflink), so the user's installed dependencies come along for free; then as `worktree`. Falls back to `worktree`, and says so, where the filesystem can't clone | Large repositories with large dependency trees |
| `sparse` | A worktree limited to the definition's scope | Very large repositories with scoped projections |
| `none` | No extra copies: cache, CI artifacts and in-place only; a toolchain extraction of another commit fails, saying how to get one | Repositories too large for a second copy |

**Precedence** runs from machine preference, to team preference, to automatic:

1. `--workspace STRATEGY`, the VS Code `projections.workspace` setting (passed
   as `--workspace`), or `config.json` in the per-user config directory
   (`{"workspace": "clone"}` globally, or per repo with
   `{"repositories": {"/abs/path": {"workspace": "none"}}}`);
2. `workspace.strategy` in the repository's environment file;
3. automatic fallback: `fresh` below 2,000 files and 20 MiB; otherwise
   `worktree` if free disk space is at least 4× the tracked size; otherwise
   `clone` if the filesystem supports copy-on-write; otherwise `none`.

`projections doctor` tells you which strategy won and why. Each workspace takes
an OS file lock while in use; concurrent runs grab the next slot (up to four per
repository) or wait. Use `projections workspace list` to inspect them (strategy,
revision, prepared steps, disk size) and `projections workspace clean` to remove
them.

## Provenance

Every extraction records `provenance.execution`:

<!-- prettier-ignore -->
| Field | Values |
|---|---|
| `source` | `ci` (a CI artifact), `local-in-place`, `local-git-objects`, `local-workspace` (with `strategy`), `local-materialized` (fresh or container) |
| `fidelity` | `exact`, `approximate` (borrowed dependencies whose lockfiles differ) or `stale` (the working tree changed during the run) |
| `tree` | The examined Git tree hash |
| `prepared` | The prepare steps that applied (ID and key hash) |

Hosts surface this as **From CI**, **Imported**, **Local**, **Approximate**, or
**Stale**. You can also run a **parity check**
(`projections check --parity REV`) to extract a commit locally and compare it
against CI's artifact for the same commit and definition. Rather than failing
hard, it reports drift — for example, "varies between this environment and CI
run 4242 on 12% of items", naming the first differing items and fields.

## Determinism and authority

Extractions behave like test results
([the model](../models/domain-model/extension-points.md#determinism-and-authority)):
each extraction is an observation from one run, determinism is measured rather
than blindly assumed, and CI's published run is a commit's official record. That
drives four rules:

- **Authority.** An extraction from an authenticated CI run (fetched from a run
  identified by GitHub's API, or attested) is marked `official: true` with its
  repository and run; an unauthenticated import gets `official: false`. Hosts
  prefer the official result by default, and every run records its `environment`
  fingerprint and timestamp (`at`).
- **Determinism classes govern reuse.** `pure` extractions cache by Git tree and
  reuse across any environment; `environmental` extractions reuse only when the
  environment fingerprint matches; `observed` extractions are never cached, and
  a reused CI observation displays when it was recorded.
- **Flakiness is measured like flaky tests.** `projections check` re-runs every
  non-`observed` extraction without cache reuse and warns if the two runs
  differ, listing the items and fields that moved (passing
  `--strict-determinism` turns that into a failure for built-ins in CI). The
  Engine's `vary` check handles expected variation — fields marked `volatile`
  within their tolerances pass, and parity checks and scope verification use the
  same logic. A `pure` extractor that marks fields volatile triggers a warning.
- **Comparators stay deterministic.** Verification always re-runs comparators
  over recorded extractions without re-extracting.

## The request, changed

`repository.root` points to the directory the extractor reads (your checkout in
place, a workspace, or a temporary materialization). It is omitted in Git-object
mode, where `repository.git` (`directory`, `tree`) points to the object store
and tree instead. `repository.mode` states which mode is active (`in-place`,
`workspace`, `materialized`, or `git-objects`). `repository.checkout` now points
to where dependencies live for the run — the root itself when in place or in a
prepared workspace, or your checkout when borrowing dependencies.
`repository.scope` carries the enforced scope. These are breaking request
changes and are documented in the contracts.

## Measurements

All measurements ran on an Apple Silicon Mac (64 GiB RAM, APFS SSD) with a
release build of the previous runner, Git 2.50, and warm filesystem caches
(single runs, so treat differences under 0.1 s as noise). We tested three
repositories:

- **tiny**: an acme-like npm workspace (6 files);
- **mid**: this repository (1,900 files, 27.6 MiB tracked);
- **large**: kubernetes, shallow clone of 30 commits (31,749 files, 269.6 MiB
  tracked).

Baseline with the previous runner on the default `repository-map` (a read-only
built-in):

| Operation             | tiny   | mid                 | large                             |
| --------------------- | ------ | ------------------- | --------------------------------- |
| `show <older commit>` | 0.12 s | 1.81 s, 87 MiB RSS  | fails: _Revision exceeds 256 MiB_ |
| `show <HEAD commit>`  | 0.11 s | 1.85 s              | fails                             |
| `show` (working tree) | 0.12 s | 2.01 s              | fails after 80.7 s of copying     |
| `compare older..HEAD` | 0.17 s | 5.27 s, 133 MiB RSS | fails                             |

Underlying primitives that power the new paths:

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

Installing dependencies in a second workspace for this repository (warm caches,
lifecycle scripts disabled):

| Package manager                                             | First workspace | Second workspace |
| ----------------------------------------------------------- | --------------- | ---------------- |
| npm (`npm ci`)                                              | 11.3 s, 564 MiB | 8.9 s, 539 MiB   |
| pnpm (`pnpm install --frozen-lockfile`, root manifest only) | 6.0 s, 53 MiB   | 2.3 s, ~0 MiB    |

Note that pnpm's number only covers the root manifest — `pnpm import` fails on
this repo's unpublished workspace packages — so treat it as a lower bound rather
than a direct apples-to-apples comparison. The takeaway is still clear: npm
duplicates half a gigabyte into every workspace, whereas pnpm links from its
global store. yarn classic copies like npm (not installed on the test machine).

Here are the implemented paths (best of three release runs at load average under
10; compare order of magnitude against the single-run baselines above). On
large, `repository-map` hits its 10,000-node cap on the full kubernetes tree, so
we used a definition scoped to `pkg/kubelet/**` with
`--definition-revision working-tree` (the old runner failed before extraction
either way):

| Operation                                                  | tiny   | mid    | large  |
| ---------------------------------------------------------- | ------ | ------ | ------ |
| `show <older commit>`: Git objects                         | 0.14 s | 0.38 s | 0.95 s |
| `show <HEAD commit>`: Git objects                          | 0.14 s | 0.37 s | 0.93 s |
| `show` (working tree): in place, identity before and after | 0.24 s | 0.51 s | 1.96 s |
| `compare older..HEAD`                                      | 0.23 s | 1.53 s | 1.47 s |
| `show <older commit>`, cached                              | 0.12 s | 0.20 s | 0.83 s |
| `show` (working tree), cached                              | 0.20 s | 0.33 s | 1.23 s |

A trivial custom toolchain extractor running on older kubernetes commits:

<!-- prettier-ignore -->
| Workspace | Time | Disk |
|---|---|---|
| `worktree`, first use (creates it) | 11.9 s | 351 MiB |
| `worktree`, switching 10 commits | 8.2 s | |
| `worktree`, the same commit again | 2.6 s | |
| `clone`, first use (APFS clone of the checkout, then a checkout) | 24.1 s | 351 MiB apparent, mostly shared blocks |
| `clone`, switching | 3.0 s | |
| `fresh` | fails: kubernetes exceeds the 256 MiB copy cap | |

Automatic selection picks `worktree` for kubernetes on this machine (31,749
files, 269.6 MiB tracked, 690 GiB free).

Key takeaways:

- **Read-only built-ins stop copying altogether.** On mid, nearly all of the old
  1.8 s per commit was materialization; listing the tree with sizes takes 0.26 s
  and reading every blob takes 0.31 s. On large, where the old runner couldn't
  run at all, Git-object reads finish in under half a second.
- **The working tree only pays for hashing, not copying:** 0.65 s on kubernetes
  versus an 80-second copy that failed anyway.
- **A persistent worktree pays off after the very first run.** Creating one
  costs roughly the same as a fresh copy (7.6 s vs. 9.7 s on large), and every
  subsequent switch only rewrites changed files while keeping installed
  dependencies warm.
- **Copy-on-write clones save disk, not time.** They use almost no extra disk
  space (22 MiB for kubernetes) but take 10 s due to filesystem metadata work,
  so `clone` is meant for disk-constrained machines while `none` covers the
  largest repos.
- **npm and yarn classic dominate second-workspace setup cost**, which is why
  prepare keys skip installs whenever lockfiles match and why `doctor` calls
  them out.

## Not done

- **Process-level read sandboxing** for in-place toolchain extractors (macOS
  sandbox profiles or Linux Landlock). For now, scopes are only enforced where
  reads are mediated.
- **Running the declared devcontainer.** `doctor` reports it, but Projections
  does not execute inside it yet.
