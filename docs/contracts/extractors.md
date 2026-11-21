# Extractor request and execution

Every extractor runs as a standalone process: it reads one JSON request from
stdin, writes one JSON extraction to stdout, and sends any diagnostics to
stderr.

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

Two optional fields extend the request when a projection uses generated values
or upstream extractors:

- `generations` points to the runner's generation store snapshot,
  `{"file": "/abs/path/generations.jsonl"}`—a read-only JSON Lines file of
  `{"path", "basis", "value"}` entries recording previously generated values for
  a declared path pattern and [basis digest](extractions.md#generated-values).
  An extractor that produces generated values should reuse any matching entry,
  while still working cleanly when `generations` is absent (such as on a first
  run or with `--regenerate`).
- `upstream` carries the normalized extractions of any built-in extractors
  listed in the definition's `extractor.upstream`, keyed by those names (for
  example, `{"crates": {"protocolVersion": 0, "schema": "graph/v0", …}}`).
  Before launching the command, the runner extracts each upstream from the same
  revision as `<id>.<name>` using the built-in's `inputs` and the definition's
  `execution.scope` and `timeoutMs`. If any upstream fails, the projection fails
  before the command runs. Only command extractors can declare `upstream`, and
  only built-ins (1 to 8 of them) can serve as upstream, which rules out
  recursion. Because upstream payloads can exceed 2 MiB, the Rust SDK accepts
  requests up to 66 MiB (`MAX_REQUEST_BYTES` plus `MAX_UPSTREAM_BYTES`).

`repository.mode` tells the extractor how the runner is exposing the examined
revision (see [why](../design/local-execution.md)):

<!-- prettier-ignore -->
| Mode | `root` | The revision's files | When |
|---|---|---|---|
| `in-place` | The user's checkout | What Git lists there: tracked files and untracked ones it doesn't ignore | The working tree, and a commit that is the checkout's clean `HEAD` |
| `materialized` | A temporary copy | Everything under `root` | A toolchain on another commit, and container isolation |
| `git-objects` | Absent | The Git tree named by `repository.git` (`directory`, `tree`) | A built-in that declares `access: files`, on a commit |

Extractors read the examined revision from `repository.root`—or, when using the
SDK, through the context (`files`, `entry`, `read_source`), which handles every
mode transparently. **An extractor must behave correctly in place.** In
`in-place` mode, `root` is the user's live checkout and may contain ignored
files (installed dependencies, build artifacts, editor files) that are not part
of the revision. List files the way Git does
(`git ls-files --cached --others --exclude-standard`) or through the SDK instead
of walking the directory, and never write into `root` except to ignored scratch
or build directories.

The process working directory is always the definition's project in the revision
that supplied the projection definition, so relative command paths in
`extractor.command` execute the definition's version of the extractor. During a
comparison, the definition's revision and the examined revision differ on at
least one side, so **never read the examined revision relative to the working
directory or the extractor's own location**—if you do, both sides read the same
revision and the comparison shows no change. Code or configuration files the
extractor needs from its own revision belong in `sources`, which come from the
definition's revision by design. `projections check` warns if an extractor reads
anything else beside itself.

`repository.project` names the definition's
[project](../runner/execution.md#nested-projects)—the directory holding
`.github/projections` or `.projections`—relative to `root` (and to the Git tree
in `git-objects` mode), using `/` separators. It is empty for the repository
root and something like `packages/app` for a nested project. Because every path
in a definition (`sources`, `extractor.command`, `inputs`) is project-relative,
read the project's files under `root` joined with `project` (such as
`path.join(root, project)` in Node) and report evidence paths relative to the
project too. Built-in extractors using the SDK see the project directly as their
root: `Context::root` returns the project directory, `Context::files` lists
files relative to it, and reads accept project-relative paths (with `../`
reaching outside the project where scope permits). `repository.scope` remains
repository-relative. The runner always includes `project`; if absent, treat it
as the repository root.

Submodules and other special Git entries are omitted from examined revisions,
matching `git archive`, and the runner logs any skipped paths in the saved
extraction's `limitations`.

`repository.checkout` points to where the repository's dependencies
(`node_modules`, a virtual environment) and toolchain configuration are
installed for the run—for a nested project, inside its `project` directory
there, which `Context::checkout` returns. In `in-place` mode it is `root`
itself; in `materialized` mode it points to the user's checkout when a temporary
copy borrows its installed dependencies so one installation can analyze every
compared revision, just like a toolchain on `PATH`. Treat it as read-only:
extractors must not write to it. Container isolation and `git-objects` mode omit
`repository.checkout`.

A built-in extractor that only reads files through the SDK declares
`access: files` in its descriptor. The runner can then serve it directly from
Git objects, where `Context::root` is unavailable (calling it panics and names
the extractor). All other extractors use `access: checkout`.

**Breaking changes in v0** (before any public deployment): `repository.mode` is
now required; `repository.root` is omitted in `git-objects` mode; the working
tree and a clean `HEAD` are no longer copied, meaning `root` can be the user's
checkout with ignored files present; `repository.checkout` now indicates where
dependencies are installed for the run rather than always pointing to the user's
checkout; saved extractions add an optional `provenance.execution` block
(covered in the saved documents contract); definitions add
`execution.determinism` and `execution.scope`; built-in extractor descriptors
add `access` and `determinism`; and requests add `repository.project`.
Definition paths are now relative to the definition's project rather than the
repository root, extractors run from the project directory, and built-in
extractors see the project as their root (unchanged for root-level definitions,
which was the only option before nested projects).

## Process

The runner gives the extractor process a minimal, explicit environment:

| Variable                             | Value                      |
| ------------------------------------ | -------------------------- |
| `LANG`, `LC_ALL`                     | `C.UTF-8`                  |
| `TZ`                                 | `UTC`                      |
| `PATH`, `SystemRoot` (Windows)       | The runner's own           |
| Each name in `execution.environment` | The runner's own, when set |
| `PYTHONPATH` (custom extractors)     | See below                  |

Nothing else is inherited—no `HOME`, tokens, proxies, or loader hooks unless the
definition explicitly lists them (aside from the runner's own preload for
`node`, described below). Keep in mind that `execution.environment` is an
allowlist for hygiene, not a security sandbox or execution grant.

For custom extractors, `PYTHONPATH` starts with the directory of the bundled
`projections` Python module, followed by the runner's own `PYTHONPATH` if
`execution.environment` includes it. The runner unpacks this module into its
per-user cache so a Python extractor can read requests and emit extractions
without hand-writing JSON or installing packages:
`from projections import request, result`, then
`result(entities=..., relationships=...)` (see
[first extractor](../guides/first-extractor.md#1-write-the-program)). You can
run `projections __python-path` to print that directory when testing an
extractor manually. Built-in extractors do not receive it, and the underlying
protocol remains plain JSON over stdin and stdout so any language works
directly.

Custom extractors whose program is the bare name `node` get the same helpers for
JavaScript and TypeScript. Before the command's own arguments, the runner
prepends `--require` pointing to a preload script unpacked into its cache (and
when the command enables Node's permission model with `--permission`, grants
read access to that directory; before Node 22.15 the hook also requires
`--allow-worker`, otherwise the import resolves normally). The preload registers
a resolve hook for a single specifier, `@githubnext/projections/extractor`,
loading the module bundled with the runner ahead of any installed copy while
leaving every other import untouched. Because ES modules don't search
`NODE_PATH`, extractors in `.mjs`, `.js`, or `.ts` can import
`{request, result}` without installing anything. Installing
`@githubnext/projections` adds its TypeScript types and lets other runners such
as `npx tsx` import it. Run `projections __node-require` to print the preload
script's path when running an extractor by hand. Both the Python and Node
modules share the same behavior and error messages, enforced by
`packages/schemas/fixtures/extractor-helpers.json`.

When a command starts with the bare program name `python3` or `python`, the
runner resolves this machine's Python 3 regardless of how the launcher is named:
it tries the name as written, then the other name, and finally the Windows
`py -3` launcher, running the first one that reports Python 3. That way
`["python3", "extract.py"]` works on macOS, Linux, and Windows machines that
only have `python` or `py`, while skipping a `python` that points to Python 2.
Any other program—including an explicit path like `.venv/bin/python`—runs as
written, and commands inside a container (`--isolation container`) always run as
written.

Extractors may spawn child tools such as a language compiler. Those children
remain under the extractor's supervision—a single process group on Unix or a Job
Object on Windows—so the runner can terminate the whole tree cleanly when the
extractor exits, fails, times out, or is cancelled. Do not detach child
processes (for example with `setsid`). The timeout covers both the extractor and
every tool it invokes. Pass child tools only the environment they need, and
forward any diagnostic output you want surfaced to the extractor's stderr.

The runner executes argv directly without a shell, and historical extractions
always run against the exact selected Git revision. The default timeout is 30
seconds (up to a maximum of 300 seconds). Stdout is capped at 8 MiB and stderr
at 64 KiB, with both captured for diagnostics. On overflow, timeout,
cancellation, missing tools, invalid output, or partial extraction, fail
explicitly with a nonzero exit status and a clear message on stderr—never
recover by emitting a valid-looking empty extraction.

## Built-in extractors

Built-in extractors use the exact same interface as custom ones. Each runs as
its own process, `projections __extract <id>`, reading the same stdin request
and writing one extraction to stdout under identical supervision, environment,
limits, trust gating, and provenance. A definition can invoke a built-in either
way: with the same binary, `"extractor": "repository-map"` and
`"extractor": {"command": ["projections", "__extract", "repository-map"]}` yield
the same extraction. The only difference is trust: a custom command is always
repository code and requires `--trust`, whereas a built-in that runs no external
tools or repository code does not, because its code ships inside the CLI
executable itself.
