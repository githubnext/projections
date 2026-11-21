# Definitions and execution

## Projection definitions

Running `init` creates a new projection definition in `.github/projections` by
default, or you can pass `--definition-directory .projections` to use the
alternative location. Discovery reads direct `.json` files from **both**
directories, sorts them by ID, and rejects duplicate IDs (even if the files are
identical), symlinked definitions or parent directories, and unknown
configuration fields. Nested input directories are never searched for
definitions. Projection IDs and renderer names must be filename-safe, while
entity IDs can be any valid Unicode string allowed by the engine.

When a repository has no definitions of its own, Projections falls back to the
built-in defaults: `workspace-dependencies` (if the root has a `package.json`)
and `repository-map`. Once you add your own definitions, those defaults no
longer appear in listings, though you can still target them explicitly by ID
(for example `show -p repository-map`) unless one of your definitions reuses
that ID.

### Nested projects

Definitions belong to a project, which defaults to the repository root. Any
subdirectory inside the repository that has its own `.github/projections` or
`.projections` folder is also treated as a project, making it easy for each
package in a monorepo to maintain its own projections:

- When you run a command inside that directory (or point `-C` at it),
  Projections walks up to the repository root and uses the nearest directory
  containing definitions as the active project. Only that project's definitions
  are discovered—the root's and other projects' definitions are ignored.
- You can pass `--root DIR` (relative to the `-C` directory) to pick a project
  explicitly, even if it doesn't have definitions yet.
- Each project owns its own `.projections-bookmarks.json` and
  `environment.json`, and `init` and `adopt` write into it. Likewise, `explore`
  only inspects that project's files. In CI, set the Action's
  `working-directory` to target it
  ([Add Projections to CI](../setup/ci.md#where-it-goes)).
- Every path inside a definition—extractor commands and `sources`, comparator
  files, renderer bundles, `execution.scope`, and inputs—is resolved relative to
  the project, and extractors run with the project as their working directory
  (`.github/projections/x/extract.mjs`, not
  `packages/app/.github/projections/x/extract.mjs`). Built-in extractors treat
  the project as their root too, keeping paths and entity IDs relative to it.
  The request reports the project path in
  [`repository.project`](../contracts/extractors.md), relative to
  `repository.root`.

Because paths are project-relative, a definition moves cleanly with its project.
A directory that lives as a nested project in a monorepo can be published as its
own standalone repository (or exported via `git archive HEAD:packages/app`) and
the exact same definition keeps working—something repository-root paths couldn't
do. Paths are resolved lexically against the project, so a path may climb upward
with leading `../` segments, but never outside the repository; any path that
escapes the repository makes the definition invalid and names the offending
field.

By default, a nested project's [scope](#scopes) is its own directory unless its
definition declares `execution.scope` or its built-in implies one. If an
extractor needs to read files outside the project—such as a shared folder or a
root lockfile—widen the scope explicitly using `.` for the project itself and
`../` for everything else:

```json
"execution": {"scope": [".", "../../package-lock.json", "../shared"]}
```

A scope path that resolves to the repository root (such as `..` from a top-level
project) covers the whole revision. The project path is also part of the
definition's identity: it feeds into `definitionDigest` and cache keys, and each
project has its own generation store, so definitions in `a/` and `b/` with
identical relative paths never collide.

## Exact source and explicit execution

Projections extracts each revision in the cheapest place that still guarantees
exact results (see the [local execution design](../design/local-execution.md)
for the rationale and benchmarks). Files are only copied to disk when a
toolchain needs a revision that isn't currently checked out:

<!-- prettier-ignore -->
| Revision | Extractor | Where it runs | `provenance.execution.source` |
|---|---|---|---|
| The working tree | Any | In place, in the checkout | `local-in-place` |
| A commit that is the checkout's `HEAD`, with no changes (with `--in-place`, with only untracked ones) | A toolchain or custom extractor | In place | `local-in-place` |
| Any commit | A built-in that only reads files (`access: files`, shown by `projections extractor view`) | Git objects, with nothing on disk | `local-git-objects` |
| Another commit | A toolchain or custom extractor | A temporary copy | `local-materialized` |
| Any, with container isolation | Repository-owned commands | A temporary copy, mounted read-only | `local-materialized` |

Commit refs are resolved once to immutable Git object IDs. When reading from Git
objects directly (`ls-tree` and `cat-file`), Projections bypasses archive
attributes, `export-ignore`, `export-subst`, smudge filters, hooks, checkouts,
stashes, index rewrites, and branch switches. Temporary copies write the exact
blobs and executable bits. Internal relative symlinks are preserved, while
escaping or absolute symlinks and path traversal are rejected during copy; when
reading in place, the SDK reports symlinks as symlinks without following them,
and adapters guard their input paths against symlink traversal.

Like `git archive`, submodule gitlinks and other special entries (plus nested
repositories and special files in the working tree) are skipped, with up to 10
skipped paths listed in provenance `limitations` and comparison notices. If a
definition explicitly requires a skipped path—such as a declared source or
extractor program inside a submodule—extraction fails and names the submodule.
On Windows, symlinks are skipped the same way because creating them requires
Developer Mode or administrator rights; extractors that depend on symlinks
should run on Unix or inside a container.

For the working tree, Projections sees the same files Git does: tracked files as
they currently exist on disk, plus untracked non-ignored files, respecting
deletions. File-only built-ins see that exact set (the SDK refuses ignored
paths), so their extraction depends solely on the working tree's Git tree hash,
computed with a temporary index seeded from the real one (`git add -A`,
`git write-tree`) without touching your index or refs. Toolchain extractors
running in place can also read ignored files like installed dependencies and
build caches, just like tests do, so those caches persist across runs.

To catch concurrent edits during an in-place run, Projections records the
working tree's identity before and after execution; if the tree changed
mid-extraction, `provenance.execution.fidelity` is marked `stale` with a
matching limitation instead of pretending the result matches either state.
Working-tree extractions record their actual dirty flag and base commit, and
cannot be exported as clean immutable commit artifacts. Temporary copies are
always cleaned up on success, failure, and abort, and neither temporary paths
nor your checkout path are ever persisted in documents.

Every comparison applies **one** projection definition—and one version of its
component code—to both revisions. By default, that is the base (first)
revision's definition, matching pull request review so a change cannot reshape
how it is explained. Pass `--definition head` to use the head revision's
definition instead. If the chosen definition revision doesn't define the
projection, the CLI returns an explicit error suggesting an option that works:
`--definition` for the other revision if it defines the projection, or
`--definition-revision` pointing to the working tree (or `HEAD`). For
`bookmark run`, if neither revision defines the projection, it falls back to the
working tree's definition automatically with a notice.

Because the extractor program always comes from the definition revision,
relative `extractor.command` paths and the process working directory resolve in
the definition's project there, while `request.repository.root` points to the
directory holding the revision being examined (with the project at
`request.repository.project` inside it). Extractors must therefore read
repository files through `request.repository.root`. When a toolchain runs on a
temporary copy, it borrows installed dependencies from your checkout via
`request.repository.checkout`; there are no hidden fixture inputs or automatic
dependency repairs, and any installed-language executable argv extractor works
without an SDK.

One consequence is worth keeping in mind: **any file read relative to the
working directory or the extractor's own location comes from the definition
revision on both sides**, regardless of which revision is being examined. In
`compare HEAD~1..HEAD`, both sides would read `HEAD~1`'s copy and show no
change. Neither `determinism`, `execution.scope`, nor the cache can fix that,
because they describe the examined revision that such a read bypasses. Put the
extractor's own code and configuration in `sources` (so they are intentionally
read from the definition revision and included in its digest, with a notice when
the other revision changes them), and read all repository data through
`request.repository.root`. Running [`projections check`](commands.md) catches
this mistake by re-running custom extractors from a copy containing only the
definition's own files (definition directories, declared sources, and command
paths) while keeping the working tree at `root`, warning if the output differs
or fails.

Built-in extractors run under the exact same pipeline as custom ones. The runner
launches each as a subprocess of the CLI itself (`projections __extract <id>`),
passing the built-in definition's request on stdin under the same supervision,
environment allowlist, timeout, output limits, and trust rules, and then
decodes, normalizes, and records the result identically. Only the provenance
differs: it names the built-in, and built-ins that run no tools or repository
code need no trust. The CLI passes `--helpers` or `--cache-dir` so the
subprocess can locate its own helpers despite the restricted environment.
Container isolation remains limited to repository-owned extractor commands
because the container image doesn't include the Projections executable.

Every saved extraction records its definition and `definitionDigest`: the
SHA-256 of the RFC 8785 canonical definition, followed (for nested projects) by
its project directory, followed by the repository path and bytes of every file
under each declared `sources` path across the extractor, comparator, and
renderer (plus the comparator file itself) from the definition revision in
sorted order. Two extractions can be compared only if their digests match;
otherwise the error tells you whether the definition itself or its declared
component sources differ.

If the other revision defines the projection differently, the comparison still
runs and surfaces a **notice** explaining whether the other revision changed the
definition, changed its declared component sources, or doesn't define the
projection, and suggesting `--definition head` (or `base`) to run that
revision's code. Text output prints notices ahead of the steps, and comparison
documents include them in `notices`.

### Comparators

Comparisons are produced by the projection's comparator. The built-in default
comparator is a WebAssembly module embedded in the CLI
(`default-comparator.wasm`) that runs in the same sandbox as custom comparator
files; it is identified by its module digest (`comparator.id` `default`), and
its options are validated by running it. A definition can configure the default
comparator directly:

```json
"comparator": {"options": {"order": {"by": "dependents", "direction": "descending"}}}
```

Or it can point to a custom comparator file—the only supported kind of custom
comparator—which is a YAML file (`<name>.comparator.yaml`) defining identity
passes, classifications, and step orders in CEL (see
[Custom comparators](../guides/comparators.md)). Reference it either as a bare
path or as `{file, sources?, options?}`:

```json
"comparator": ".github/projections/priority.comparator.yaml"
"comparator": {"file": ".github/projections/priority.comparator.yaml", "options": {"priority": ["package:core"]}}
```

A string or an object containing `file` selects a custom comparator; an object
without `file` configures the default comparator. Using the removed
`comparator.rules` key or a filename that doesn't end in `.comparator.yaml` or
`.comparator.yml` is rejected with migration instructions.

The runner reads the comparator file from the definition revision (it must be a
regular file, not behind a symlink, and at most 64 MiB) and executes it inside
the embedded `rules.wasm` interpreter running on `wasmi`. The interpreter
validates the file (reporting every issue with its YAML line and column),
computes the default baseline, and applies the rules within a fuel budget, a 256
MiB memory cap, 32 MiB input/output caps, and the comparator's deterministic
cost budget. Any invalid file, exhausted budget, failed check or expression, or
Engine validation failure produces an explicit error—the baseline is never
silently substituted.

Each comparison records
`comparator: {id: <comparator file path>, digest: <comparator digest>}`, where
the digest reflects the file's semantics (ignoring comments and formatting) and
the interpreter language (see
[comparator files](../contracts/comparisons.md#comparator-files)). Because
comparators have no access to files, the network, the clock, or randomness,
running them never requires `--trust`.

When comparing saved extractions that use a custom comparator, supply the
comparator file from the definition revision with `--comparator FILE`. Running
`validate --comparator FILE` re-executes the comparator and checks for an
identical result; without that flag, `validate` and the Inspector still verify a
saved custom comparison against both extractions through the Engine (ensuring it
cannot hide or invent changes), though they cannot reproduce its ordering and
summaries.

Passing `--trust` explicitly authorizes local execution of the projection's
extractor—and any code or subprocesses it runs—on **both revisions**. Without
it, custom argv extractors and tool-executing adapters fail before running,
reporting `TRUST_REQUIRED` in batch and Inspector results (other runner failures
report `RUNNER_ERROR`). Parser-only built-ins can read repository data without
trust. `--trust` also authorizes a custom renderer that differs from the default
branch's bundle; see [Trust](../contracts.md#trust) for the full policy and the
self-navigation threat it mitigates. Declarations like `network: false` or
`hermetic` are metadata, not sandboxes, and normal local runs honestly report
`local` provenance rather than claiming a hermetic environment.

The runner copies environment variables from the invocation environment rather
than mutating `process.env`. Both built-in and custom extractors receive only
`PATH`, Windows `SystemRoot`, deterministic locale and timezone settings, and
variables explicitly listed in `execution.environment` (see
[process](../contracts/extractors.md#process)). `HOME`, tokens, proxies, loader
hooks, and other ambient variables are never forwarded automatically. If a
built-in extractor needs user caches or tool configuration—such as Go's module
cache, the NuGet packages folder, or a JDK via `JAVA_HOME`—the definition must
grant those variable names explicitly. Allowlisted values are never written to
provenance, cache keys, or manifests, though extractors should still avoid
printing secrets since stdout becomes extraction data and raw stderr is shown in
local errors and the Inspector. Django `inputs.env` is rejected in favor of the
per-invocation environment plus allowlist.

Extractors have a 30-second default timeout (up to 300 seconds maximum), an 8
MiB stdout limit, and a 64 KiB stderr limit. Because the timeout covers the
extractor and every tool it spawns, built-in extractors that invoke a build
(.NET, Spring, Go) or run the TypeScript compiler on a large codebase typically
need a higher `execution.timeoutMs`—and declaring a scope helps keep them fast
by limiting what they read. If an extractor times out, the error names
`execution.timeoutMs`.

Executables are always spawned directly without a shell. Timeouts, aborts,
output overflows, missing tools, nonzero exit codes, invalid UTF-8, JSON, or
extractions, and cleanup failures all surface as explicit errors. When a run
finishes, fails, or is cancelled, the runner terminates the extractor and all of
its descendant processes together: on Unix by freezing and killing its process
group, and on Windows by starting it suspended inside a kill-on-close,
no-breakaway Job Object that is terminated until empty (and automatically kills
the tree if the CLI exits abruptly). Ctrl+C, Ctrl+Break, and console close
cancel cleanly just like SIGINT and SIGTERM.

Temporary copies are capped at 50,000 files and 256 MiB (override the byte limit
with `PROJECTIONS_MAX_COPY_BYTES`) with no truncation-to-success. If a revision
exceeds that cap, the runner copies only the definition's scope plus its own
files (definition directories, declared sources, and command paths) when a scope
is declared and records that in provenance; without a scope, the run fails and
names `execution.scope`. Revisions read in place or from Git objects have no
copy cap.

## Scopes

By default, an extraction depends on the entire revision—or, for a
[nested project](#nested-projects), on the project's own directory—which is
always safe. To narrow that dependency set, declare `execution.scope` with
project-relative file and directory paths (not globs; `.` means the project
itself, and `../` widens a nested project's scope beyond it):

```json
"execution": {"scope": ["api", "package.json"]}
```

A few built-ins infer a default scope from their inputs: `github-actions-jobs`
scopes to its `workflowPath`, `prisma-schema` to the `schema`, `schemas`, or
`snapshot` it names, and `nuget-dependencies` to its `assetsPaths`. An explicit
`execution.scope` always overrides the inferred one.

Scopes are enforced wherever the runner mediates reads, and trusted only when
enforced or verified:

- **Reads through the extractor SDK** (both Git objects and in-place runs) hide
  files outside the scope and fail loudly if an extractor tries to read one
  (`read …, outside its declared scope`). The request also passes the resolved
  repository-relative scope as `repository.scope`.
- **Workspaces** using the `sparse` strategy check out only the declared scope.
- **`projections check`** re-extracts the working tree from a copy containing
  only the scope and compares the results. If they match, the scope is recorded
  as verified for that definition digest in `scopes/<repository>.json` inside
  the per-user cache; if they differ, it warns and lists what changed so you
  know the extractor read outside its scope. CI runs `check` as well.

When a scope is enforced (a built-in reading through the SDK) or verified, the
[extraction cache](caches.md#extraction-cache) keys the extraction by the
scope's Git objects instead of the full tree, so edits outside the scope still
hit the cache; otherwise any edit is a cache miss. The applied scope is recorded
in `provenance.execution.scope`, and `GET /api/identity` exposes `scope`,
`scopedTree`, and `scopeVerified`. Toolchain extractors running in place or in a
full workspace are not yet confined at the OS process level—enforcing that with
a macOS sandbox profile or Linux Landlock remains future work.
