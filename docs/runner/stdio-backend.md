# Stdio backend

```sh
projections serve --stdio [--trust] [-C DIR]
projections serve --stdio --document FILE
projections serve --stdio --fixtures PATH... [--renderer DIR...]
```

`serve --stdio` is the Inspector's backend for editor extensions (such as the VS
Code extension) that launch the CLI directly and talk to it over standard input
and output. Because there is no network port or listener, only the parent
process can reach it. By default it runs in repository mode against `-C DIR` (or
the current working directory) and watches the working tree. `--stdio` is
required because it is the only supported transport.

Two alternative modes serve static inputs without running any code (neither
accepts `--trust`): `--document FILE` loads a saved extraction, comparison, or
pull request review, and `--fixtures` serves renderer scenarios (see
[Fixtures mode](#fixtures-mode)). In VS Code, open them with **Projections: Open
Artifact…** and **Projections: Open Renderer Scenarios…**.

Every `request` is handled in memory by the Inspector service (see
[Requests](#requests) for the full endpoint list), the same service used by the
CLI's headless `--png` and `check` pages.

**Trust and writes.** Passing `--trust` allows repository code (custom
extractors and custom renderers) to run and enables saving via
`POST /api/definition`. Editors should pass `--trust` only for trusted
workspaces. The explore candidates returned by `GET /api/explore` (discovered at
startup just like `projections explore`) are always available as trial
definitions for jobs, sweeps, and comparators so the Explore view can preview
and open them.

When the working tree has no projections of its own, the backend runs in an
explore session: `GET /api/definitions` returns the explore candidates, and
`POST /api/adopt` can write definitions and bookmarks after a preview (`dryRun`,
then its `digest`) without `--trust`, since it only writes built-in definitions
and bookmarks and never runs repository code. Once the repository defines its
own projections, `GET /api/definitions` returns only those (plus any candidate
explicitly requested via `include`, as the Explore view does), and adopting
requires `--trust`.

**Framing.** Messages use JSON-RPC 2.0 encoded as one UTF-8 JSON object per line
with no embedded newlines (NDJSON), capped at 1 MiB per request line. Standard
output carries protocol messages exclusively—on Unix, file descriptor 1 is
redirected to standard error once the protocol starts so nothing else can write
to it—while diagnostics go to standard error. Up to 64 requests can run
concurrently and replies may arrive out of order, so match responses by `id`.

- `initialize` returns
  `{"protocol": 1, "version", "repository", "trusted", "explore", "mode"}`: the
  CLI version, the repository's absolute path, whether `--trust` is active,
  whether this is an explore session, and `mode` (`repository`, `document`, or
  `fixtures`).
- `request` takes `{"method": "GET"|"POST", "path", "body"?}` and returns
  `{"status", "contentType", "headers"?, "body"}` with the service's HTTP status
  and `headers` (`content-security-policy` and `x-content-type-options`, which
  the host should apply when presenting the content). `path` must be a
  server-relative path (with optional query string) under `/api/`,
  `/renderers/`, `/custom-renderers/`, or `/inspector/`—no scheme, fragment,
  backslash, `.` or `..` segment, or control characters, and at most 4096
  characters; everything outside `/api/` is `GET` only. `/inspector/<path>`
  serves the Inspector's own scripts, styles, Workers, and Wasm (`mount.js`,
  `mount.css`, `packages/engine/`, `comparator/`) for hosts that don't bundle
  the UI (such as the renderer workbench), never a document or renderer bundle.
  `body` (`POST` only) holds the JSON request payload. In the response, `body`
  is parsed JSON for JSON responses, `{"base64"}` for binary responses (like a
  sweep thumbnail PNG or Wasm), and plain text otherwise; responses over 64 MiB
  fail.
- `tools/list` returns `{"tools": [...]}` listing the
  [agent tools](agent-tools.md), each shaped as
  `{"name", "title", "description", "inputSchema", "annotations", "trust", "view"}`.
  This includes the view actions `open_projection`, `current_view`, and
  `refresh` (`view: true`), which the editor handles itself against its
  projection tabs.
- `tools/call` takes `{"name", "arguments"?}` and returns
  `{"content": [{"type": "text", "text"}], "structuredContent", "isError"}`,
  matching MCP's `tools/call`. Unknown tools return error `-32602`, and calls
  can be cancelled with `$/cancelRequest` just like `request`. Write previews
  return a `confirm` token in `structuredContent` so the editor can prompt the
  user and re-call with confirmation.
- `shutdown` returns `null`, after which any further `request`s or `tools/call`s
  fail.
- `exit` terminates the process (as a notification, or as a request returning
  `null`).

<!-- prettier-ignore -->
| Notification | Direction | Params |
|---|---|---|
| `$/cancelRequest` | to the backend | `{"id"}`: cancels that request (ending long polls like `/api/changes` immediately) and replies with error `-32800` |
| `changes` | from the backend | `{"generation", "changes", "complete"}`, sent whenever the working tree's generation advances—matching what `GET /api/changes?since=N` returns for the previous generation `N` |
| `rendererBuilds` | from the backend | `{"sequence", "builds"}`, sent whenever a custom renderer build updates—matching what `GET /api/renderer-builds?since=N` returns for the previous notification's `sequence` `N`, so each output line is delivered once |

HTTP-level refusals come back as normal JSON-RPC results (for example
`{"status": 404, "body": {"diagnostics": [...]}}`). Protocol-level problems
return JSON-RPC errors: `-32700` for invalid JSON, `-32600` for a malformed
request (including lines over 1 MiB, duplicate in-flight `id`s, or requests
after `shutdown`), `-32601` for an unknown method, `-32602` for invalid
`request` params, `-32603` when a response cannot be relayed, `-32000` when too
many requests are in flight, and `-32800` when cancelled. The backend exits with
status 0 when standard input closes, on `exit`, or on SIGINT/SIGTERM (Ctrl+C or
Ctrl+Break on Windows), cancelling any active jobs, sweeps, and thumbnail
renders first.

## Requests

Every response the Inspector decodes is backed by a TypeBox schema, and the
service tests validate these responses against it
([schema-owned contracts](../contracts.md#schema-owned-contracts)).

- `GET /api/definitions?ref=REV[&include=ID]` returns
  `{"definitions", "policies", "ref", "commit"?, "executionAuthorized", "invalid"}`.
  When `ref` isn't `working-tree`, `commit` holds the resolved full commit hash
  (used in custom renderer URLs). Invalid definition files are reported in
  `invalid` (just like `list`) without blocking valid ones. Outside an explore
  session, `include` lets the Explore view include a specific explore candidate
  (see [Stdio backend](#)). Each entry in `policies` carries
  `{"id", "requiresTrust", "rendererRequiresTrust"}` (matching `list`), plus for
  `working-tree`, `rendererDevServer` (the loopback URL of a running custom
  renderer dev server, described below) and `scenarios` (the repository path to
  its renderer package's `scenarios.json`).
- `GET /api/renderer-builds?since=N[&wait]` (repository mode only) returns
  `{"sequence", "builds"}`, describing each custom renderer build with
  `projection`, `phase` (`building`, `built`, `failed`, or `untrusted`), `error`
  (first error line or startup failure reason), `script` (`watch` or `build`),
  `package`, `located` (whether the error names a file and position), `run`
  (incremented per script start), `running`, `exit` (last exit code), and
  `lines` (output after sequence `N`, retaining the last 2000 lines). Passing
  `wait` long-polls until new output arrives after `N` or 20 seconds elapse.
- `POST /api/renderer-builds` takes `{"projection", "event"}` to signal
  lifecycle events: `opened` (builds if sources are newer than the bundle),
  `saved` (builds immediately, or queues another `build` if one is already
  running), `changed` (builds if sources differ from the last build), or
  `closed` (stops a watcher). If the renderer package defines a `watch` script,
  it runs once and rebuilds on save; otherwise `build` runs once per save.
  Without `--trust`, nothing runs and the phase is `untrusted`. Returns the
  build states without output lines.
- `GET /api/changes?since=N` (repository mode only) returns
  `{"generation", "changes", "complete"}` immediately if the current generation
  differs from `N`, or waits up to 20 seconds for a change. `changes` reports
  what moved since `N`: `definitions`, `working-tree` (files reported by
  `git status` that extractors read), and `extractor:<id>`, `renderer:<id>`,
  `comparator:<id>`, or `scenarios:<id>` for a definition's declared files
  (`sources`, extractor command files, comparator file, renderer bundle and dev
  server record, or renderer `scenarios.json`). `complete` is false if `N` is
  older than the 64 retained generations. `tree` holds the latest working-tree
  Git tree hash (matching `provenance.execution.tree`) when available so clients
  can tell which displayed extractions are stale. Changes are debounced until
  files are quiet for 120 ms (up to 2 s max) so multi-step editor saves appear
  as one clean event rather than half-written files; working-tree jobs wait the
  same way and retry once with a note in `notices` if a failure coincided with
  edits to definition, extractor, or comparator files.
- `GET /api/identity?projection=ID` returns the working tree's current identity
  for projection `ID` without running anything: `{"tree", "definitionDigest"}`.
  A working-tree extraction whose `provenance.execution.tree` and
  `provenance.definitionDigest` match is up to date. Scoped definitions also
  include `scope`, `scopedTree` (hash of the scope's Git objects), and
  `scopeVerified`—compare `scopedTree` instead of `tree` only when
  `scopeVerified` is true. Note that in-place toolchain extractions can also
  depend on ignored files (such as installed dependencies) not reflected in this
  identity.
- `GET /api/revisions?limit=N` returns `{"revisions": [...]}` for a revision
  picker: first the working tree
  (`{"ref": "working-tree", "commit", "title", "kind": "working-tree", "dirty"}`),
  followed by up to `N` (1-100, default 20) commits from `HEAD`'s history,
  newest first (`{"ref", "commit", "title", "kind": "commit", "date"}`).
- `GET /api/pairs[?projection=ID]` (repository mode) returns the history used to
  populate a Before → After picker without running anything:
  `{"head": {"commit", "branch", "dirty"}, "defaultBranch", "mergeBase", "bookmarks", "tags", "branches", "suggestions", "default"}`.
  `tags` (up to 20, newest first) and `branches` (up to 30, sorted by last
  commit, with `current`) have the shape `{"name", "commit", "date"}`.
  `defaultBranch` comes from `origin` (falling back to `main` or `master`), and
  `mergeBase` is the merge base with it whenever `HEAD` is on another branch.
  `suggestions` lists candidate pairs
  `{"before"?, "after", "label", "source", "bookmark"?, "identical", "backwards"?, "error"?}`
  in default-selection priority: bookmarks from `.projections-bookmarks.json`,
  merge base → working tree on a feature branch, previous tag → `HEAD` (or
  `HEAD`'s tag), `HEAD~1 → HEAD`, and `HEAD → working tree` when dirty. Pairs
  with identical Git trees are marked `identical` and omitted unless they are
  bookmarks (differences limited to files an extractor ignores aren't detected
  here, since that would require running the extractor). `backwards` flags pairs
  where After is older than Before (such as an ancestor commit, or a commit
  after the working tree). `default` selects the first suggestion that has
  changes, resolves, and isn't backwards, falling back to `HEAD` (or the working
  tree) alone.
- `POST /api/definition` (repository mode) accepts
  `{"projectionId", "parts", "dryRun"?, "digest"?}` to update a working-tree
  definition's `extractor`, `comparator`, or `renderer` (pass `null` to remove
  an optional part) while preserving other fields, field order, and indentation,
  validating the result and returning
  `{"path", "before", "after", "digest", "changed", "written"}`. Set `dryRun` to
  preview; writing requires the preview's `digest` (returning `409` if the file
  changed since) and `--trust` (`403` otherwise). This backs the Inspector's
  **Save to definition** action.
- `GET /api/scenarios?projection=ID` (repository mode) returns the scenarios
  from the working-tree projection's renderer package:
  `{"file", "scenarios": [{"id", "title", "description"?, "before"?, "after"} or {"id", "title", "error"}]}`,
  wrapping each extraction with the working tree's definition just like
  `show --from FILE -p ID` without executing anything (`file` is `null` if no
  `scenarios.json` exists). The Inspector exposes these in its **Scenario**
  picker alongside the live working tree.
- `GET /api/comparator?projection=ID&ref=REV` returns the comparator a viewer
  should run for the projection at `REV` (default `working-tree`): either
  `{"default": true}` (pointing to `engine/default-comparator.wasm`) or
  `{"rules": "<base64 comparator file>", "digest": "sha256:<comparator digest>"}`.
  Pass `?rules=PATH&ref=REV` to fetch any `*.comparator.yaml` file at that
  revision the same way so the Inspector can test it.
- `GET /api/comparator-tests` (repository mode) parses the working tree's
  comparator test files without running them; see
  [Comparator tests](#comparator-tests).
- `POST /api/comparator-tests/run` (repository mode) accepts
  `{"path"?, "cases"?, "projection"?, "update"?, "coverage"?}` and runs the
  tests sandboxed without `--trust`; passing `update` rewrites snapshots and
  requires `--trust` (403 otherwise). See [Comparator tests](#comparator-tests).
- `GET /api/renderers` returns
  `{"renderers": [<renderer.json manifests>], "customRendererBase": "/custom-renderers/<capability>/"}`
  (`customRendererBase` is `null` for saved documents, while `--png` serves the
  document's custom renderer).
- `GET /api/document` returns `{"document"}` in `--document FILE` and `--png`
  modes, or `null` otherwise.
- `GET /api/fixtures` is available only in fixtures mode (404 otherwise); see
  [Fixtures mode](#fixtures-mode).
- `GET /api/fixtures/changes?since=N` (fixtures mode only) returns
  `{"generation"}` immediately if it differs from `N`, or waits up to 20 seconds
  for a change.
- Development servers: when a custom renderer package runs `npm run dev` with
  the renderer SDK's Vite config, it writes its loopback URL to
  `node_modules/.projections/renderer-dev-server.json`. As long as that server
  answers `/__projections/renderer.json` for the same renderer, the working
  tree's renderer (a `<package>/dist` bundle next to `<package>/package.json`)
  or a `--renderer <package>` in fixtures mode (`"development": true`, with
  `url` pointing to the server) loads directly from the dev server with hot
  updates instead of the built bundle. Hosts that can reach loopback frame it
  from `http://localhost:*` or `http://127.0.0.1:*` inside the same sandbox;
  because VS Code webviews cannot reach loopback dev servers, they use the built
  bundle while the backend runs the package's `watch` script on save whenever
  the projection's tab is open (`/api/renderer-builds`), or you can run
  `npm run watch`.
- `GET /api/environment` reports the same environment status as
  `projections doctor` without running anything:
  `{"declared", "prepare": [{"id", "run", "key", "state": "current"|"stale"|"failed"|"never", "last"?}], "toolchain", "devcontainer", "missing", "workspace": {"strategy", "source", "reason"}, "workspaces"}`
  (`declared` is null when there is no environment file).
- `POST /api/prepare` kicks off `{"revision"?, "steps"?, "force"?}` just like
  `projections prepare` (targeting the working tree if `revision` is omitted),
  returning `202` with the run record. Only one prepare run can be active at a
  time (`409`), and `--trust` is required (`403`).
- `GET /api/prepare/:id` and `POST /api/prepare/:id/cancel` inspect or cancel a
  prepare run:
  `{"id", "status": "running"|"succeeded"|"failed"|"cancelled", "events": [{"step", "event": "start"|"skip"|"succeeded"|"failed", ...}], "report"?, "error"?, "log"?}`,
  where `log` holds the tail of the latest step's log. Cancelling kills the
  active step's entire process tree. The last four runs are retained.
- `POST /api/jobs` starts either a single extraction
  `{"projectionId", "before"}` (with optional `definitionRevision` so separately
  extracted revisions share a `definitionDigest`) or a comparison
  `{"projectionId", "before", "after"}` (with optional `definition`: `base` or
  `head`).
- `GET /api/jobs/:id` and `POST /api/jobs/:id/cancel` poll or cancel a job,
  returning
  `{"id", "status", "outputs", "diagnostics", "notices", "extraction" or "comparison"}`.
- `GET /api/explore` (repository mode) returns `{"session", "candidates"}`,
  matching `projections explore --list --json` (`session` indicates whether this
  is an explore session).
- `POST /api/sweep` and `GET /api/sweep` (repository mode): `POST` with
  `{"last"?, "projections"?, "pairs"?}` starts a new sweep (cancelling any
  previous one and returning `202`) across candidates and defined projections
  over the last `last` merges (1-100, default 20; pass `0` with `pairs` to sweep
  only explicit pairs) as in `explore --sweep`, plus up to 20 explicit `pairs`
  (`{before, after, title?}`, such as bookmarks, recorded as changes of kind
  `pair` and skipped if a commit isn't present here). Send `{"cancel": true}` to
  stop an active sweep and receive `{"sweep"}`. `GET` returns the current
  `{"sweep"}` with progress and cells, or `null`.
- `GET /api/sweep/thumbnail?projection=&before=&after=&theme=` returns a swept
  comparison's headless PNG thumbnail rendered in the requested `theme` (`light`
  by default, or `dark`), cached per sweep and theme so a new sweep regenerates
  them.
- `POST /api/adopt` takes
  `{"projections": [ID...], "bookmarks"?, "dryRun"?, "digest"?}` and returns
  `adopt`'s proposed or written files (definitions and bookmarks from the latest
  sweep):
  `{"files": [{"path", "before", "after", "created", "changed"}], "digest", "written", "adopted", "bookmarked"}`.
  Use `dryRun` to preview; writing requires the preview's `digest` (`409` if
  files changed since) and either an explore session or `--trust` (`403`
  otherwise).

Viewers normally compare at viewing time: they extract each revision with jobs
using a shared definition revision, then run the comparator fetched from
`/api/comparator` in the browser across any two extractions with matching
`definitionDigest`. Comparison jobs remain available for convenience, and
browser-safe types are exported from `@githubnext/projections-inspector`.

Jobs surface raw stdout and stderr, normalized extractions or comparisons, and
engine diagnostics (`TRUST_REQUIRED`, `RUNNER_ERROR`, or Engine codes). One job
executes at a time across all connected views (panels and projection tabs), with
up to 16 running or queued; the four most recent finished results stay in memory
without persisting raw output. `--document FILE` loads a validated offline
document and disables repository execution completely. `--png` runs the same
in-process service for a single document and opens its chrome-free
`?view=snapshot&theme=…&frame=…[&matte=…][&mode=…][&progress=…]` page, which
sets `<html data-projections-snapshot="ready">` once every pane finishes
painting (or `"failed"` with `data-projections-snapshot-error`).

The UI prompts for trust only when the active definition actually needs it
(`requiresTrust` or `rendererRequiresTrust`). Built-in extractors that never run
repository code work even without `--trust`, and the runner's `--trust` flag (a
trusted workspace in VS Code) is the sole source of trust—the UI can never grant
or expand it. Without trust, extractors that run repository code are disabled
and custom renderers requiring trust fall back to the built-in renderer for that
schema with a notice. Both saved comparison documents and comparison jobs show
their notices in the view.

Renderer bundles are served by path so relative subresource URLs keep working:

- `/renderers/<name>/<path>` serves the built-in renderer bundles embedded in
  the Inspector assets (`renderers/index.json` lists their manifests).
- `/custom-renderers/<capability>/<commit|working-tree>/<projection>/<path>`
  serves a custom renderer bundle from the projection's definition at that
  revision. Bundles with `rendererRequiresTrust` return 403 unless the backend
  was started with `--trust`. The capability token is a random per-service value
  exposed only via `/api/renderers`, and the revision segment is always a full
  commit hash or `working-tree` (never a symbolic ref—resolve symbolic refs via
  `commit` from `GET /api/definitions`) so relative subresources resolve
  cleanly. Only regular `index.html` and `renderer.json` files inside the
  declared bundle directory are served, never through symlinks or `..`.

Both routes apply `X-Content-Type-Options: nosniff` and the renderer content
security policy, which grants no origin (not even the Inspector's):
`default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; worker-src blob:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts`.
Any host presenting these bundles (for example, the VS Code extension relaying
them into its webview as Blob documents) preserves both that policy and the
sandbox.

## Fixtures mode

```sh
projections serve --stdio --fixtures packages/renderers/graph/scenarios.json packages/renderers/file-packing --renderer packages/renderers/graph/dist
projections serve --stdio --fixtures scenarios.json --renderer .
```

In VS Code, running **Projections: Open Renderer Scenarios…** on a renderer
package (or any folder containing `scenarios.json`) launches fixtures mode with
that `scenarios.json` and the package passed as `--renderer`. Running
`projections check` executes the same checks headlessly against a custom
renderer package's scenarios.

Pass `--fixtures <PATH>...` (repeatable, accepting individual files or
directories containing `scenarios.json`) to serve
[`projections.scenarios`](../contracts/scenarios.md) documents instead of a Git
repository. Pass `--renderer <DIR>...` (also repeatable) to supply renderer
bundles—either a directory containing `index.html` and `renderer.json`, or a
package whose `package.json` points to one via
`"projections": {"renderer": ...}`. Supplied bundles take precedence over
built-ins, letting you override a built-in renderer while developing it.
`--fixtures` cannot be combined with `--trust`, and `--renderer` requires
`--fixtures`. Missing paths fail at startup, and nothing executes: repository
endpoints (`definitions`, `revisions`, `comparator`, `jobs`) all return 403.

`GET /api/fixtures` returns
`{"generation", "sources", "renderers", "scenarios"}`:

- Each source represents a scenarios file with `key`, `path`, `title`, and an
  `error` if invalid.
- Each renderer carries a `key` (derived from its canonical path), `path`,
  `manifest`, and `url`
  (`/custom-renderers/<capability>/fixtures/<key>/index.html?v=<content digest>`),
  or an `error`.
- Each scenario carries `key` (`<source>/<id>`, where `<source>` is the folder
  name for `scenarios.json` and the filename otherwise), `source`, `id`,
  `title`, `group`, `description`, `renderer` (a name or
  `{"bundle": <renderer key>}`), `subject`
  (`{"mode": "extraction", "extraction"}` or
  `{"mode": "comparison", "before", "after"}`, normalized and validated by the
  Engine), `comparator` (`{"default": true, "options"}` or
  `{"rules": "<base64>", "id", "digest", "options"}`), and `presentation`—or an
  `error` (such as a missing extraction file) so one broken entry never blocks
  the rest.

A file watcher polls every watched path (scenario files, extraction files,
comparator files, and bundle files—even paths that don't exist yet) every 250 ms
and reloads on change, bumping `generation`; clients long-poll
`/api/fixtures/changes`. Exclusively in fixtures mode, every renderer
`index.html` served (both fixture bundles and built-in `/renderers/<name>/`) has
the Inspector's check probe (`fixtures/probe.js`) injected before `</head>` so
checks can measure the rendered document over a `MessagePort` without touching
the renderer protocol's window messages. Bundles keep the renderer content
security policy, serving only `index.html` and `renderer.json` and never
following symlinks.

To verify a scenarios document and everything it references from the command
line, run `projections validate scenarios.json`, which also executes each
comparison through its comparator.

The Inspector UI is packaged as `inspector`, a mountable library hosted by the
VS Code extension; a hosted view must never import or execute the runner
directly.

## Comparator tests

Tests for a custom comparator live right beside it—`X.comparator.test.yaml` for
`X.comparator.yaml` (see the
[comparator test format](../contracts/comparisons.md#comparator-tests)).
`projections check` runs them automatically as its `comparator-tests` step for
every projection using a custom comparator, right after the comparison and
before renderer and browser checks, even when the working tree fails to extract
(fixture-based cases don't require it).

The step passes with "N cases pass", fails listing the failing cases, warns if a
comparator has no test file (`No tests beside <file>: add <path>`), and is
skipped for the default comparator. Cases execute once per projection that uses
the comparator: cases without explicit options inherit that projection's
options, and `{revision}` sources extract with its working-tree definition—so
they require `--trust` when the extractor runs repository code (and are skipped
with a note otherwise).

Pass `projections check --update` to write or refresh snapshots (expectations
are never rewritten), with the step listing what it `written`. Pass
`projections check --coverage` to collect the comparator file's
[rule coverage](../contracts/comparisons.md#rule-coverage): the summary ends
with `coverage: functions 12/14 (85.7%), expressions …, branches …`, the JSON
step includes
`"coverage": {"comparator", "summary": {"functions" | "expressions" | "branches": {"covered", "total", "excluded", "percent"}}, "uncovered": [{"category", "path", "line", "column", "message"}], "excluded": [...], "entries"}`
(where `entries` is the summed `projections.rules-coverage` report), and the
text report prints each uncovered item as
`uncovered <file>:<line>:<column> <message>`.

Use `projections check -p <id> --no-render` as your fast inner loop. There is no
separate `projections test` command: agents and CI already run `check`, its
results are structured in `--json`, and editors integrate through the API below.
In `--json`, the step includes a repository-relative `file` and `cases`, each
shaped as
`{"id", "name", "status": "pass"|"fail"|"skip", "location": {"path", "line", "column"}, "durationMs", "failures": [{"expectation", "message", "location", "expected"?, "actual"?, "diff"?}], "message"?}`.
If a test file fails to parse, the step fails with `diagnostics`
(`{"pointer", "message", "location"}`). Text output prints each failing case's
name, `path:line:column`, expectation, and diff.

Editors can list and run comparator tests through `request` to power a test
explorer (such as VS Code's Testing view):

- `GET /api/comparator-tests` parses every test file next to a comparator file
  in the working tree (or next to any comparator file referenced by a
  definition) without running anything, returning
  `{"files": [{"path", "comparator", "projections": [ids], "cases": [{"id", "name", "location"}], "diagnostics": [...]}]}`.
  Unparseable files return no cases and report their diagnostics with locations.
- `POST /api/comparator-tests/run` takes
  `{"path"?, "cases"?, "projection"?, "update"?, "coverage"?}` to run all test
  files, a single `path`, specific case IDs, or one projection, returning
  `{"results": [{"path", "projection", "cases": [...], "written"?, "diagnostics"?, "coverage"?}]}`—one
  result per projection using the comparator (`projection: null` if none does,
  skipping revision cases). Case objects match the `check` step's schema.
  Running tests needs no `--trust` because comparators are sandboxed, though
  `update: true` writes snapshots and requires `--trust` (403 otherwise, like
  `POST /api/definition`), and revision cases whose extractor runs repository
  code are skipped without it. Passing `coverage: true` attaches each result's
  rule coverage in the same format as the step's `coverage`.

Clients re-list tests after receiving a `changes` notification; there is no
dedicated test-change notification.

```json
{"jsonrpc": "2.0", "id": 7, "method": "request", "params": {"method": "POST", "path": "/api/comparator-tests/run",
  "body": {"path": ".github/projections/deps/deps.comparator.test.yaml", "cases": ["core leads"]}}}
```

```json
{"jsonrpc": "2.0", "id": 7, "result": {"status": 200, "contentType": "application/json; charset=utf-8", "body": {"results": [{
  "path": ".github/projections/deps/deps.comparator.test.yaml", "comparator": ".github/projections/deps/deps.comparator.yaml",
  "projection": "deps", "cases": [{"id": "core leads", "name": "core leads", "status": "fail", "durationMs": 41,
    "location": {"path": ".github/projections/deps/deps.comparator.test.yaml", "line": 4, "column": 11},
    "message": "`package:@acme/core` (step 2) is not in a step before `package:@acme/docs` (step 1)",
    "failures": [{"expectation": "/cases/0/expect/order/1",
      "message": "`package:@acme/core` (step 2) is not in a step before `package:@acme/docs` (step 1)",
      "location": {"path": ".github/projections/deps/deps.comparator.test.yaml", "line": 8, "column": 34},
      "expected": ["package:@acme/core", "package:@acme/docs"], "actual": [2, 1]}]}]}]}}}
```
