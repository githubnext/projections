# Agent viewer

Status: **decided; being built in four phases (below).** VS Code stays the only
interactive authoring surface. This adds a second, focused surface: a read-only
browser page that a coding agent drives while a person watches.

## Why

When a coding agent runs in a terminal (GitHub Copilot CLI, Codex, Claude Code),
it can compare revisions and summarize what changed, but the person sitting next
to it can't see the projection. They want to watch the animation, scrub through
steps, zoom in, and click a card — without editing anything there (if something
looks wrong, they just tell the agent). The page needs to work in any browser
the agent can open, as well as inside the GitHub Copilot app's canvas.

## Decisions

### 1. `projections view` serves one page on loopback

`projections view` serves a single page on `127.0.0.1` and prints its URL (pass
`--open` to launch the default browser). The path begins with a random 256-bit
session token — `http://127.0.0.1:PORT/TOKEN/` — so every relative request the
page makes (its script, the shared engine, renderer frames, and API calls)
carries it. The listener binds loopback only and rejects any request whose
`Host` isn't a loopback address (`127.0.0.1`, `localhost`, or `[::1]` on this
port) with 403, blocking DNS rebinding.

**Stable URLs across restarts.** People bookmark the link, app panes keep it
open, and browser tabs reconnect to it, so a viewer restarted after an idle
timeout, `view stop`, or a reboot should come back at the same address. We store
the token and port per project in the per-user cache next to the state record
(`views/<key>.address.json`, mode `0600` in a `0700` directory, read only if it
is a regular file owned by the current user and unreadable by others) — never
inside the repository. On startup, the viewer reuses the saved token and port
(falling back to any free port if the old one is busy, and saving that new
port). Passing `--port N` to `projections view` or `projections view show` pins
that port: it either binds there or fails loudly if the port is occupied, never
silently picking another. If a viewer is already running, requesting a different
`--port` is refused until you stop it, because each project has one viewer and
one URL its open pages expect. Running `projections view stop --rotate` (or
deleting the file) discards the saved address so the next viewer starts with a
fresh token and port, invalidating all prior links — handy if you ever paste a
screenshot or log containing the URL.

Persisting the token across restarts doesn't weaken the security boundary. It
already lived in an owner-only file while a viewer ran, guarding against other
local users and against web pages that can hit loopback without reading
responses (no CORS, plus the `Host` check). The only thing that changes is how
long a leaked link stays valid, which `--rotate` lets you cut short.

**The bare port explains itself and leaks nothing.** Any request whose path
doesn't start with the token (the bare port, a typo, or a pre-rotation link)
gets a 404 with a minimal no-script, no-load page explaining that this is the
Projections viewer, that it requires its full link, and that
`projections view current` (or the agent) can print it. It never includes the
token and never redirects to the tokenized URL — a redirect would turn the bare
port into the secret and hand the token to any local process or browser page
able to reach loopback. Because the `Host` check runs first, DNS rebinding pages
don't even see the 404 page; non-GET methods get a bare 404.

Under the hood, the server is a thin HTTP wrapper around the existing CLI
service (`inspector::Service`) shared by `serve --stdio` and `projections mcp`.
It reuses the same jobs, pairs, identity checks, working-tree tracking, and
extraction cache with zero duplicated extraction logic. It exposes only
read-only viewer routes — definitions, revisions, pairs, scenarios, renderers,
comparator, starting/cancelling extraction jobs, and long-polling changes — and
never forwards writes (`/api/definition`, adopt, prepare, sweeps, or comparator
test runs).

The page uses the Inspector's CSP (`INSPECTOR_CSP`) minus `frame-ancestors` so
the Copilot app can embed it in a canvas. Allowing framing grants no extra
power: the page has no write endpoints, and any embedder must already possess
the token.

A per-repository **state file** in the per-user cache
(`views/<digest of the repository root>.json`, mode `0600`, never in the repo)
tracks the active server's URL, token, PID, and whether `--trust` is enabled so
subcommands and `projections mcp` can find it. Because a stale record can
survive a crash or reboot, we only trust it if the PID is alive and
`control/state` at that URL confirms the same PID; otherwise it is cleaned up
and replaced.

`projections view stop` shuts down the running viewer via `control/stop`, giving
in-flight requests two seconds before closing them so open long-polls never hang
shutdown. Running `projections view --trust` (or
`projections view show --trust`) replaces an untrusted viewer in place at the
same port and token when free, so open pages — including the Copilot canvas —
reconnect seamlessly.

### 2. The server owns the view state

Each named viewer holds a single **view state** on the server:
`{projection, choice or before/after, mode, selection, scenario, chosenBy, reportedBy, generation}`.
Pages long-poll `GET TOKEN/view/state?since=N` (just like the Inspector
long-polls working-tree changes) and send user interactions back via
`POST TOKEN/view/report` (selection, mode, playback position, and the `PageView`
summary shape VS Code tabs report). Long-polling plus POST avoids adding SSE or
WebSocket dependencies for state that changes infrequently and carries small
payloads.

Multiple open pages mirror each other automatically: any report updating
selection or mode updates the server state and broadcasts to the rest, with the
newest report winning. Because the state records which page sent it
(`reportedBy`), that originating page recognizes its own echo and doesn't undo
interactions the person made in the meantime, while every other page applies the
update. Each page sends one report at a time—holding the latest until the
in-flight request finishes—so an older report never arrives after a newer one.

**Counting open pages.** A page counts as open as long as it keeps polling its
viewer's state. Each page generates a random ID using `crypto.getRandomValues`
(not `crypto.randomUUID`, which requires a secure context — a page framed inside
a plain-HTTP or custom-scheme app isn't a secure context even on loopback; for
the same reason, without `crypto.subtle`, the engine hashes the default
comparator in JavaScript) and attaches that ID to every long poll and report.
After 45 seconds without a poll, the page ages out. We check nothing else — no
`Origin`, visibility state, or connection type. Because each long poll returns
within 20 seconds, a live page registers quickly, while a suspended background
tab or collapsed pane drops off until it wakes up. Counts are tracked per named
viewer (so `?viewer=api` doesn't count toward the default viewer), and
`current_view` reports each viewer's active pages.

When a viewer has no open pages, `current_view` summarizes what the server saw
over the past 10 minutes: pages that loaded HTML without running scripts
(embedder blocked scripts), pages whose script loaded but never polled (script
error or misrouted requests), pages that went quiet, requests rejected for a
non-loopback `Host` (a proxy rewriting the host header, which can't be permitted
without opening DNS rebinding), and requests missing the token. It reports only
counts and ages — never raw `Host` headers or paths — so an untrusted page
cannot inject text into tool output. If nothing hit the server at all, it says
so. (Chrome's Local Network Access checks also block loopback iframes from
non-secure contexts, so an HTTP host on another origin won't load the frame at
all, and the viewer reports seeing nothing.)

**Named viewers.** One server can host up to 32 independent views so an agent
can show multiple projections side by side. Each **named viewer** has its own
state, page count, and URL (`TOKEN/?viewer=NAME`, lowercase letters, digits, and
hyphens, up to 40 characters); the unnamed default viewer lives at `TOKEN/`. A
named viewer is created on first use, lives until the server stops, polls and
reports with its name (`view/state?viewer=NAME` and `viewer` in reports), and
only mirrors pages sharing that name. Agents target one with `viewer` on view
tools and `screenshot`, or `--viewer NAME` on `projections view` subcommands,
and `current_view` lists all other active viewers. Non-view tools (`compare`,
`check`, `set_part`) still default to the default viewer. Keeping everything in
one server means one token, one trust decision, one state record, and one shared
extraction cache — and `projections view --trust` upgrades every viewer at once.

**Letting the person switch projections.** The header's title doubles as a
projection switcher (decision 3). Picking another projection posts
`{viewer, projection}` to `POST TOKEN/view/choose`, behaving like
`open_projection` with only a projection name: it keeps the current pair, clears
mode and selection, updates that viewer's state for all mirrored pages, and sets
`chosenBy` to `person` (vs. `agent`) so `current_view` tells the agent who
picked it. Nothing else from the page can change what's displayed; the server
only serves projections defined in the working tree and enforces the same trust
rules for renderer builds.

**Live updates.** By default the viewer uses the working-tree definition, so
editing a definition, extractor input, or renderer automatically re-extracts and
replays (matching a VS Code tab's default "your edits" mode). Pairs of committed
revisions stay fixed on disk. If the viewer can't tell whether output is fresh
(for instance while a renderer rebuilds), the status line says so, and calling
`refresh` (or `projections view refresh`) re-extracts.

Passing `projections view --definition-revision REV` extracts both sides using
that revision's definition instead (just like `compare --definition-revision`),
and `screenshot` uses the exact same definition so images match what's on
screen.

### 3. The page shows the stage and nothing else

The page mounts the Inspector bundle with `chrome: 'viewer'`: the bare stage VS
Code tabs use (`chrome: 'none'`), paired with the Default UI host
(`@githubnext/projections-host`) — toolbar (Diff, Side by side, Animated,
Swipe), playback, zoom, settings menu, renderer frame, summary bar, and notices.
On top sit two compact elements:

- A **one-line header** with the Projections mark, the projection title, and
  (muted at the right end) what's being compared in plain words: "Branch
  changes", "Uncommitted changes", "Last commit", "Current state", a bookmark
  title, or two commit subjects with an arrow between them — never file paths or
  raw refs. Each revision sits in a 20px-tall pill with a 1px border, full
  rounding, no fill, and cap-centered text, using up to half the row with
  ellipsis truncation and full tooltips (long titles truncate first). Header
  text is cap-height centered with matching padding around the Projections mark.

  When the repo has two or more projections, the **title is the projection
  menu**, opening the Inspector's projection switcher (searchable by title or
  ID, IDs in monospace, active item checked). At rest it looks like a plain
  title with a subtle trailing chevron; hover or open state adds a soft 24px
  wash overhanging 6px on each side so nothing shifts, and keyboard focus shows
  a focus ring. Enter, Space, or Arrow Down open it, and assistive technology
  sees a button with a dialog popup named "TITLE, switch projection".

- A quiet **status line** just before the comparison pill ("Extracting…",
  "Building renderer…", "Waiting for the agent…", "Out of date").

Below the header, the chrome sits completely flat edge to edge, matching the
default UI everywhere: the toolbar shares the header's background with no card
borders or rounded corners, separated from the stage by 1px divider hairlines,
while the stage runs full-bleed to both edges. A renderer's legend and the
summary bar float together over the stage's foot as a single overlay (see
[the utility area](utility-area.md)). Each boundary in the stack (header,
toolbar, stage) is a single 1px divider hairline, and each renderer frame
extends 1px past its clipped container so fractional heights never create a
double-line seam. The toolbar spans full width in every state,
and nothing repeats: for a single committed revision (anything other than the
working tree), the toolbar simply shows its short commit hash where the
comparison mode switch would sit. While extraction is running, loading panes say
"Extracting…" instead of "Loading renderer".

**Handling a stopped server.** If the viewer exits or the machine sleeps, the
status line and a stage overlay display "Viewer stopped" and advise asking the
agent to show the projection again or reopening the page. The stage disables
input so controls don't look responsive while dead, and the page keeps polling
so it recovers automatically if the same viewer comes back.

There is no sidebar, no Definition or file rows, no **+ New**, no editing, and
no raw file paths. Errors appear in plain language ("The extractor didn't run.
The agent has the details."), while full diagnostics and paths go to the agent
via `current_view` (notices mentioning paths stay off the page for the same
reason). The page never prints CLI commands. If a projection needs trust the
viewer doesn't have, the page tells the user to ask the agent to review the
projection's code and restart the viewer with trust, while `current_view` tells
the agent to run `projections view --trust` so the page reconnects. The agent
decides; the page grants nothing.

The user can switch modes, play and scrub, zoom, adjust settings, select items,
and switch projections from the title. Selections and projection switches are
reported back so the agent always knows what the user is pointing at ("this
one's wrong").

**Theme.** Light and dark modes follow `prefers-color-scheme` by default. Inside
the Copilot app, a lightweight adapter maps the canvas's CSS variables —
`--background-color-default`, `--border-color-default`, `--text-color-default`,
`--text-color-muted`, `--color-focus-outline`, `--font-sans`, `--font-mono`,
`--text-body-medium`, and `data-color-mode` — onto ours (just as `host-vscode`
maps VS Code's), forwards them to renderer frames so the stage matches, and sets
`--status-bar-color`. Dividers, card borders, and pane-label rules use the app's
`--border-color-default`, while meaningful lines like links, controls, and
change rings keep 3:1 contrast (`color-connector`). All chrome bands sit flat on
the app's background.

Other apps embedding the page in a browser pane (custom agent harnesses) can
pass a **theme seed** in the URL via `?theme=` (generated by
`projections view --theme`): `{"light": {...}, "dark": {...}}`, where each mode
provides `background` and optional `text`, `muted`, `border`, `accent`, `focus`,
`sans`, and `mono`. These feed the exact same `appThemeTokens` mapper used by
the canvas adapter; both host core's `parseThemeSeed` (accepting only colors
`parseColor` parses and plain font lists) and the CLI validate it. The seed
lives purely in the URL — never in server state or on disk — so another window
on the same viewer keeps its own theme. Per page, a seed overrides the app
theme, which overrides the default, and any omitted mode falls back to the
page's own. Two presets ship built in: `--theme chatgpt` (ChatGPT and Codex
desktop apps) and `--theme claude` (Claude Code's Preview pane), tuned in both
light and dark modes to match neighboring panes (Files, Terminal) in surface,
rules, text, and link blue (with the 6 px pane backdrop belonging to the app's
chrome). Like the Copilot canvas, seeds apply their `border` verbatim on rules
and card edges even below 3:1, while semantic connectors hold 3:1 via
`color-connector`. See
[the agent tools docs](../runner/agent-tools.md#a-theme-seed-for-another-apps-browser-pane)
for the seed format and how agents discover their host app's colors.

### 4. One tool catalog, answered by whichever surface shows the view

Every surface exposes the **exact same** agent tools — one catalog, one set of
names and schemas — with only the backing view surface differing:

<!-- prettier-ignore -->
| Tool | VS Code | `projections mcp` |
| --- | --- | --- |
| `open_projection` | Opens or focuses a projection tab | Starts or reuses the viewer and shows it there; returns its URL |
| `current_view` | What the projection tab in front shows | What the viewer shows, from the page's latest report |
| `refresh` | Extracts the front tab's pair again | Extracts the viewer's pair again |
| `screenshot` | Rendered by the CLI from the front tab's pair, mode, playback, theme and size | The same, from the viewer's |

- `open_projection`, `current_view`, and `refresh` are the **view actions**
  (`view: true` in the catalog, replacing `editor`), answered by whichever
  surface hosts the view. `serve --stdio` lists them and delegates them to the
  extension; `projections mcp` answers them through the viewer (either
  in-process or by connecting to an existing viewer via the per-repository state
  file).
- `open_projection` keeps its existing inputs (projection, before/after, entity,
  pin) and adds `viewer` (a named viewer from decision 2), `choice` (`branch`,
  `uncommitted`, `last-commit`, `now`, `release`, or `bookmark:<id>`, matching
  VS Code's choices), `mode`, and `scenario` (from the projection's
  `scenarios.json`). `pin` only applies in VS Code, which has multiple tabs; the
  viewer ignores it.
- `current_view` shares one result shape (modeled in
  `packages/integrations/vscode/src/current-view/types.ts` with a Rust mirror in
  the viewer): projection and definition file, choice and resolved revisions,
  mode, selection, summary figures, changed items, extraction failure reasons,
  out-of-date flag, and whether uncommitted definition edits are active. In the
  viewer, the first line reports the viewer name and URL instead of a tab, notes
  if the person chose the projection, and lists any other active named viewers.
  Both `current_view` and `refresh` accept `viewer` to target a named viewer.
- `screenshot` is an ordinary tool rather than a view action — it renders
  server-side using the CLI's headless renderer (`--png`), so it works even when
  the agent can't see the browser or no page is open. Omitted inputs
  (projection, revisions, mode, playback position, theme, size) default to the
  current view, so both surfaces run the same code (VS Code fills defaults from
  the front tab and calls the backend). It returns an MCP image content part, or
  a `LanguageModelDataPart` in VS Code.
- Current-view defaults apply across the board: `compare`, `check`,
  `describe_part`, `set_part`, and `screenshot` fall back to the viewer's
  current view in `projections mcp` (`with_view_defaults`) just as they fall
  back to the active tab in VS Code (`withTabDefaults`). That makes their
  projection argument optional with identical schemas and descriptions
  everywhere.

`tools/list` is identical between `serve --stdio` and `projections mcp`, and VS
Code's `languageModelTools` are generated straight from it
(`packages/integrations/vscode/test/tools.test.mjs` enforces tool-for-tool
parity). The only VS Code-specific adjustments are adding a `folder` input for
multi-root workspaces and dropping `confirm` because VS Code prompts the user
for write approval itself.

**CLI equivalents for agents without MCP:** `projections view show …`,
`projections view current [--json]`, `projections view screenshot --out FILE`,
and `projections view refresh` (all accepting `--viewer NAME`). They call the
running server's token-protected control endpoints (`TOKEN/control/tool/NAME`),
returning the exact same text and JSON as the MCP tools.

`projections view screenshot --page` is the one CLI-only option: it captures the
full viewer page — header, toolbar, and summary bar around the stage — instead
of just the projection. The CLI opens the viewer URL in its headless browser
with `?capture`, which polls without a page ID and sends no reports so it never
counts as a real user page or alters `current_view`. Once the page finishes
settling (extraction done or failed, renderer built), it sets
`data-projections-viewer="ready"`, and capture waits for that plus two identical
frames. It reflects the viewer's current projection, pair, mode, selection,
size, and color mode (though not the user's playback position or zoom). It stays
a CLI subcommand rather than an input on `screenshot` to keep the tool catalog
uniform across surfaces, since VS Code can't capture its own webview chrome.
`view show` auto-starts a background server if none is running (exiting after 15
minutes with no open pages or requests), and `projections view stop` shuts it
down early.

### 5. Renderer builds move into the CLI service

Previously, a custom renderer's `watch` script ran as a VS Code task
(`packages/integrations/vscode/src/renderer-builds.ts` spawning npm). Moving
that orchestration into the CLI service (`packages/cli/src/renderer_builds/`)
lets `projections view` rebuild on save too: the service runs `watch` (or falls
back to `build` per save), parses its output for build status, and retains logs.
Views notify it when a projection opens (`opened`), when renderer sources are
saved (`saved` from VS Code) or may have changed (`changed` from the viewer's
working-tree watch, rebuilding only when the source fingerprint moves), and when
a projection closes (`closed`, stopping the watcher). VS Code consumes the same
service via `rendererBuilds` notifications, streaming output to a background
task terminal so Problems and the Renderer row behave identically. In the
viewer, the status line shows **Building renderer…** and `current_view` reports
build status and errors. Trust rules stay the same: repository `watch` scripts
only run under `--trust`.

### 6. The Copilot app canvas is a thin adapter

A lightweight Copilot CLI extension
(`packages/integrations/copilot-canvas/extension.mjs`, a standalone ES module
with no `package.json` that never writes to stdout) ships in this repo, and
`projections canvas install` places it in `.github/extensions/projections/`. Its
`open()` invokes `projections view show` (starting or reusing the viewer) and
returns the URL keyed by repository and optional viewer name rather than canvas
instance, making it idempotent and rehydratable. Side-by-side canvases can
display different projections by naming separate viewers; an instance remembers
its viewer name unless an action overrides it. Open inputs apply only once
(tracked in a small file in the session workspace) so reloading a canvas never
clobbers what the agent showed afterward. Its actions (`open_projection`,
`current_view`, `screenshot` returning an image, and `refresh`) pull their
names, schemas, and descriptions straight from `projections mcp`'s `tools/list`
so they never drift, and an `onSessionStart` hook's `additionalContext` briefly
lets the agent know the viewer is available.

**Matching the app's theme.** The Copilot app mirrors its theme tokens onto the
canvas document (sometimes after initial load). Whenever
`--background-color-default` is defined, the page marks its root `pi-app-theme`
and styles.css maps `--background-color-default`, `--border-color-default`,
`--text-color-default`, `--text-color-muted`, `--color-focus-outline`,
`--font-sans`, `--font-mono`, and `--text-body-medium` onto ours, following
`data-color-mode` on the root or `prefers-color-scheme`. Renderer frames get the
same look via host core's `copilotCanvasThemeTokens` (mirroring
`vscodeThemeTokens`), sent in `theme.tokens` and updated whenever the root,
body, or app stylesheet changes. Any unparseable color (like `oklch()` or named
colors) is resolved to sRGB by the browser first.

<!-- prettier-ignore -->
| Renderer tokens | App variable |
|---|---|
| `color-bg`, `color-surface-canvas` (the stage) | `--background-color-default` |
| `color-surface-raised`, `color-bg-overlay` (cards) | the stage, one visible step lighter (on a white stage, a step toward the text) |
| `color-surface-header` (bands in cards) | the card, one step toward the text |
| `color-surface-inset`, `color-bg-subtle`, `color-bg-inset` | the stage, a slight step darker |
| `color-fg` | `--text-color-default` |
| `color-fg-muted` | `--text-color-muted` |
| `color-fg-subtle` | muted text, toward the stage |
| `color-fg-on-emphasis` | the stage |
| `color-border`, `color-border-muted` | `--border-color-default` (muted at 70%) |
| `color-divider`, `color-border-emphasis` | `--border-color-default`, moved toward the text to 3:1 |
| `color-accent`, `color-accent-emphasis` | `--color-focus-outline`, else `--true-color-blue` |
| `color-accent-muted`, `color-highlight` | the accent, translucent |
| `color-focus` | `--color-focus-outline` |
| `font-family`, `font-family-mono` | `--font-sans`, `--font-mono` |

Every override preserves our contrast guarantees — 4.5:1 for text on every
surface, 3:1 for dividers, edges, and focus, and readable text fills — nudging
any insufficient app color toward text (or white/black) just far enough. Missing
or invalid values keep their defaults, and without `--background-color-default`
nothing is overridden. Font sizes, spacing, and radii stay unchanged because
renderer layouts depend on them. **Change colors and the categorical palette
stay Projections'**: added, removed, modified, and moved are calibrated color
families (text, fill, edge, highlight) that the first eight palette hues avoid,
whereas the app's true colors have no diff semantics; we only adjust them if the
app's surface drops them below contrast. The page also sets `--status-bar-color`
to its header color so the app's header blends seamlessly into the top edge.

**The app's layout** stays the page's own flat chrome resting on the app's
background, with toolbar and summary bar taking `--background-color-default`
when mirrored.

**Trust after a restart.** When no viewer is running (say, after a reboot), the
canvas starts one without trust, so projections that run repository code show a
trust prompt. The canvas deliberately never remembers or auto-restores trust:
trust is granted for the code as reviewed in one viewer, and a later checkout or
pull could introduce unreviewed code. After reviewing the projections, the agent
restarts the viewer with `projections view --trust`, and the canvas reconnects
at the same URL.

**Connection budget.** Browsers cap connections per host at around six. Each
page uses only two long polls (view state — which includes the active
projection's build phase — and Inspector working-tree changes), so having a few
pages open never starves renderer frame requests.

### 7. No MCP App

`projections mcp` previously also served the viewer as an MCP App (SEP-1865): a
self-contained bundle rendered inside conversational hosts like Claude Desktop,
relaying requests through an app-only `viewer_request` tool. We removed it.
Projections is built for coding agents (Claude Code, Codex, Copilot) that
already have a shell and a browser and can open the viewer URL directly;
maintaining the bundle, relay, and host theme mapping wasn't worth the cost for
conversational hosts. MCP Apps hosts now receive the same tools as every other
client, and `open_projection` returns the viewer URL.

## Not VS Code's

In VS Code, `open_projection`, `current_view`, `screenshot`, and `refresh` work
against VS Code's own projection tabs rather than the standalone viewer. The
developer already has a richer view sitting beside their code — with the full
authoring loop and clickable evidence links — so popping open a separate browser
window would just duplicate it with fewer capabilities.

## Phases

- **A.** This design doc plus `projections view`: loopback server, view state,
  page, header and status line, session token, and default theme.
- **B.** View tools in `projections mcp` and matching CLI subcommands with
  server-side screenshots, unified under one catalog.
- **C.** Renderer build orchestration moved into the CLI service and consumed by
  VS Code.
- **D.** The Copilot canvas adapter and app theme adapter.

## Security

- Loopback-only binding, constant-time token checks on every path, and strict
  `Host` validation. The token is stored per project with owner-only permissions
  so URLs survive restarts, and `projections view stop --rotate` invalidates old
  links. The bare port explains how to obtain the link and never leaks or
  redirects to it.
- Strictly read-only: no write routes are exposed and the page has no editing
  UI. The only state change a page can request beyond interaction reports is
  switching to another working-tree projection (`view/choose`), which grants
  nothing `open_projection` doesn't already allow.
- Repository code only runs with `--trust`, matching the rest of the CLI. A
  viewer launched via `open_projection` in `projections mcp` inherits the MCP
  server's trust; `projections view show` enables trust only when passed
  `--trust`.
- Renderers stay inside the Inspector's sandboxed frames under `RENDERER_CSP`,
  just like VS Code. When a browser blocks direct frame loads, the page loads
  them via Blob URLs in the same sandboxed frames under the same policy (see
  below).

### Renderer frames a browser won't load

Claude Code's Preview pane guards loopback servers by classifying requests using
the requesting frame's origin. Because sandboxed renderer frames have an opaque
origin (`null`), the pane treats their requests to loopback as external and
cancels navigation to `renderers/…/index.html` (`ERR_BLOCKED_BY_CLIENT`), even
though the top-level page's own requests succeed. The frame ends up on a browser
error page and the renderer never boots.

Normally a renderer posts `ready` as soon as its script runs, before document
load even finishes. If a frame finishes loading and hasn't sent `ready` within
1.5 seconds (or the ready timeout fires first), the page recovers once: it
fetches the renderer bundle from its own origin, stamps the page's nonce onto
its scripts, and reloads the same frame with a Blob URL preserving the channel
fragment. Once one frame falls back this way, subsequent frames on that page
start with Blob URLs directly (just as VS Code's webview always does).

The isolation boundary stays identical. The frame keeps
`sandbox="allow-scripts"` (opaque origin), and the host only accepts messages
from an opaque origin on that frame's channel. Because Blob documents have no
HTTP response headers, the page injects the renderer CSP (every directive except
`sandbox`, which the iframe attribute enforces) as the very first `<meta>` tag
in head before any bundle content; CSP only narrows, so nothing in the bundle
can relax it. The Blob document also inherits the viewer page's CSP, which is
tuned to allow exactly what the renderer policy needs and nothing that could
break out: scripts carrying that response's random nonce (accessible only to the
page's own code and stamped only on renderer documents), `blob:` frames, `data:`
fonts and media, and `blob:` workers and media. The renderer policy still blocks
all network requests and nested frames, and the Blob URL is revoked as soon as
the renderer reports ready. Fallback triggers solely from a missing `ready`
signal — never from anything a renderer sends — and always loads the renderer's
own bundle under the same policy.

- The page never shows file paths, CLI commands, or raw error stacks; full
  diagnostics go strictly to the agent.
