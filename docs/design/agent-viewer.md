# Agent viewer

Status: **decided; being built in four phases (below).** VS Code stays the only
interactive authoring surface. This adds a second, narrower surface: a browser
page that a coding agent drives and a person watches.

## Why

An agent working in a terminal (GitHub Copilot CLI, Codex, Claude Code) can
compare revisions and read summaries, but the person beside it can't see the
projection. They want to watch the animation, scrub it, zoom in and point at a
card. They don't want to edit anything there: if they don't like what they see,
they tell the agent. The page must work in any browser an agent can launch, and
inside the GitHub Copilot app's canvas.

## Decisions

### 1. `projections view` serves one page on loopback

`projections view` serves a single page on `127.0.0.1`. It prints the URL;
`--open` also opens the default browser. The URL's path starts with a random
256-bit session token, `http://127.0.0.1:PORT/TOKEN/`, so every relative URL the
page loads (its script, the shared engine, renderer frames, the API) carries it.
Nothing is served to other hosts: the listener binds loopback only, and requests
whose `Host` isn't a loopback name (`127.0.0.1`, `localhost`, `[::1]`, with this
port) are refused with 403, so DNS rebinding can't reach it.

**The URL is stable.** A person bookmarks it, an app's pane keeps it, a browser
tab reconnects to it; a viewer restarted after its idle exit, `view stop` or a
reboot should answer there. So the token and port are kept per project in the
per-user cache, beside the record (`views/<key>.address.json`, `0600` in a
`0700` directory, read only when it is a regular file owned by the user and
unreadable by others), never in the repository. A viewer that starts uses the
kept token, and the kept port unless that is taken (then any free one, which is
kept from then on). `--port N` (on `projections view` and
`projections view show`, the commands that start one) asks for a port: a viewer
starts there or says the port is taken, never silently elsewhere, and keeps it
with its token. While a viewer runs, `--port` naming another port is refused,
saying to stop it first: one project has one viewer, and its URL is the one its
pages know. `projections view stop --rotate` forgets the address, so the next
viewer has a new token (and port) and every earlier link stops working: rotate
after sharing a screenshot or log that shows the link, or whenever in doubt.
Deleting the file does the same.

Keeping the token for longer than one process changes no boundary. It was
already in the owner-only record while a viewer ran; the token guards against
other local users and against web pages that can reach loopback but can't read
its answers (no CORS, the `Host` check), and both are as far from a kept token
as from a fresh one. What changes is how long a leaked link stays good, which
`--rotate` bounds.

**The bare port says what it is, and nothing more.** A request whose path
doesn't start with the token (the bare port, a typo, a link from before a
rotation) is answered 404 with a short page, under a policy that runs no script
and loads nothing: it is the Projections viewer, it needs its full link, which
only the person and their agent have, and `projections view current` (or the
agent) gives it. It never carries the token, and the bare port never redirects
to the tokened URL. A redirect would make the port itself the secret: any
process or page on the machine that can reach loopback (another local user, a
page in a browser that permits it) would be handed the token. The `Host` check
runs first, so a rebinding page doesn't even get that page. Other methods get a
bare 404.

The server is a thin listener in front of the existing CLI service
(`inspector::Service`), the same one `serve --stdio` and `projections mcp` use.
It reuses its jobs, pairs, identity, working-tree changes and the extraction
cache. There is no new extraction logic. It forwards only what a viewer needs:
reading definitions, revisions, pairs, scenarios, renderers and the comparator,
running and cancelling extraction jobs, and long-polling changes. It never
forwards writes (`/api/definition`, adopt, prepare, sweeps, comparator test
runs).

The page's policy is the Inspector's (`INSPECTOR_CSP`), except that it may be
framed (`frame-ancestors` is omitted), because the Copilot app shows it in a
canvas. Framing grants nothing: the page has no writes, and a framer must
already know the token.

A per-repository **state file** records the running server: its URL, token,
process ID and whether it was started with `--trust`. It lives in the per-user
cache (`views/<digest of the repository root>.json`, written `0600`), never in
the repository. The subcommands and `projections mcp` find a running server
through it. A record outlives a viewer that was killed or a machine that
restarted, so it is believed only when its process is alive and its server
answers at its URL as that process (`control/state` carries the process ID);
otherwise it is stale, removed and replaced.

`projections view stop` stops the running viewer (`control/stop`); a stopping
viewer gives open requests two seconds, then closes them, so a page's open
streams never keep it alive. `projections view --trust` (and
`projections view show --trust`) replaces a viewer running without trust: it
stops it and serves at the same port and token when the port is free, so open
pages, including the Copilot app's canvas, reconnect to the trusted viewer.

### 2. The server owns the view state

The **view state** is
`{projection, choice or before/after, mode, selection, scenario, chosenBy, generation}`,
one for each named viewer (below). The server holds it; pages render it. Pages
long-poll it (`GET TOKEN/view/state?since=N`), as the Inspector long-polls
working-tree changes, and report the person's interactions with
`POST TOKEN/view/report`: the selection, mode, playback position and what the
page presents (the same `PageView` shape VS Code's projection tabs report). A
long poll plus POST is simpler than Server-Sent Events or a WebSocket here: the
state changes rarely, the reports are small, and it needs no new dependency.

Several open pages mirror one another: a report that changes the selection or
mode becomes the state, and every page receives it. The newest report wins.

**Which pages count as open.** A page counts while it asks for its viewer's
state: each page makes a random ID (with `crypto.getRandomValues`, not
`crypto.randomUUID`, which only a secure context has: a page framed by an app
whose own document is plain http or a custom scheme isn't one, though its
loopback origin is) and sends it with every long poll and report. Such a page
also lacks `crypto.subtle`, so the engine hashes the default comparator in
JavaScript there, and the page renders as anywhere else. A page that hasn't
asked for 45 seconds is gone. Nothing else is checked: no `Origin`, no
visibility, no connection type. A long poll returns every 20 seconds at most, so
a page counts within that of loading; a hidden or suspended page (a background
tab, a minimized window, a collapsed preview pane) that stops asking stops
counting, and counts again when it asks. Pages count per named viewer: a page of
`?viewer=api` isn't a page of the default viewer, and `current_view` lists each
viewer's pages.

When no page of a viewer counts, `current_view` says what the viewer saw
instead, from the last 10 minutes: a page that loaded but never loaded its
script (the embedding app blocks scripts), or loaded it but never asked (the
script failed in that web view, or its requests go elsewhere); a page that
stopped asking; requests refused for a non-loopback `Host` (a pane or proxy that
rewrites the address, which can't be allowed without allowing DNS rebinding);
and requests without the token. It says these as counts and ages only: nothing a
request sent, its `Host` or its path, reaches the agent, so a web page can't
write into its tools' answers. With nothing seen, it says that nothing has
loaded the page. A page an embedding app shows through a proxy at another host
name, or that it never lets run its script, can't count; the agent learns which
it is. Chrome itself refuses to load loopback in a frame of a page that isn't a
secure context (its Local Network Access checks), so a pane whose document is
plain http on another host never loads the page at all: the viewer sees nothing,
and says so.

**Named viewers.** One server holds several independent views, so an agent can
show the person several projections side by side. Each **named viewer** has its
own view state, pages and URL, `TOKEN/?viewer=NAME` (lowercase letters, digits
and hyphens, at most 40; at most 32 per server); the default viewer is the
unnamed one, `TOKEN/`, and everything that names no viewer uses it, as before. A
viewer is made when first shown or asked for, and lives as long as the server.
Its pages long-poll and report with its name (`view/state?viewer=NAME`, `viewer`
in the report), and mirror only one another. The agent names one with `viewer`
on the view tools and `screenshot`, or `--viewer NAME` on `projections view` and
its subcommands; `current_view` lists the other viewers and what each shows. The
other tools' defaults (`compare`, `check`, `set_part`) come from the default
viewer. One server, rather than one per name, keeps one token, one trust
decision, one record and one extraction cache for the repository;
`projections view --trust` replaces them all at once, and their pages reconnect.

**The person picks the projection.** The header's title is also a menu of the
repository's projections (decision 3). Choosing one asks the page's viewer to
show it (`POST TOKEN/view/choose`, `{viewer, projection}`), as `open_projection`
with only that projection would: the same pair, now for that projection, with
its mode and selection cleared. It becomes that viewer's state, so its other
pages follow, and the agent reads it: the state says who chose it (`chosenBy`,
`agent` or `person`), and `current_view` says the person chose it. Nothing else
the page sends changes what is shown; the server shows only a projection the
working tree defines, and a renderer builds for it under the same trust rules as
when the agent shows it.

**Live updates.** The page shows the pair with the working-tree definition, so
editing a definition, an extractor's input or a renderer re-extracts and
replays, by the Inspector's own rules (the same as a VS Code tab in its default
"your edits" mode). When the pair names committed revisions only, nothing on
disk changes it. When the page can't tell whether a result is current (a
renderer is rebuilding, say), it says so in the status line; the agent's
`refresh` (or `projections view refresh`) extracts again.

`projections view --definition-revision REV` extracts every side with another
revision's definition instead, as `compare --definition-revision` does; the
`screenshot` tool uses the same definition the page does, so its image matches
the screen.

### 3. The page shows the stage and nothing else

The page mounts the Inspector bundle with a new `chrome: 'viewer'`: the bare
stage VS Code's tabs use (`chrome: 'none'`), with the Default UI host
(`@githubnext/projections-host`): the toolbar (Diff, Side by side, Animated,
Swipe), playback, zoom, the settings menu, the renderer frame, the summary bar
and its notices. Above it:

- a **one-line header**: the Projections mark and the projection's title, and at
  the row's end, muted, what is compared, in words: "Branch changes",
  "Uncommitted changes", "Last commit", "Current state", a bookmark's title, or
  the two revisions' commit subjects, an arrow between them. Never file paths or
  raw refs. It is an outline pill (two revisions are a pill each): a 1px border,
  fully rounded, no fill, 20px tall, the cap centred in it. What is compared
  keeps its words up to about half the row, each pill shortened with an ellipsis
  and whole in its tooltip; a long title shortens first. Its text is centred by
  cap height: a capital E has the header's padding above and below, and the mark
  before the title as much space above, below and to its left. The **title is
  the projection menu**: with two or more projections, it opens the Inspector's
  own projection switcher (a search by title or ID over the list, IDs in mono,
  the current one checked) from its start. It reads as the title, not a button:
  no fill, border or padding at rest, only a small muted chevron after the text;
  hover and the open menu lay a faint wash behind it (24px tall, overhanging the
  text by 6px at each end, so nothing moves), and keyboard focus draws the focus
  ring. Enter, Space or Arrow Down open it; it is a button with a dialog popup
  to assistive technology, named "TITLE, switch projection";
- a quiet **status line**, before what is compared: "Extracting…", "Building
  renderer…", "Waiting for the agent…", "Out of date".

Under the header the chrome lies flat, edge to edge, as the default UI lays it
everywhere: the toolbar and the summary bar are bands of the header's colour, a
hairline from the stage, with no card, border or corners, and the stage (the
single frame and the comparison panes) runs to both edges with no inset. A
renderer's legend is a band of the same colour between the stage and the summary
bar. Every boundary in the stack (header, toolbar, stage, legend, summary bar)
is one 1px hairline in the divider colour; a renderer frame runs a pixel past
its clipped host, so a frame whose height has a fraction of a pixel never leaves
a strip that reads as a second line. The toolbar spans the page in every state.
Each fact appears once: the header says what is shown, so a one-revision view's
toolbar adds only the revision it shows (a commit's short hash) at its start,
where a comparison's mode switch sits, when that isn't the working tree. While a
job runs, a renderer pane that is still loading says what it waits on
("Extracting…") rather than that it is loading the renderer.

**A page that loses its server** (the viewer exited, or the machine slept) says
"Viewer stopped" in its status line and over the stage, with what to do: ask the
agent to show the projection again, or reopen the page. The stage takes no input
meanwhile, so no control seems to work and doesn't. The page keeps asking and
resumes if the same viewer answers again.

There is no sidebar, no Definition or file rows, no **+ New**, no editing and no
code paths. Errors are said in plain words ("The extractor didn't run. The agent
has the details."); the diagnostics, with their paths, reach the agent through
`current_view`. A notice that names a path is left out of the page for the same
reason. The page names no commands. When a projection needs trust the viewer
lacks, it says what to do in the person's terms: ask the agent to review the
projection's code and restart the viewer with trust, and the page reconnects.
`current_view` tells the agent how (`projections view --trust`, which replaces
the viewer at its URL). The agent decides; the page grants nothing.

The person can switch mode, play and scrub, zoom, use the settings menu, select
cards and items, and switch the page to another projection from its title.
Selecting and switching are reported, so the agent can read them ("this one's
wrong").

**Theme.** The default light and dark themes follow `prefers-color-scheme`.
Inside the Copilot app, a small adapter maps the canvas's tokens onto ours when
they are present: `--background-color-default`, `--border-color-default`,
`--text-color-default`, `--text-color-muted`, `--color-focus-outline`,
`--font-sans`, `--font-mono`, `--text-body-medium` and `data-color-mode`, as
`host-vscode` maps VS Code's, and sends renderer frames the theme tokens they
map to, so the stage is the app's too. It also sets `--status-bar-color`.
Another app that shows the page in its own browser pane (a custom agent harness)
can't theme it so, and its agent passes the app's colors instead: a **theme
seed** in the page's link (`?theme=`, which `projections view --theme` writes),
`{"light": {...}, "dark": {...}}`, each mode a `background` and optionally
`text`, `muted`, `border`, `accent`, `focus`, `sans` and `mono`. These are
exactly the app theme's inputs (`appThemeTokens`, which the canvas mapping uses
too), so a seed is mapped as the canvas's variables are; host core's
`parseThemeSeed` accepts only colors `parseColor` reads and plain font lists,
and the CLI checks the same. The seed lives only in its link, never in the
viewer's state or on the machine, so a page opened elsewhere (the Copilot canvas
on the same viewer) keeps its own theme. Per page, a seed wins over the app's
theme, which wins over the default; a mode the seed leaves out keeps the page's
own. One seed is built in, by name: `--theme claude`, Claude Code's Preview
pane, from the Claude app's design tokens, in both modes. Its dark background is
the pane's own backdrop, which the pane shows as a 6 px inset either side of the
page, so the page meets it seamlessly. The format and how an agent finds its
app's colors are in
[the agent tools](../runner/agent-tools.md#a-theme-seed-for-another-apps-browser-pane).

### 4. One tool catalog, answered by whichever surface shows the view

The agent tools are **identical** in every surface: one catalog, one set of
names and schemas. Only the surface that answers the view tools differs.

<!-- prettier-ignore -->
| Tool | VS Code | `projections mcp` |
| --- | --- | --- |
| `open_projection` | Opens or focuses a projection tab | Starts or reuses the viewer and shows it there; returns its URL |
| `current_view` | What the projection tab in front shows | What the viewer shows, from the page's latest report |
| `refresh` | Extracts the front tab's pair again | Extracts the viewer's pair again |
| `screenshot` | Rendered by the CLI from the front tab's pair, mode, playback, theme and size | The same, from the viewer's |

- `open_projection`, `current_view` and `refresh` are the **view actions**
  (`view: true` in the catalog, replacing `editor`): the surface that shows the
  view answers them. `serve --stdio` lists them and leaves them to the
  extension; `projections mcp` lists them and answers them with the viewer, in
  its own process or, through the per-repository record, a viewer another
  process runs.
- `open_projection` keeps its inputs (projection, before and after, entity, pin)
  and gains `viewer` (a named viewer, decision 2), `choice` (`branch`,
  `uncommitted`, `last-commit`, `now`, `release` or `bookmark:<id>`, the ids VS
  Code's choices use), `mode` and `scenario` (a scenario from the projection's
  `scenarios.json`). `pin` only applies in VS Code, where several tabs exist;
  the viewer has one view and ignores it.
- `current_view` has one result shape (the model in
  `packages/integrations/vscode/src/current-view/types.ts`, which the viewer's
  Rust twin follows): the projection and definition file, the choice and
  resolved revisions, the mode, the selection, the summary bar's figures, the
  changed items, why an extraction failed, whether it is out of date and whether
  it uses uncommitted definition edits. The viewer's first line names the viewer
  and its URL instead of a tab, and it says when the person chose the
  projection, and which other named viewers show what. Its `viewer` input reads
  a named viewer; so does `refresh`'s.
- `screenshot` is not a view action: it is an ordinary tool that renders
  server-side with the CLI's headless renderer (`--png`), so it works when the
  agent can't see the person's browser and when no page is open. Its omitted
  projection, revisions, mode, playback position, theme and size default to the
  current view, as the other tools' projections do, so both surfaces answer it
  with the same code; VS Code fills them from the tab in front and calls the
  backend. The image is an MCP image content part, and a `LanguageModelDataPart`
  in VS Code.
- The tab defaults apply everywhere: `compare`, `check`, `describe_part`,
  `set_part` and `screenshot` default to the current view, the viewer's in
  `projections mcp` (`with_view_defaults`) as the projection tab's in VS Code
  (`withTabDefaults`), and say so. Their projection is therefore optional in the
  catalog, and their descriptions say where it comes from, so the schemas and
  descriptions are the same in every surface.

`tools/list` is the same for `serve --stdio` and `projections mcp`, and VS
Code's `languageModelTools` are generated from it;
`packages/integrations/vscode/test/tools.test.mjs` holds them equal, tool for
tool. The only differences are VS Code's own: its contributions add a `folder`
input (which workspace folder) and drop `confirm` (VS Code asks the person to
approve a write itself). No tool is left out of either surface.

**The same as CLI subcommands**, for agents without MCP:
`projections view show …`, `projections view current [--json]`,
`projections view screenshot --out FILE` and `projections view refresh`, each
taking `--viewer NAME`. They call the running server's token-protected control
endpoints (`TOKEN/control/tool/NAME`), which answer with exactly the tool's
result, so the text and JSON match the tools'.

`projections view screenshot --page` is the one exception: it captures the
viewer's own page, its header, toolbar and summary bar around the stage, rather
than the projection alone. The CLI opens the running viewer's URL in its
headless browser as a **capture** (`?capture`), which polls the state without a
page ID and reports nothing, so it never counts as the person's page or changes
what the agent reads. The page marks its root `data-projections-viewer="ready"`
once it shows the state settled (its extraction done or failed, its renderer
built), and the capture waits for that, then for two identical frames. It shows
what a page opened now shows (the viewer's projection, pair, mode and selection,
at the person's page's size and color mode), not the person's playback position
or zoom. It stays a subcommand, not an input of the `screenshot` tool: the
catalog is the same in every surface, and VS Code can't capture its own
webview's chrome. `view show` starts a server in the background when none is
running, which stops itself after it has had no page and no call for 15 minutes;
`projections view stop` stops one sooner (decision 1).

### 5. Renderer builds move into the CLI service

A custom renderer's `watch` script ran as a VS Code task
(`packages/integrations/vscode/src/renderer-builds.ts` spawned npm). Its
orchestration moves into the CLI service (`packages/cli/src/renderer_builds/`),
so `projections view` rebuilds on save too: the service runs the package's
`watch` script (else `build` once per save), reads its output for the build's
state, and keeps the output. Views tell it when they show a projection
(`opened`), when its renderer's sources were saved (`saved`, from VS Code's save
events) or may have changed (`changed`, from the viewer's working-tree changes;
it builds only when the sources' fingerprint differs) and when they stop showing
it (`closed`, which stops a watcher). VS Code consumes it: each run is still a
background task whose terminal relays the output the backend sends
(`rendererBuilds` notifications), so Problems and the Renderer row's states are
as before. The viewer's status line says **Building renderer…**, and
`current_view` says how the build went, with its error. Trust rules don't
change: repository code (a `watch` script) runs only with `--trust`.

### 6. The Copilot app canvas is a thin adapter

A Copilot CLI extension (`packages/integrations/copilot-canvas/extension.mjs`,
an ES module with no `package.json`, which never writes to standard output)
ships in this repository. `projections canvas install` writes it to
`.github/extensions/projections/`. Its `open()` runs `projections view show`,
which starts or reuses the viewer, and returns its URL, keyed by the repository
(and the named viewer, when the input names one) rather than the canvas
instance, so it is idempotent and rehydrates. Canvases side by side show
different projections by naming different viewers; an instance opened on a named
viewer keeps it, and its actions address it unless they name another. An
instance's open input is applied once (a small record in the session's
workspace), so the app rehydrating a canvas after a reload never undoes what the
agent showed since. Its actions, `open_projection`, `current_view`, `screenshot`
(an image result) and `refresh`, have the tools' names, and their schemas and
descriptions are read from the CLI's own catalog (`projections mcp`'s
`tools/list`), so they can't drift. An `onSessionStart` hook's
`additionalContext` tells the agent, briefly, that the viewer exists.

**The app's theme.** The app mirrors its theme tokens onto a canvas document,
maybe after it loads. While `--background-color-default` is defined the page
marks its root `pi-app-theme`, and styles.css maps the app's
`--background-color-default`, `--border-color-default`, `--text-color-default`,
`--text-color-muted`, `--color-focus-outline`, `--font-sans`, `--font-mono` and
`--text-body-medium` onto ours; the page's color mode follows `data-color-mode`
on the root, else `prefers-color-scheme`. Renderer frames get the same theme:
host core's `copilotCanvasThemeTokens` maps the app's documented canvas
variables onto renderer token overrides, sent in `theme.tokens` and again
whenever the app changes its theme (the page watches the root, the body and the
app's stylesheet), as VS Code's variables are mapped for its webviews
(`vscodeThemeTokens`). A color the mapping can't parse (`oklch()`, a name) is
resolved to sRGB by the browser first.

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

Every override keeps the contrast the token set promises (text 4.5:1 on every
surface, the divider, edges and focus 3:1, fills behind text keep it readable):
an app color that falls short is moved toward the text (or white, or black) just
far enough. A variable that is missing, isn't a color, or isn't a plain font
list keeps its default; without `--background-color-default` nothing is
overridden. Type sizes, spacing and radii keep the token set's, which the
renderers' layouts are measured against. **Change colors and the categorical
palette stay Projections'**: added, removed, modified and moved carry meaning
and are calibrated as families (text, fill, edge, highlight), the palette's
first eight hues avoid them, and the app's true colors are a general palette
with no diff meaning, so mapping them would blur both. They are moved only where
the app's surfaces would take them below their contrast. The page sets
`--status-bar-color` to its header's color, so the app's header continues its
top edge.

**The app's layout** is the page's own: its flat chrome lies on the app's
colour, the toolbar and the summary bar taking the header's (the app's
`--background-color-default` when mirrored).

**Trust after a restart.** The canvas starts a viewer without trust when none
runs (after a reboot, say), so a projection that runs repository code shows only
that it needs trust. The canvas doesn't remember that a repository's viewer was
trusted and restore it: trust is a review of the code as it is, granted for one
viewer, and the next checkout or pull may run different code that nobody
reviewed. The agent restarts the viewer with `projections view --trust` after
reviewing the projections, and the canvas reconnects to it at the same URL.

**One long poll per page.** Browsers allow about six connections to a host. Each
page holds two long polls (the view state, which carries the shown projection's
build phase, and the Inspector's working-tree changes), so a few pages in one
browser never starve the renderer frames' requests.

### 7. No MCP App

`projections mcp` once also served the viewer as an MCP App (MCP Apps,
SEP-1865): a self-contained bundle of the viewer's page that hosts such as
Claude Desktop showed in the conversation, its requests relayed to the viewer
through an app-only `viewer_request` tool. It was removed. Projections is for
coding agents (Claude Code, Codex, Copilot), which have a shell and a browser of
their own, so they open the viewer's URL as any page; the bundle, the relay and
the host theme mapping cost more than the conversational hosts they served were
worth. An MCP Apps host now gets the same tools as every other client, and
`open_projection` gives it the viewer's URL.

## Not VS Code's

VS Code's agent tools answer `open_projection`, `current_view`, `screenshot` and
`refresh` with its own projection tabs, not the viewer: the person is already
looking at a tab beside their code, which offers more (the authoring loop,
evidence links that open files). Starting a browser page from VS Code would put
a second, lesser view of the same thing next to it.

## Phases

- **A.** This record, and `projections view`: the server, view state, page,
  header and status line, token and the default theme.
- **B.** The view tools in `projections mcp` and the CLI subcommands, with
  server-side screenshots; one catalog for every surface.
- **C.** Renderer builds in the CLI service, with VS Code consuming them.
- **D.** The Copilot canvas adapter and the app theme adapter.

## Security

- Loopback only, a token in every path and a `Host` check. The token is compared
  in constant time. It is kept per project, owner-only, so the URL survives a
  restart, and rotated with `projections view stop --rotate`. The bare port says
  how to get the link and never gives or redirects to it.
- Read-only: the server forwards no write route, and the page offers no editing.
  The one thing a page asks of the server beyond its reports is to show another
  projection the working tree defines (`view/choose`), which grants nothing the
  agent's `open_projection` doesn't.
- Repository code runs only with `--trust`, as everywhere else. A viewer started
  by an agent's `open_projection` in `projections mcp` inherits that server's
  trust; `projections view show` starts one with `--trust` only when given.
- Renderers run in the Inspector's sandboxed frames with their own policy
  (`RENDERER_CSP`), as in VS Code. Where a browser won't load their URL, the
  page opens their documents itself, in the same frames, under the same policy
  (below).

### Renderer frames a browser won't load

Claude Code's Preview pane guards loopback servers: it classifies each request
by the origin of the frame that makes it, counts an opaque origin (`null`) as
external, and cancels an external request to a loopback address as a client
block (`ERR_BLOCKED_BY_CLIENT`). A renderer frame is sandboxed into an opaque
origin, so its navigation to the viewer's `renderers/…/index.html` is cancelled,
although the page's own requests to the same server go through. The frame shows
the browser's error page and its renderer never starts.

A renderer says it is ready as its script starts, before its document finishes
loading. So when a frame's document loads and its renderer hasn't answered
within 1.5 seconds (or the ready timeout passes first), the frame opens the
renderer's document itself, once: the page fetches it from its own origin,
stamps its scripts with the page's nonce, and loads it into the same frame as a
Blob document with the same fragment (the channel). Once one frame needed this,
later frames on the page start that way. VS Code's webview opens every renderer
document so.

Isolation is the same. The frame keeps `sandbox="allow-scripts"`, so the
document is in an opaque origin, and the host still accepts messages only from
an opaque origin on the frame's channel. A Blob document has no response
headers, so the page puts the renderer policy first in its head as a `<meta>`
element (every directive but `sandbox`, which the frame's attribute supplies)
before anything of the bundle's, whatever metadata the bundle has: policies only
narrow, so nothing after it can loosen it. The document also inherits the page's
policy on top. So the viewer's page policy, sent with each page response, admits
exactly what the renderer policy grants and nothing a document can use to escape
it: scripts carrying that response's random nonce (only the page's code reads
it, and it stamps it only on renderer documents), `blob:` frames, `data:` fonts
and media, and `blob:` workers and media. The renderer policy still refuses
every request and frame, and the Blob URL is revoked once its renderer is ready.
What starts this is only the absence of a renderer's `ready`, never a message or
request of the renderer's: a renderer can't ask for it, and the document it gets
is its own bundle under the same policy.

- The page shows no paths, commands or raw errors; diagnostics go only to the
  agent.
