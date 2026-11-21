# Stdio backend

```sh
projections serve --stdio [--trust] [-C DIR]
projections serve --stdio --document FILE
projections serve --stdio --fixtures PATH... [--renderer DIR...]
```

`--document FILE` presents a saved extraction, comparison or pull request review
instead of the repository, and `--fixtures` serves renderer scenarios (see
[Fixtures mode](#fixtures-mode)); neither runs anything, and neither takes
`--trust`. The VS Code extension opens them with **Projections: Open Artifact…**
and **Projections: Open Renderer Scenarios…**.

`serve --stdio` is the Inspector's backend for an editor extension that starts
it (the VS Code extension does), over its standard input and output. There is no
port or listener: only the process that started it can reach it. It serves the
repository at `-C DIR` (or the working directory) in repository mode, watching
the working tree; `--stdio` is required, as it is the only transport. Each
`request` is answered in memory by the Inspector service, whose request paths
are listed under [Requests](#requests). The CLI's headless pages (`--png`,
`check`) use the same service.

**Trust and writes.** With `--trust`, repository code (custom extractors and
renderers) runs, and `POST /api/definition` saves. An editor passes it only for
a trusted workspace. The candidates `GET /api/explore` lists (as
`projections explore` finds them at startup) are always trial definitions that
jobs, sweeps and comparators can use, so the Explore view can try and open them.
While the working tree defines no projections of its own, the backend is an
explore session: `GET /api/definitions` lists the candidates, and
`POST /api/adopt` writes after a preview (`dryRun`, then its `digest`) without
`--trust`; it only writes built-in definitions and bookmarks, never runs
repository code. Once the repository defines projections, `GET /api/definitions`
lists only those (and a candidate named by `include`, which the Explore view
opens), and adopting needs `--trust`.

**Framing.** JSON-RPC 2.0, one message per line: UTF-8 JSON with no newline
inside (NDJSON). Request lines are at most 1 MiB. Standard output carries only
protocol messages (on Unix, file descriptor 1 is pointed at standard error once
the protocol starts, so nothing else can write to it); diagnostics go to
standard error. Requests are answered concurrently (at most 64 at once), so
replies can arrive in any order; match them by `id`.

- `initialize` returns
  `{"protocol": 1, "version", "repository", "trusted", "explore", "mode"}`: the
  CLI version, the repository's absolute path, whether it has `--trust`, whether
  it is an explore session, and `mode`: `repository`, `document` or `fixtures`.
- `request`, with params `{"method": "GET"|"POST", "path", "body"?}`, returns
  `{"status", "contentType", "headers"?, "body"}`: the service's response, with
  an HTTP status, and in `headers` its `content-security-policy` and
  `x-content-type-options`, which a host presenting it applies. `path` is a
  server-relative path with its query under `/api/`, `/renderers/`,
  `/custom-renderers/` or `/inspector/` (no scheme, fragment, backslash, `.` or
  `..` segment or control character, at most 4096 characters); all but `/api/`
  are `GET` only. `/inspector/<path>` is the Inspector's own scripts, styles,
  Workers and Wasm (`mount.js`, `mount.css`, `packages/engine/`, `comparator/`),
  for a host that doesn't ship the UI, such as the renderer workbench; never a
  document or a renderer bundle. `body` (`POST` only) is the JSON request body.
  The result's `body` is the parsed JSON of a JSON response, `{"base64"}` for a
  binary one (a sweep thumbnail's PNG, Wasm) and text otherwise; response bodies
  over 64 MiB fail.
- `tools/list` returns `{"tools": [...]}`: the [agent tools](agent-tools.md),
  each
  `{"name", "title", "description", "inputSchema", "annotations", "trust", "view"}`,
  including the view actions `open_projection`, `current_view` and `refresh`
  (`view: true`), which the editor answers itself with its projection tabs.
- `tools/call`, with params `{"name", "arguments"?}`, returns
  `{"content": [{"type": "text", "text"}], "structuredContent", "isError"}`, as
  MCP's `tools/call` answers; an unknown tool is error `-32602`. Cancelled with
  `$/cancelRequest` like a `request`. A write's preview carries its `confirm`
  token in `structuredContent`; the editor asks the person and calls again with
  it.
- `shutdown` returns `null`; later `request`s and `tools/call`s fail.
- `exit` ends the process (a notification, or a request answered with `null`).

<!-- prettier-ignore -->
| Notification | Direction | Params |
|---|---|---|
| `$/cancelRequest` | to the backend | `{"id"}`: stops that request. Its work is cancelled (a long poll such as `/api/changes` ends at once) and it is answered with error `-32800` |
| `changes` | from the backend | `{"generation", "changes", "complete"}`, whenever the working tree's generation advances: what `GET /api/changes?since=N` returns for the previous generation `N` |
| `rendererBuilds` | from the backend | `{"sequence", "builds"}`, whenever a custom renderer build changes: what `GET /api/renderer-builds?since=N` returns for the previous notification's `sequence` `N`, so each output line is sent once |

An HTTP-level refusal is a normal result
(`{"status": 404, "body": {"diagnostics": [...]}}`). Protocol failures are
JSON-RPC errors: `-32700` invalid JSON, `-32600` not a request (or a line over 1
MiB, a duplicate in-flight `id`, or a request after `shutdown`), `-32601`
unknown method, `-32602` invalid `request` params, `-32603` the response could
not be relayed, `-32000` too many requests at once, `-32800` cancelled. The
backend exits with status 0 when standard input closes, on `exit`, or on SIGINT
or SIGTERM (Ctrl+C or Ctrl+Break on Windows), after cancelling its jobs, sweeps
and thumbnail renders.

## Requests

The responses the Inspector decodes have TypeBox schemas, and the service tests
hold these responses to them
([schema-owned contracts](../contracts.md#schema-owned-contracts)).

- `GET /api/definitions?ref=REV[&include=ID]`:
  `{"definitions", "policies", "ref", "commit"?, "executionAuthorized", "invalid"}`;
  `commit` is the full commit `ref` names when it isn't `working-tree` (a
  symbolic `HEAD` or branch resolved), which custom renderer URLs take;
  `invalid` lists the definition files that aren't valid, as `list` does, while
  the others load; with `include`, an explore candidate the backend offers
  outside an explore session (see [Stdio backend](#)) is listed too, as the
  Explore view opens it; `policies` has
  `{"id", "requiresTrust", "rendererRequiresTrust"}` for each definition, as
  `list` reports them, and for `working-tree`, `rendererDevServer`: the loopback
  URL of the custom renderer's running development server (see below), and
  `scenarios`: the repository path of its renderer package's `scenarios.json`.
- `GET /api/renderer-builds?since=N[&wait]`: Repository mode only:
  `{"sequence", "builds"}`, each custom renderer build's `projection`, `phase`
  (`building`, `built`, `failed` or `untrusted`), `error` (its first error line,
  or why it couldn't start), `script` (`watch` or `build`), `package`, `located`
  (the error names a file and position), `run` (each start of its script),
  `running`, `exit` (the last run's exit code) and `lines` (its output after
  sequence `N`, the last 2000 lines kept). With `wait`, it answers once there is
  something after `N`, or after 20 seconds.
- `POST /api/renderer-builds`: `{"projection", "event"}`: a view `opened` a
  projection (its renderer builds when its sources are newer than its bundle),
  its renderer's sources were `saved` (it builds, or a running `build` runs
  again after), may have `changed` (it builds when its sources differ from the
  last build's), or it `closed` it (a watcher stops). The renderer package's
  `watch` script runs once and rebuilds on every save, else its `build` runs
  once per save; without `--trust` nothing runs and the build is `untrusted`.
  Answers the builds without their output.
- `GET /api/changes?since=N`: Repository mode only:
  `{"generation", "changes", "complete"}`, at once when the working tree's
  generation differs from `N`, otherwise after a change or 20 seconds. `changes`
  lists what changed since `N`: `definitions`, `working-tree` (files
  `git status` reports, which extractors examine), and `extractor:<id>`,
  `renderer:<id>`, `comparator:<id>` or `scenarios:<id>` for a definition's
  declared files (`sources`, the extractor command's files, the comparator file,
  the renderer bundle and its development server record, the renderer package's
  `scenarios.json`). `complete` is false when `N` is older than the 64
  generations kept. `tree` is the working tree's identity after the latest
  change (the Git tree hash `provenance.execution.tree` records), when it could
  be computed, so a client can tell which shown extractions are out of date. A
  change is reported once the files have been quiet for 120 ms (at most 2 s), so
  an editor's save that truncates and then writes, or writes in chunks, is one
  change, never a half-written file. A job that reads the working tree waits the
  same way before reading, and if it fails while its definition or extractor and
  comparator files were still changing, reads them again once they settle and
  says so in `notices`.
- `GET /api/identity?projection=ID`: The working tree's current identity for
  projection `ID`, running nothing: `{"tree", "definitionDigest"}`. An
  extraction of the working tree whose `provenance.execution.tree` and
  `provenance.definitionDigest` both match it is current. With a scope it adds
  `scope`, `scopedTree` (the scope's Git objects, hashed) and `scopeVerified`;
  compare `scopedTree` instead of `tree` only when `scopeVerified` is true. A
  toolchain extraction run in place may also depend on ignored files (installed
  dependencies), which the identity doesn't cover.
- `GET /api/revisions?limit=N`: `{"revisions": [...]}` for a pair picker: the
  working tree
  (`{"ref": "working-tree", "commit", "title", "kind": "working-tree", "dirty"}`),
  then up to `N` (1-100, default 20) commits of `HEAD`'s history, newest first
  (`{"ref", "commit", "title", "kind": "commit", "date"}`).
- `GET /api/pairs[?projection=ID]`: Repository mode: the history a Before →
  After pair comes from, running nothing:
  `{"head": {"commit", "branch", "dirty"}, "defaultBranch", "mergeBase", "bookmarks", "tags", "branches", "suggestions", "default"}`.
  `tags` (20, newest first) and `branches` (30, by last commit; `current`) are
  `{"name", "commit", "date"}`; `defaultBranch` is `origin`'s, else `main` or
  `master`, and `mergeBase` the merge base with it when `HEAD` is on another
  branch. `suggestions` are pairs
  `{"before"?, "after", "label", "source", "bookmark"?, "identical", "backwards"?, "error"?}`
  in the order the default is chosen from: the projection's bookmarks
  (`.projections-bookmarks.json`), the merge base → working tree on a feature
  branch, the previous tag → `HEAD` (or `HEAD`'s tag), `HEAD~1 → HEAD`, and
  `HEAD → working tree` when it has changes. A pair whose sides hold the same
  Git tree is `identical` (its comparison is empty) and is left out unless it is
  a bookmark; sides that differ only in files the extractor ignores aren't
  detected, since knowing that would mean running the extractor. `backwards`
  marks a pair whose After is older than its Before (an ancestor of it, or After
  a commit and Before the working tree), as a bookmark can be; `default` is the
  first suggestion that has changes, resolves and doesn't run backwards, else
  `HEAD` (or the working tree) alone.
- `POST /api/definition`: Repository mode:
  `{"projectionId", "parts", "dryRun"?, "digest"?}` saves parts (`extractor`,
  `comparator`, `renderer`; `null` removes an optional one) to the working
  tree's definition file, keeping its other fields, their order and the file's
  indentation, and validating the result.
  `{"path", "before", "after", "digest", "changed", "written"}`. `dryRun`
  previews; saving needs the preview's `digest` (`409` when the file changed
  since) and an Inspector started with `--trust` (`403` otherwise). The
  Inspector's **Save to definition** uses it.
- `GET /api/scenarios?projection=ID`: Repository mode: the working tree's
  projection's renderer package scenarios,
  `{"file", "scenarios": [{"id", "title", "description"?, "before"?, "after"} or {"id", "title", "error"}]}`,
  each extraction made an extraction document with the working tree's definition
  as `show --from FILE -p ID` makes one (nothing runs); `file` is `null` without
  a `scenarios.json`. The Inspector offers them in its **Scenario** picker
  beside the live working tree.
- `GET /api/comparator?projection=ID&ref=REV`: The comparator a viewer runs for
  the projection defined at `REV` (default `working-tree`): `{"default": true}`
  (the module is `engine/default-comparator.wasm`) or
  `{"rules": "<base64 comparator file>", "digest": "sha256:<comparator digest>"}`.
  `?rules=PATH&ref=REV` returns any `*.comparator.yaml` file of that revision
  the same way, so the Inspector can try it as a projection's comparator.
- `GET /api/comparator-tests`: Repository mode: the working tree's comparator
  test files, parsed, running nothing; see
  [Comparator tests](#comparator-tests).
- `POST /api/comparator-tests/run`: Repository mode:
  `{"path"?, "cases"?, "projection"?, "update"?, "coverage"?}` runs them,
  sandboxed, without `--trust`; `update` writes snapshots and needs `--trust`
  (403 otherwise); see [Comparator tests](#comparator-tests).
- `GET /api/renderers`:
  `{"renderers": [<renderer.json manifests>], "customRendererBase": "/custom-renderers/<capability>/"}`
  (`customRendererBase` is `null` for a saved document; `--png` serves the
  document's custom renderer).
- `GET /api/document`: `{"document"}` for `--document FILE` and `--png`,
  otherwise `null`.
- `GET /api/fixtures`: Fixtures mode only (404 otherwise); see
  [Fixtures mode](#fixtures-mode).
- `GET /api/fixtures/changes?since=N`: Fixtures mode only: `{"generation"}`, at
  once when it differs from `N`, otherwise after a change or 20 seconds.
- (development servers): A custom renderer package running `npm run dev` with
  the renderer SDK's Vite configuration records its loopback URL in
  `node_modules/.projections/renderer-dev-server.json`. While it answers
  `/__projections/renderer.json` as the same renderer, the working tree's
  renderer (a bundle `<package>/dist` beside `<package>/package.json`), or a
  `--renderer <package>` in fixtures mode (`"development": true`, `url` the
  server), loads from it with hot updates instead of the built bundle. A host
  that can reach it frames it from `http://localhost:*` or `http://127.0.0.1:*`
  with the same sandbox (a VS Code webview can't, so there the built bundle is
  used: the backend runs the package's `watch` script on save while the
  projection's tab is open (`/api/renderer-builds`), or run `npm run watch`).
- `GET /api/environment`: The environment as `projections doctor` reports it:
  `{"declared", "prepare": [{"id", "run", "key", "state": "current"|"stale"|"failed"|"never", "last"?}], "toolchain", "devcontainer", "missing", "workspace": {"strategy", "source", "reason"}, "workspaces"}`;
  `declared` is null without an environment file. Runs nothing.
- `POST /api/prepare`: Starts preparing `{"revision"?, "steps"?, "force"?}`, as
  `projections prepare` does (the working tree without `revision`), answering
  `202` with the run; one runs at a time (`409`). Needs `--trust` (`403`).
- `GET /api/prepare/:id`, `POST /api/prepare/:id/cancel`: The run:
  `{"id", "status": "running"|"succeeded"|"failed"|"cancelled", "events": [{"step", "event": "start"|"skip"|"succeeded"|"failed", ...}], "report"?, "error"?, "log"?}`,
  `log` being the end of the latest step's log; cancelling stops the running
  step's whole process tree. The last four runs are kept.
- `POST /api/jobs`: Starts `{"projectionId", "before"}` (one extraction;
  optional `definitionRevision` applies that revision's definition, so
  separately extracted revisions share a `definitionDigest`) or
  `{"projectionId", "before", "after"}` (a comparison; optional `definition`:
  `base` or `head`).
- `GET /api/jobs/:id`, `POST /api/jobs/:id/cancel`:
  `{"id", "status", "outputs", "diagnostics", "notices", "extraction" or "comparison"}`.
- `GET /api/explore`: Repository mode: `{"session", "candidates"}`, what
  `projections explore --list --json` lists now (`session`: whether this is an
  explore session, see below).
- `POST /api/sweep`, `GET /api/sweep`: Repository mode:
  `{"last"?, "projections"?, "pairs"?}` starts sweeping the candidates and
  defined projections (or the named ones) over the last `last` (1-100, default
  20; `0` with `pairs`: only the pairs) merges, as `explore --sweep`, and over
  `pairs` (at most 20 `{before, after, title?}`, such as bookmarks, swept at the
  commits they name as changes of kind `pair`; one that names no commit here is
  left out), cancelling the sweep before (`202`); `{"cancel": true}` stops the
  running sweep and answers `{"sweep"}`; `GET` returns `{"sweep"}`, its progress
  and cells, or `null`.
- `GET /api/sweep/thumbnail?projection=&before=&after=&theme=`: A swept
  comparison's PNG thumbnail, drawn headlessly with its renderer in the `theme`
  colour mode (`light`, the default, or `dark`); kept per sweep and theme, so a
  new sweep draws them again.
- `POST /api/adopt`:
  `{"projections": [ID...], "bookmarks"?, "dryRun"?, "digest"?}`: `adopt`'s
  files (definitions and bookmarks from the latest sweep),
  `{"files": [{"path", "before", "after", "created", "changed"}], "digest", "written", "adopted", "bookmarked"}`.
  `dryRun` previews; writing needs the preview's `digest` (`409` when the files
  changed since) and an explore session or `--trust` (`403` otherwise).

Viewers compare at viewing time: extract revisions with jobs (one definition
revision for all of them), then run the comparator from `/api/comparator` in the
browser on any two extractions with matching `definitionDigest`. Comparison jobs
remain for convenience. Browser-safe types are exported from
`@githubnext/projections-inspector`. Jobs expose raw stdout/stderr, normalized
extraction/comparison and engine diagnostics (`TRUST_REQUIRED` or
`RUNNER_ERROR`, or Engine codes). One run is active at a time: jobs from every
client (a panel, each projection tab) queue for it, at most 16 running or
waiting; four finished results are retained in memory, with no raw-output
persistence. `--document FILE` loads a validated offline document and forbids
repository execution entirely. `--png` runs the same service in the CLI process
for one document and opens its chrome-free
`?view=snapshot&theme=…&frame=…[&matte=…][&mode=…][&progress=…]` page, which
sets `<html data-projections-snapshot="ready">` once every pane has painted, or
`"failed"` with `data-projections-snapshot-error`.

The UI asks for trust only when the selected definition needs it
(`requiresTrust` or `rendererRequiresTrust`); built-in extractors that run no
repository code extract without it, even when the runner was started without
`--trust`, and the runner's `--trust` (in VS Code, a trusted workspace) is the
only grant: the UI can't grant or widen it. Without it, extraction that runs
repository code is disabled and a renderer that requires trust is replaced by
the built-in renderer for the schema, with a notice. Comparison documents and
comparison jobs display their notices in the view.

Renderer bundles are requested by path, so relative subresource URLs keep
working:

- `/renderers/<name>/<path>`: the built-in renderer bundles in the Inspector
  assets (`renderers/index.json` lists their manifests).
- `/custom-renderers/<capability>/<commit|working-tree>/<projection>/<path>`: a
  custom renderer bundle from the projection's definition at that revision. A
  bundle whose `rendererRequiresTrust` is true is refused (403) unless the
  Inspector was started with `--trust`. The capability is a random per-service
  value exposed only through `/api/renderers`; the revision is a path segment (a
  full commit or `working-tree`, never a symbolic ref: a client resolves one
  with the `commit` of `GET /api/definitions`) so relative subresource URLs keep
  it. Only regular files inside the declared bundle directory are served, never
  through symlinks or `..`, and only `index.html` and `renderer.json`.

Both use the renderer content security policy, which grants no origin (not even
the Inspector's), and `X-Content-Type-Options: nosniff`:
`default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; worker-src blob:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts`.
A host that presents them (the VS Code extension relays them into its webview as
Blob documents) keeps that policy and the sandbox.

## Fixtures mode

```sh
projections serve --stdio --fixtures packages/renderers/graph/scenarios.json packages/renderers/file-packing --renderer packages/renderers/graph/dist
projections serve --stdio --fixtures scenarios.json --renderer .
```

In VS Code, **Projections: Open Renderer Scenarios…** on a renderer package (or
a folder with a `scenarios.json`) starts it with the package's `scenarios.json`
and the package as `--renderer`. `projections check` runs the same checks on a
custom renderer package's scenarios headlessly.

`--fixtures <PATH>...` (repeatable; one or more files, or directories holding a
`scenarios.json`) serves [`projections.scenarios`](../contracts/scenarios.md)
documents instead of a repository. `--renderer <DIR>...` (repeatable) adds
renderer bundles: a directory with `index.html` and `renderer.json`, or a
package whose `package.json` names one in `"projections": {"renderer": ...}`.
They are resolved before the built-in bundles, so a bundle under development
replaces a built-in of the same name. `--fixtures` excludes `--trust`;
`--renderer` requires `--fixtures`. Missing paths fail at startup. Nothing is
executed: the repository APIs (`definitions`, `revisions`, `comparator`, `jobs`)
answer 403.

`GET /api/fixtures` returns
`{"generation", "sources", "renderers", "scenarios"}`. Each source is a
scenarios file (`key`, `path`, `title`, and an `error` when it is invalid). Each
renderer has a `key` (from its canonical path), `path`, `manifest` and `url`,
`/custom-renderers/<capability>/fixtures/<key>/index.html?v=<content digest>`,
or an `error`. Each scenario has `key` (`<source>/<id>`, where `<source>` is the
directory name for `scenarios.json` and the file name otherwise), `source`,
`id`, `title`, `group`, `description`, `renderer` (a name or
`{"bundle": <renderer key>}`), `subject` (`{"mode": "extraction", "extraction"}`
or `{"mode": "comparison", "before", "after"}`, normalized and validated by the
Engine), `comparator` (`{"default": true, "options"}` or
`{"rules": "<base64>", "id", "digest", "options"}`) and `presentation`, or an
`error` (for example a missing extraction file); one broken file never stops the
others.

A watcher polls every watched path (scenario files, extraction files, comparator
files and bundle files, including paths that don't exist yet) every 250 ms and
reloads on any change, incrementing `generation`; the client long-polls
`/api/fixtures/changes`. In fixtures mode only, every renderer `index.html` the
service sends (fixture bundles and the built-in `/renderers/<name>/`) has the
Inspector's check probe (`fixtures/probe.js`) injected before `</head>`; the
checks use it to measure the renderer document over a `MessagePort`, never the
renderer protocol's window messages. Bundles keep the renderer content security
policy, and only `index.html` and `renderer.json` are served, never through
symlinks.

`projections validate scenarios.json` checks a scenarios document and everything
it references, running each comparison through its comparator.

The UI is `inspector`, a mountable package; the VS Code extension hosts it. A
hosted view must never import or execute the runner.

## Comparator tests

A comparator file's tests live beside it, `X.comparator.test.yaml` for
`X.comparator.yaml`
([the format](../contracts/comparisons.md#comparator-tests)).
`projections check` runs them for every projection with a custom comparator, as
its `comparator-tests` step, after the comparison and before the renderer and
browser checks, and even when the working tree doesn't extract (fixtures don't
need it). The step passes with "N cases pass", fails naming the failed cases,
warns when the comparator file has no test file
(`No tests beside <file>: add <path>`), and is skipped for the default
comparator. Cases run once per projection using the comparator: a case without
options takes that projection's, and `{revision}` sources extract with its
working-tree definition, so they need `--trust` when its extractor is repository
code (otherwise those cases are skipped, saying so).
`projections check --update` writes or rewrites snapshots, never expectations,
and the step lists what it `written`. `projections check --coverage` adds the
comparator file's [rule coverage](../contracts/comparisons.md#rule-coverage):
the message ends with
`coverage: functions 12/14 (85.7%), expressions …, branches …`, the step carries
`"coverage": {"comparator", "summary": {"functions" | "expressions" | "branches": {"covered", "total", "excluded", "percent"}}, "uncovered": [{"category", "path", "line", "column", "message"}], "excluded": [...], "entries"}`
(`entries` being the summed `projections.rules-coverage` report), and the text
report prints each uncovered entry as
`uncovered <file>:<line>:<column> <message>`.

`projections check -p <id> --no-render` is the fast loop; there is no separate
`projections test` command: agents and CI already run `check`, its step is data
in `--json`, and editors use the API below. In `--json` the step carries `file`
(repository-relative) and `cases`, each
`{"id", "name", "status": "pass"|"fail"|"skip", "location": {"path", "line", "column"}, "durationMs", "failures": [{"expectation", "message", "location", "expected"?, "actual"?, "diff"?}], "message"?}`;
a test file that doesn't parse fails the step with `diagnostics`
(`{"pointer", "message", "location"}`). The text report prints each failed case
with its name, `path:line:column`, the expectation and the diff.

Editors list and run them through `request`, for a test view (such as VS Code's
Testing view):

- `GET /api/comparator-tests` parses every test file beside a comparator file in
  the working tree (and beside any comparator file a definition names), running
  nothing:
  `{"files": [{"path", "comparator", "projections": [ids], "cases": [{"id", "name", "location"}], "diagnostics": [...]}]}`.
  A file that doesn't parse has no cases and lists its diagnostics with their
  locations.
- `POST /api/comparator-tests/run` with
  `{"path"?, "cases"?, "projection"?, "update"?, "coverage"?}` runs every file,
  or one (`path`), optionally only some of its cases (by ID) or one projection's
  run, and answers
  `{"results": [{"path", "projection", "cases": [...], "written"?, "diagnostics"?, "coverage"?}]}`,
  one result per projection using the comparator (`projection: null` when none
  does; its revision cases are skipped). The cases are the `check` step's.
  Running needs no `--trust`: comparators run sandboxed. `update: true` writes
  snapshots, so it needs `--trust` (403 otherwise), like `POST /api/definition`;
  revision cases whose extractor is repository code are skipped without it.
  `coverage: true` adds each result's rule coverage, as the step's `coverage`.

Clients re-list after a `changes` notification; there is no notification of its
own.

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
