# Extractor request and execution

An extractor is a process. It receives one request on stdin and writes one
extraction on stdout. Stderr contains diagnostics.

```json
{
  "protocolVersion": 0,
  "projection": {"id": "dependencies", "definition": {}},
  "repository": {
    "mode": "in-place",
    "root": "/abs/path",
    "project": "packages/app",
    "revision": {"kind": "commit", "ref": "<sha>", "commit": "<sha>", "dirty": false},
    "checkout": "/abs/path"
  },
  "capabilities": {"trusted": true, "network": false}
}
```

An optional `generations` names the runner's generation store snapshot,
`{"file": "/abs/path/generations.jsonl"}`: read-only JSON Lines of
`{"path", "basis", "value"}`, the values earlier extractions generated for a
declared path (the declaration's pattern) and a
[basis digest](extractions.md#generated-values). An extractor that generates
values reuses a stored value for an equal key; it must work without the
snapshot, which is absent on a first run and with `--regenerate`.

An optional `upstream` holds the extractions of the built-in extractors the
definition's `extractor.upstream` names, keyed by those names:
`{"crates": {"protocolVersion": 0, "schema": "graph/v0", …}}`. The runner
extracts each from the same revision before the command runs, as the projection
`<id>.<name>`, with the built-in's `inputs` and the definition's
`execution.scope` and `timeoutMs`, and normalizes it. A failed upstream
extraction fails the projection before the command runs. Only a command
extractor declares upstream, and only built-ins can be upstream (1–8 of them),
so composition can't recurse. Requests with upstream extractions can be larger
than 2 MiB: the Rust SDK reads up to 66 MiB (`MAX_REQUEST_BYTES` plus
`MAX_UPSTREAM_BYTES`).

`repository.mode` says how the runner gives the extractor the examined revision
([why](../design/local-execution.md)):

<!-- prettier-ignore -->
| Mode | `root` | The revision's files | When |
|---|---|---|---|
| `in-place` | The user's checkout | What Git lists there: tracked files and untracked ones it doesn't ignore | The working tree, and a commit that is the checkout's clean `HEAD` |
| `materialized` | A temporary copy | Everything under `root` | A toolchain on another commit, and container isolation |
| `git-objects` | Absent | The Git tree named by `repository.git` (`directory`, `tree`) | A built-in that declares `access: files`, on a commit |

Extractors read the examined revision through `repository.root`, or, written
with the SDK, through the context (`files`, `entry`, `read_source`), which
serves every mode. **An extractor must be correct in place:** under `root` it
may find ignored files (installed dependencies, build output, editor files) that
are not part of the revision. List the revision's files the way Git does
(`git ls-files --cached --others --exclude-standard`), or through the SDK,
rather than walking the directory, and don't write into `root` except ignored
scratch or build output. The process working directory is the definition's
project in the revision that supplied the projection definition, so relative
program paths in `extractor.command` always run the definition's version of the
extractor. The two revisions are the same unless a comparison applies one
revision's definition to another revision, which every comparison does for at
least one of its sides: **never read the examined revision relative to the
working directory or the extractor's own location**, or both sides read the
definition's revision and the comparison shows no change. Files the extractor
needs as code or configuration are its declared `sources`, which come from the
definition's revision by design. `projections check` warns when an extractor
reads anything else beside it.

`repository.project` is the definition's
[project](../runner/execution.md#nested-projects), the directory holding its
`.github/projections` (or `.projections`), relative to `root` (and to the Git
tree in `git-objects` mode), `/`-separated: empty for the repository's root,
`packages/app` for a nested one. Every path in the definition (`sources`,
`extractor.command`, `inputs`) is relative to it, so read the project's files at
`root` joined with `project` (`path.join(root, project)` in Node), and report
evidence paths relative to it too. Built-in extractors written with the SDK see
the project as their root: `Context::root` is the project's directory,
`Context::files` lists the project's files relative to it, and reads take
project-relative paths, with `../` reaching outside the project where its scope
allows. `repository.scope` stays repository-relative. The runner always sends
`project`; an absent one means the root.

Examined revisions omit submodules and other special entries, as `git archive`
does; the runner records the skipped paths in the saved extraction's
`limitations`.

`repository.checkout` is where the repository's dependencies (`node_modules`, a
virtual environment) and toolchain configuration are installed for this run (a
nested project's in its `project` directory there, which the SDK's
`Context::checkout` returns): `root` itself in place, or the user's checkout
when a copy borrows them, so one installation examines every compared revision,
as a toolchain on `PATH` does. It is read-only by convention: extractors must
not write to it. Container isolation and `git-objects` mode omit it.

A built-in extractor that only reads files through the SDK declares
`access: files` in its descriptor; the runner may then serve it from Git
objects, and `Context::root` is unavailable (it panics, naming the extractor).
Every other extractor has `access: checkout`.

**Breaking changes in v0** (nothing was deployed): `repository.mode` is new and
required; `repository.root` is absent in `git-objects` mode; the working tree
and a clean `HEAD` are no longer copied, so `root` can be the user's checkout,
holding ignored files; `repository.checkout` now names where dependencies are
installed for the run rather than always the user's checkout; saved extractions
gain an optional `provenance.execution` (below); definitions gain
`execution.determinism` and `execution.scope`; the built-in extractor descriptor
gains `access` and `determinism`; and the request gains `repository.project`,
the definition's project. A definition's paths are now relative to its project
rather than the repository's root, the extractor runs from it, and built-in
extractors see it as their root (identical for the repository's root, which
every definition used before nested projects).

## Process

The extractor process receives exactly this environment:

| Variable                             | Value                      |
| ------------------------------------ | -------------------------- |
| `LANG`, `LC_ALL`                     | `C.UTF-8`                  |
| `TZ`                                 | `UTC`                      |
| `PATH`, `SystemRoot` (Windows)       | The runner's own           |
| Each name in `execution.environment` | The runner's own, when set |
| `PYTHONPATH` (custom extractors)     | See below                  |

Nothing else is passed: no `HOME`, tokens, proxies or loader hooks unless the
definition declares them (the runner's own preload for `node`, below, aside). A
declared environment allowlist is not a sandbox or execution grant.

A custom extractor's `PYTHONPATH` starts with the directory of the `projections`
Python module, followed by the runner's own `PYTHONPATH` when
`execution.environment` names it. The module ships with the runner, which
unpacks it into its per-user cache, so a custom extractor in Python reads the
request and writes the extraction without handling this protocol's JSON or
installing anything: `from projections import request, result`, then
`result(entities=..., relationships=...)`
([first extractor](../guides/first-extractor.md#1-write-the-program)).
`projections __python-path` prints its directory, to run an extractor by hand.
Built-in extractors don't get it. The protocol itself stays JSON on stdin and
stdout, which an extractor in any language can write directly.

A custom extractor whose program is the bare name `node` gets the same helpers
for JavaScript and TypeScript: the runner adds `--require` and the path of a
preload script, also unpacked into its cache, before the command's own
arguments. The script registers a resolve hook for one specifier,
`@githubnext/projections/extractor`, which then loads the module this runner
ships, ahead of any installed copy; every other import resolves as usual. ES
modules don't search `NODE_PATH`, so an extractor in `.mjs`, `.js` or `.ts`
imports `{request, result}` from it with nothing installed. Installing the
`@githubnext/projections` package adds its types, and lets other programs, such
as `npx tsx`, import it. `projections __node-require` prints the script's path,
to run an extractor by hand. Both modules behave alike, with the same messages:
`packages/schemas/fixtures/extractor-helpers.json` holds both to it.

A command whose program is the bare name `python3` or `python` runs this
machine's Python 3, whatever its launcher is called: the runner tries the name
as written, then the other name, then the Windows `py -3` launcher, and runs the
first that reports Python 3. So `["python3", "extract.py"]` runs as written on
macOS and Linux and on a Windows machine with only `python` or `py`, and a
`python` that is Python 2 is passed over. Any other program, including a path
such as `.venv/bin/python`, runs as written; inside a container
(`--isolation container`) the command runs as written too.

An extractor may run tools, such as the ecosystem's compiler, as its own child
processes. They stay in the extractor's supervision: one process group on Unix
and one Job Object on Windows, which the runner stops as a whole when the
extractor finishes, fails, times out or is cancelled. Don't detach tools from it
(for example with `setsid`). The timeout covers the extractor and every tool it
runs. Give a tool only the environment it needs; tool output the extractor wants
diagnosed belongs on the extractor's stderr.

Execute argv directly, never through a shell. Historical extraction runs from
the exact selected Git revision. The default timeout is 30 seconds; the maximum
is 300 seconds. Stdout is bounded to 8 MiB and stderr to 64 KiB; both are
recorded for diagnostics. Fail explicitly with a nonzero exit and a message on
stderr on overflow, timeout, cancellation, missing tools, invalid output or
partial extraction. Never emit a success-shaped empty extraction as recovery.

## Built-in extractors

Built-in extractors have no other interface. Each runs as its own process,
`projections __extract <id>`, which reads this request and writes one extraction
like any custom extractor, under the same supervision, environment, limits,
trust gating and provenance. A definition can name one either way: with the same
executable, `"extractor": "repository-map"` and
`"extractor": {"command": ["projections", "__extract", "repository-map"]}`
produce the same extraction. Only trust differs: a custom command is always
repository code and needs `--trust`, while a built-in that runs no tools or
repository code doesn't, because its code ships with the executable rather than
the repository.
