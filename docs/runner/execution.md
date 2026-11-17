# Definitions and execution

## Projection definitions

`init` creates one new definition, defaulting to `.github/projections`; select
`--definition-directory .projections` for the other supported location.
Discovery reads direct `.json` files in **both** locations, sorts by ID, rejects
duplicate IDs (even identical definitions), rejects symlinked definitions or
parent directories and unknown configuration fields. Nested input directories
are not definition search roots. IDs/renderers use filename-safe names; entity
IDs remain arbitrary valid Unicode as specified by the engine.

A repository with no definitions of its own uses the built-in defaults
(`workspace-dependencies`, when the root has a `package.json`, and
`repository-map`). Once it defines projections the defaults are no longer
listed, but they stay addressable by ID (`show -p repository-map`) until one of
its definitions uses that ID.

### Nested projects

Definitions belong to a project: the repository's root by default. A directory
inside the repository that has its own `.github/projections` or `.projections`
is a project too, so each workspace of a monorepo can keep its projections:

- Run from inside it (or `-C` it) and the nearest such directory, from there up
  to the repository's root, is the project. Its definitions are the only ones
  discovered; the root's, and other projects', are not.
- `--root DIR` (relative to the `-C` directory) names the project instead, even
  one without definitions yet.
- Its `.projections-bookmarks.json` and `environment.json` are its own, and
  `init` and `adopt` write into it. `explore` proposes from its files only. In
  CI, the Action's `working-directory` names it
  ([Add Projections to CI](../setup/ci.md#where-it-goes)).
- Every path inside a definition (extractor commands and `sources`, comparator
  files, renderer bundles, `execution.scope` and inputs) is relative to its
  project, and extractors run from the project's directory:
  `.github/projections/x/extract.mjs`, not
  `packages/app/.github/projections/x/extract.mjs`. Built-in extractors treat
  the project as their root, so their paths and entity IDs are relative to it
  too. The request names the project as
  [`repository.project`](../contracts/extractors.md), relative to
  `repository.root`.

A definition moves with its project. A directory that is a nested project in one
repository can be the root of another (a monorepo package published as its own
repository, or `git archive HEAD:packages/app`), and a definition whose paths
are relative to its project works unchanged in both. Paths relative to the
repository's root would name a different file in each, so no single definition
could. The runner resolves each path lexically against the project, so a path
may climb out of it with leading `../` segments but never out of the repository:
a definition with such a path is invalid, naming the field.

A nested project's extraction depends on its own directory: unless its
definition declares `execution.scope` (or its built-in implies one), its
[scope](#scopes) is the project. An extractor that reads outside it, such as the
repository's lockfile or a shared directory, widens the scope explicitly, with
`.` for the project itself and `../` for the rest:

```json
"execution": {"scope": [".", "../../package-lock.json", "../shared"]}
```

A scope path that resolves to the repository's root (`..` from a top-level
project) means the whole revision. The project is part of the definition's
identity: its `definitionDigest` and cache keys include it, and each project
keeps its own generation store, so definitions at `a/` and `b/` with the same
relative paths never share an extraction.

## Exact source and explicit execution

Each revision is extracted in the cheapest place that is still exact; the
[design](../design/local-execution.md) explains why and has the measurements.
Nothing is copied unless a toolchain needs files of a revision that isn't
checked out:

<!-- prettier-ignore -->
| Revision | Extractor | Where it runs | `provenance.execution.source` |
|---|---|---|---|
| The working tree | Any | In place, in the checkout | `local-in-place` |
| A commit that is the checkout's `HEAD`, with no changes (with `--in-place`, with only untracked ones) | A toolchain or custom extractor | In place | `local-in-place` |
| Any commit | A built-in that only reads files (`access: files`, shown by `projections extractor view`) | Git objects, with nothing on disk | `local-git-objects` |
| Another commit | A toolchain or custom extractor | A temporary copy | `local-materialized` |
| Any, with container isolation | Repository-owned commands | A temporary copy, mounted read-only | `local-materialized` |

Commit refs resolve once to immutable Git object IDs. Git objects are read
exactly (`ls-tree` plus `cat-file`): no archive attributes, `export-ignore`,
`export-subst`, smudge filters, hooks, checkout, stash, index rewrite or branch
switch is involved. A copy writes the exact blobs and executable bits. Internal
relative symlinks are preserved, but escaping/absolute symlinks and path
traversal are rejected when writing a copy; read in place, a symlink is listed
as what it is and never followed by the SDK. Adapters guard their input paths
against symlink traversal. Like `git archive`, submodule gitlinks and other
special entries (and, in the working tree, nested repositories and special
files) are skipped. The extraction's provenance `limitations` and comparison
notices name the skipped paths (up to 10). A definition that explicitly requires
a skipped path, such as a declared source or extractor program inside a
submodule, fails with an error naming the submodule. On Windows, symlinks are
skipped the same way, because creating them requires Developer Mode or
administrator rights; extractors that need them should run on Unix or in a
container.

The working tree's revision is what Git lists: tracked files as they actually
exist plus untracked files that aren't ignored; deletions are respected. A
built-in that only reads files sees exactly that (the SDK refuses an ignored
path), so its extraction depends only on the working tree's identity: its Git
tree hash, computed with a temporary index seeded from the real one
(`git add -A`, `git write-tree`), which rehashes only changed files and leaves
the user's index and refs alone. A toolchain run in place may also read ignored
files, such as installed dependencies and build caches, as tests do; those
caches survive between runs. The identity is taken before and after an in-place
run; if the working tree changed meanwhile, the extraction is labelled `stale`
in `provenance.execution.fidelity`, with a limitation saying so, rather than
presented as either version. A working-tree extraction records its actual dirty
flag and base commit, and cannot be exported as a clean immutable commit
artifact. Temporary copies are removed on success, failure and abort; temporary
paths are rejected instead of persisted, and so is the checkout's own path.

A comparison applies **one** projection definition, with one version of its
component code, to both revisions. By default it is the base (first) revision's
definition, for one consistent rule with pull request review: an author can't
reshape how their own change is explained. `--definition head` uses the head
revision's instead. A projection missing at the definition revision is an
explicit error naming an option that works: `--definition` with the other
revision when it defines the projection, else `--definition-revision` with the
working tree (or `HEAD`). `bookmark run` falls back to the working tree's
definition itself when neither of a bookmark's revisions defines the projection.
The extractor program comes from the definition's revision: relative
`extractor.command` paths and the process working directory resolve in the
definition's project there, while `request.repository.root` names the directory
holding the examined revision, so extractors must read repository files through
it (the project's at `request.repository.project` in it). A toolchain on a copy
borrows the project's installed dependencies from the user's checkout
(`request.repository.checkout`); no hidden fixture inputs or automatic
dependency repair exists. Any installed-language executable argv extractor works
with no SDK.

So **a file read relative to the working directory, or to the extractor's own
location, comes from the definition's revision on every side**, whichever
revision is examined: both sides of `compare HEAD~1..HEAD` read `HEAD~1`'s, and
the comparison shows no change in it. `determinism`, `execution.scope` and the
cache don't change that: they describe the examined revision, which such a read
bypasses. Declaring the file in `sources` makes it the definition's component
code, read from the definition's revision by design and covered by its digest (a
notice then says when the other revision changes it). Data the projection is
about belongs under `request.repository.root`; the extractor's own code and
configuration belong in `sources`. [`projections check`](commands.md) runs a
custom extractor again from a copy holding only the definition's own files
(definition directories, declared sources and command paths), with the working
tree still at `root`, and warns when that run differs or fails, naming those
files: the extractor reads something beside it.

Built-in extractors run exactly as custom ones do. The runner starts each as a
process of the same executable, `projections __extract <id>`, with the built-in
definition's request on stdin, under the same supervision, environment
allowlist, timeout, output limits and trust gating, and decodes, normalizes and
records its extraction the same way. Only provenance differs: the extraction
names the built-in, and a built-in that runs no tools or repository code needs
no trust. The executable tells its entrypoint where its own helpers are
(`--helpers` or `--cache-dir`), since the process receives only the granted
environment. Container isolation still runs only repository-owned extractor
commands, because the image doesn't contain the executable.

Each saved extraction records the definition and its `definitionDigest`: SHA-256
over the RFC 8785 canonical definition, then, for a nested project, its
directory, then for each declared `sources` path of the extractor, comparator
and renderer (plus the comparator file, which is always part of it), in sorted
order, every file's repository path and bytes from the definition revision. Two
extractions are compared only when their digests match; otherwise the error says
whether the definition itself or its declared component sources differ.

When the other revision defines the projection differently, the comparison still
runs and says so: a **notice** explains whether the other revision changes the
definition, changes its component code (declared sources) or doesn't define the
projection, and suggests `--definition head` (or `base`), which runs that
revision's projection code. Text output prints notices before the steps; the
comparison document records them in `notices`.

### Comparators

Comparisons run the projection's comparator. The default comparator is a
WebAssembly module embedded in the CLI, `default-comparator.wasm`, which runs in
the same sandbox as comparator files below; its module digest identifies it
(`comparator.id` `default`). Its options are checked by running it. A definition
can configure it:

```json
"comparator": {"options": {"order": {"by": "dependents", "direction": "descending"}}}
```

or name a comparator file, the only kind of custom comparator: a YAML file
(`<name>.comparator.yaml`) of identity passes, classifications and step orders
written in CEL ([Custom comparators](../guides/comparators.md)), by its path
alone or as `{file, sources?, options?}`:

```json
"comparator": ".github/projections/priority.comparator.yaml"
"comparator": {"file": ".github/projections/priority.comparator.yaml", "options": {"priority": ["package:core"]}}
```

A string or an object with `file` is a custom comparator; an object without
`file` is the default comparator. A definition with the former
`comparator.rules` key, or a path that doesn't end in `.comparator.yaml` or
`.comparator.yml`, is invalid, with how to migrate.

The comparator file is read from the definition revision (a regular file, not
through a symlink, at most 64 MiB) and run by the rules interpreter embedded in
the CLI, `rules.wasm`, in the `wasmi` interpreter: it checks the file (every
problem with its YAML line and column), computes the default baseline and
applies it, with a fuel budget, a 256 MiB memory cap, 32 MiB input/output caps
and the comparator's own deterministic cost budget. An invalid comparator file,
an exhausted budget, a failed check or expression, or a comparison that fails
the Engine's validation against both extractions is an explicit error; the
baseline is never substituted. The comparison records
`comparator: {id: <comparator file path>, digest: <comparator digest>}`, which
covers the file's meaning (not comments or layout) and the interpreter's
language ([the contracts](../contracts/comparisons.md#comparator-files)).
Running a comparator never requires `--trust`: it has no access to files,
network, clock or randomness.

To compare saved extractions whose definition names a comparator file, pass it
at the definition revision with `--comparator FILE`.
`validate --comparator FILE` reruns it and requires an identical comparison;
without the file, `validate` and the Inspector (opening a saved comparison)
check a custom comparison with the Engine against both extractions (it can't
hide or invent changes), but can't reproduce its order and summaries.

`--trust` explicitly grants local execution of the projection's extractor and
the code it runs on **both revisions**, and their subprocesses. Without it,
custom argv and tool-executing adapter paths fail before execution, with the
diagnostic code `TRUST_REQUIRED` in batch and Inspector results (other runner
failures use `RUNNER_ERROR`). Parser-only built-ins can read data without
granting repository execution. `--trust` also grants a custom renderer that only
the head revision supplies; see [Trust](../contracts.md#trust) for the policy
and the self-navigation threat it addresses. Declarations such as
`network: false` or `hermetic` are not sandboxes. Normal local provenance
honestly reports `local`, not a claimed hermetic environment.

The invocation environment source is copied, never assigned to `process.env`.
Only `PATH`, Windows `SystemRoot`, deterministic locale/timezone and explicitly
named `execution.environment` values are forwarded, to built-in and custom
extractors alike ([process](../contracts/extractors.md#process)). `HOME`,
tokens, proxies, loader hooks and other ambient values are not automatically
copied; a built-in extractor that uses the user's caches or configuration (Go's
module cache, the NuGet packages folder, a JDK through `JAVA_HOME`) uses them
only when the definition grants the variables that name them. Allowlisted values
are not recorded by the runner in provenance, cache keys or manifests. Do not
have an extractor print secrets: stdout becomes extraction artifact data, and
raw stderr remains visible in local errors and the Inspector. Django
`inputs.env` is rejected; use the per-invocation source plus allowlist.

Extraction has a 30-second default / 300-second maximum timeout, 8 MiB stdout
and 64 KiB stderr limits. The timeout covers the extractor and every tool it
runs, so a built-in extractor that builds the project (.NET, Spring, Go) usually
needs a larger `execution.timeoutMs`. Executables are spawned directly, never
through a shell. Timeout, abort, overflow, missing tools, nonzero exits, invalid
UTF-8/JSON/extractions, and cleanup failures are explicit errors. Every process
and all its descendants are stopped together when it finishes, fails or is
cancelled. On Unix it leads its own process group, which is frozen and killed.
On Windows it is created suspended, assigned to its own Job Object (kill on
close, no breakaway) and only then resumed; the job is terminated until empty,
and if the CLI itself ends abruptly, closing its handle still kills the tree.
Ctrl+C, Ctrl+Break and closing the console cancel like SIGINT and SIGTERM.
Temporary copies are capped at 50,000 files / 256 MiB
(`PROJECTIONS_MAX_COPY_BYTES` sets another byte cap); there is no
truncation-to-success. A revision over the cap copies only the definition's
scope and its own files (definition directories, declared sources and command
paths) when it declares one, and its provenance says so; without a scope it
fails, naming `execution.scope`. Revisions read in place or from Git objects
have no such cap.

An extractor that runs out of time fails naming `execution.timeoutMs`. The
30-second default suits built-ins that only read files; raise it for a toolchain
extractor (the TypeScript compiler on a large program, a .NET or Spring build),
and declare a scope so it reads only what it needs.

## Scopes

By default an extraction depends on the whole revision, which is always correct;
a [nested project's](#nested-projects) depends on its own directory. A
definition may narrow it with `execution.scope`, files and directories relative
to its project (not globs; `.` is the project, and `../` widens a nested
project's scope beyond it):

```json
"execution": {"scope": ["api", "package.json"]}
```

Some built-ins imply a scope from their inputs: `github-actions-jobs` reads its
`workflowPath`, `prisma-schema` the `schema`, `schemas` or `snapshot` it names,
and `nuget-dependencies` its `assetsPaths`. A declared scope wins.

A scope is enforced wherever reads are mediated, and only trusted where it is:

- **Reads through the extractor SDK** (Git objects and in place): files outside
  the scope aren't listed, and reading one fails loudly, naming the path
  (`read …, outside its declared scope`). The request carries the scope,
  resolved to repository-relative paths, as `repository.scope`.
- **Workspaces** with the `sparse` strategy check out only the scope.
- **`projections check`** extracts the working tree again from a copy holding
  only the scope and compares: equal extractions record the scope as verified
  for that definition digest (in `scopes/<repository>.json` in the per-user
  cache); a difference warns, naming what changed, because the extractor reads
  outside its scope. CI runs `check` too.

The [extraction cache](caches.md#extraction-cache) keys a scoped extraction by
the scope's Git objects instead of the whole tree, so an edit outside the scope
is a hit, but only when the scope is enforced (a built-in reading through the
SDK) or verified; otherwise any edit is a miss. `provenance.execution.scope`
records the scope that applied, and `GET /api/identity` reports `scope`,
`scopedTree` and `scopeVerified`. A toolchain extractor running in place or in a
full workspace isn't confined at the process level: a macOS sandbox profile or
Linux Landlock could deny its reads outside the scope, and that remains future
work.
