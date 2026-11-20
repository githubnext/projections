# Agent tools

```sh
projections mcp [--trust] [-C DIR]
```

Projections exposes a single set of tools for coding agents, implemented once in
the CLI on top of the same service that powers the Inspector. The VS Code
extension registers them as language model tools for VS Code's agent (via
`serve --stdio`'s `tools/list` and `tools/call`), while `projections mcp` serves
the exact same tools to any other agent as a
[Model Context Protocol](https://modelcontextprotocol.io) server. Every tool
returns concise, model-friendly text—names, counts, and summaries capped at 24
KB, never raw documents—alongside the same facts in `structuredContent`.

- `list_projections` lists the projections a revision defines—including each
  one's extractor, renderer, comparator, and whether it runs repository
  code—plus any invalid definition files and their errors. Runs nothing.
- `compare` runs one projection's comparison between two revisions (defaulting
  to the suggested pair, just like the editor, or the active projection tab in
  VS Code). It returns the steps, each change's label and summary, status
  counts, comparator classifications such as API compatibility levels, and
  generated values (distinguishing how many changed because their basis moved
  from how many were only regenerated from the same inputs, clearly labelled as
  generated rather than extracted facts). Use `maxChanges` to cap the number of
  described changes. Explicit revisions use the base revision's definition
  (`definition: head` uses the head's), whereas the suggested or active pair
  uses whatever definition the viewer or tab applies (the working tree's unless
  it shows the committed one, so bookmarks saved before a projection existed
  still compare). Pass `definitionRevision` to select another revision.
- `explore` lists the built-in projections that apply to this repository, along
  with the files that suggested each, whether it is already adopted, and whether
  it runs repository code.
- `sweep` reports how projections behaved across recent changes: for each
  projection, how many changes it moved on (N of M), its median change size, the
  changes where it showed the most, and the changes where several projections
  moved together. `latest` summarizes the most recent sweep (such as one run in
  the Explore view).
- `check` returns `projections check`'s report with pass, fail, warn, or skip
  per check; `render` includes the renderer checks.
- `prepare` runs the environment's prepare steps (`projections prepare`) in the
  working tree—or in a commit's workspace when `revision` is set—returning each
  step's outcome or the failing step with the tail of its log. Requires trust.
- `run_comparator_tests` runs comparator test cases and reports each failure's
  expectation, message, and diff.
- `describe_part` describes a built-in extractor, renderer, or the comparator:
  what it reads or accepts, its inputs or options, and a starter definition
  template.
- `open_projection` shows a projection to the user—a projection tab in VS Code,
  or the [viewer](#the-viewer) under `projections mcp`—for a revision pair, a
  `choice` (`branch`, `uncommitted`, `last-commit`, `now`, `release`,
  `bookmark:<id>`), or a renderer `scenario`, in a given `mode` and optionally
  selecting an entity. The agent opens the viewer URL directly for the user (in
  its own browser if it has one, otherwise the system browser) and falls back to
  sharing the link only when it cannot. With `projections mcp`, `viewer` names
  one of several independent viewers so you can display projections side by
  side.
- `current_view` reports what the view currently displays: the projection and
  definition file, choice and resolved revisions, mode, current selection (with
  its generated values and how each differs), summary counts (including
  regenerated items), changed items, why an extraction failed, whether the view
  is out of date or using uncommitted definition edits, and whether the user
  picked the projection from the page title. With `projections mcp`, `viewer`
  reads a named viewer and lists any others.
- `refresh` re-extracts whatever the view is showing and returns the updated
  state.
- `screenshot` captures a PNG of a projection drawn by its real renderer in a
  headless browser (like `--png`) and returns it as an image, defaulting to what
  the view currently shows in its mode, playback position, theme, and size.
- `adopt` writes definitions and bookmarks for explore candidates, just like
  `projections adopt`.
- `set_part` updates a definition's `extractor`, `comparator`, or `renderer` (or
  removes it with `null`) while preserving its other fields, previewed as a
  diff.
- `update_snapshots` rewrites comparator test snapshots to match what the
  comparator currently produces.

The first seven tools are read-only (`readOnlyHint`); the three write tools are
not, and `set_part` and `update_snapshots` carry `destructiveHint` because they
can replace existing content. No tool edits CI files directly: where the
Projections step belongs depends on the repository's workflows, so the agent
reads them, proposes the edit (as `projections help agents ci` describes), and
writes it only after the user agrees. Every tool's `inputSchema` is a JSON
Schema object with `additionalProperties: false`, and invalid arguments return a
result with `isError`.

**Writes preview, then confirm.** Calling a write tool without `confirm` only
previews what it would create or modify (a diff for `set_part`, or the differing
snapshots for `update_snapshots`) and returns a token in
`structuredContent.confirm` bound to the files' current contents and the exact
proposed write. Calling the tool again with identical arguments and `confirm`
set to that token performs the write—provided nothing changed in the meantime.
If the files or the proposed change shifted, nothing is written and the tool
returns an `isError` result containing a fresh preview and token. Agents should
always show the preview to the user before confirming and only adopt what they
choose. In VS Code, the editor prompts the user directly and sends the
confirmation on approval.

````json
{"jsonrpc": "2.0", "id": 5, "method": "tools/call", "params": {"name": "set_part", "arguments": {"projection": "deps", "renderer": "dag"}}}
{"jsonrpc": "2.0", "id": 5, "result": {"content": [{"type": "text", "text": "Setting the renderer of deps changes .github/projections/deps.json:\n```diff\n  …\n-   \"renderer\": \"graph\",\n+   \"renderer\": \"dag\",\n  …\n```\n\nNothing was written. Show the person this preview; to write it, call set_part again with the same arguments and confirm: \"5d0c4e1b2a39f8e7c6d1\".\n"}],
  "structuredContent": {"projection": "deps", "path": ".github/projections/deps.json", "changed": true, "written": false, "confirm": "5d0c4e1b2a39f8e7c6d1", "...": "..."}, "isError": false}}
{"jsonrpc": "2.0", "id": 6, "method": "tools/call", "params": {"name": "set_part", "arguments": {"projection": "deps", "renderer": "dag", "confirm": "5d0c4e1b2a39f8e7c6d1"}}}
````

**Trust** belongs to the server, just as in `serve --stdio`. Without `--trust`,
any projection whose extractor runs repository code refuses to extract
(`compare`, `sweep`, and `check` report that trust is required), `set_part` and
`update_snapshots` preview without writing, and `adopt` writes only during an
explore session (a repository with no projections of its own yet). Previews
always work. Start `projections mcp --trust` only after the user has reviewed
the repository's projection code.

**Protocol.** `projections mcp` speaks MCP over stdio using JSON-RPC 2.0, one
message per line, supporting protocol version `2025-06-18` (as well as
`2025-03-26` and `2024-11-05` if requested by the client). It handles
`initialize` (returning capabilities `{"tools": {"listChanged": false}}` and
agent instructions), `ping`, `tools/list`, and `tools/call`. It also accepts
`notifications/initialized` and cancels in-flight calls on
`notifications/cancelled` without sending a reply. Tool calls run concurrently,
standard output carries only protocol messages, and diagnostics go to standard
error. The server operates on `-C DIR` (or the current working directory) and
exits when standard input closes or on a signal.

Because `projections mcp` exposes the exact same tools and schemas as
`serve --stdio`, VS Code's agent and every other MCP client get an identical
interface. The view actions (`open_projection`, `current_view`, `refresh`) are
handled by the viewer, and `compare`, `check`, `describe_part`, `set_part`, and
`screenshot` fill in omitted arguments from what the viewer is currently showing
(noting that they did so), mirroring how VS Code's tools read from the active
projection tab.

**Reviewing a change to the tools.** This repository's own `agent-tools`
projection (`.github/projections/agent-tools.json`) extracts every tool, its
parameters, and every surface that exposes it (`projections mcp`, VS Code's
`languageModelTools`, and the Copilot app canvas) directly from source at each
revision. Its comparator classifies changes the way calling agents experience
them—removing, narrowing, or making a parameter required is breaking—and flags
drift across surfaces such as a stale VS Code manifest. Run
`projections compare main.. -p agent-tools --trust` to review changes.

## The viewer

```sh
projections view [--open] [--trust] [--port N] [-p ID] [--choice CHOICE | --before REV --after REV] [--mode MODE] [--viewer NAME] [--theme SEED]
projections view show|current|screenshot|refresh [--viewer NAME]
projections view stop [--rotate]
```

The viewer is a local loopback page driven by a coding agent while the user
watches (see the [agent viewer design](../design/agent-viewer.md)). It shows the
projection stage—complete with comparison modes, playback, zoom, and
settings—beneath a one-line header explaining what is being compared in plain
words and a status line. This is how an agent shows its work and what someone
means when they ask to "open it in the inspector." There is no editing UI, and
the page never exposes file paths: errors appear in plain language while full
details go to the agent via `current_view`. Interactions like selecting an item,
switching modes, or playing animations are reported back to the agent, and
multiple open tabs mirror each other. Clicking the page title opens a menu of
the repository's projections so the user can switch projections directly, which
also updates what the agent sees.

A single viewer server can host multiple **named viewers** side by side. Pass
`--viewer NAME` to `projections view` and its subcommands, or `viewer` to the
view tools and `screenshot`, to create or address one on first use. Each named
viewer keeps its own state and URL (`http://127.0.0.1:PORT/TOKEN/?viewer=NAME`),
and its open pages mirror only each other. Omitting a name uses the default
viewer, which is also where `compare`, `check`, and `set_part` pull their
defaults.

Running `projections view` serves the viewer until interrupted and prints its
tokenized URL (`http://127.0.0.1:PORT/TOKEN/`). Requests missing the random
token or arriving with a non-loopback `Host` header are refused; hitting the
bare port (or an invalid token) returns a brief page explaining that the full
link is required and how to fetch it (`projections view current`) without ever
revealing the link. The token and port are stored per project in the user cache
so restarts reuse the same URL. Passing `--port N` to `projections view` or
`projections view show` selects the port when starting a server and fails if a
viewer is already running on a different port. Running
`projections view stop --rotate` discards the saved link so the next server
generates a fresh token and invalidates old URLs.

In `projections mcp`, calling `open_projection` starts a viewer inside the MCP
server process if one isn't already running. A per-repository record in the user
cache lets CLI subcommands and other MCP servers locate the active viewer:
`projections view show` starts one in the background if needed (shutting down
automatically after 15 idle minutes), while `current [--json]`,
`screenshot --out FILE`, and `refresh` invoke the same tools and print their
results. Passing `screenshot --page` captures the full viewer page—header,
toolbar, and summary bar included—in a headless browser.

A page counts as open as long as it polls the viewer (at most every 20 seconds).
When no page is polling, `current_view` reports what the viewer saw instead: a
page that loaded without running its script or polling, one that stopped polling
(closed, hidden, or suspended), requests rejected for a non-loopback host, or
requests missing the token. Agents should open the page directly—in their own
browser if available, or in the system browser via
`projections view show --open` (which also opens an already running viewer)—and
print the raw link only as a fallback. The page tracks the working tree using
the working tree's definition, re-extracting and replaying automatically on
save.

In the GitHub Copilot app, `projections canvas install` registers the viewer as
a canvas (`.github/extensions/projections/extension.mjs`): opening it starts or
reuses the viewer, exposes the same four view tools as actions, and tracks the
app's theme
([the canvas](../../packages/integrations/copilot-canvas/README.md)).

In Claude Code's Preview pane (the Claude app), `preview_start` only launches
servers declared in `.claude/launch.json`. Have the agent add an entry that runs
the viewer in the foreground on a fixed port with Claude's palette, start it,
and navigate the Preview tab to the full URL printed by
`projections view show --theme claude` (the bare port only displays a prompt
asking for the full link):

```json
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "projections-viewer",
      "runtimeExecutable": "projections",
      "runtimeArgs": ["view", "--port", "47470", "--theme", "claude"],
      "port": 47470,
      "autoPort": false
    }
  ]
}
```

Include `--trust` in `runtimeArgs` only when the projection runs repository
code, and keep `autoPort: false` so Claude does not reassign the server to a
different port that the viewer wouldn't follow. Whether to commit or ignore
`.claude/launch.json` is up to the repository. Because the Preview pane blocks
requests from sandboxed frames to loopback addresses—including the viewer's
renderer frames—the viewer opens renderer documents directly inside the same
sandboxed frame there (see
[renderer frames in the agent viewer](../design/agent-viewer.md#renderer-frames-a-browser-wont-load)).

To wire Projections into any MCP-compatible agent, register `projections mcp` as
a stdio server running in the repository (or with `-C DIR`):

```json
{"mcpServers": {"projections": {"command": "projections", "args": ["mcp"]}}}
```

In VS Code, the Projections extension already provides these tools per workspace
folder over its shared backend, so you should not also register
`projections mcp` there—doing so would duplicate every tool for the agent.

### A theme seed for another app's browser pane

If an app embeds the viewer in its own browser pane—for instance, a custom agent
harness—it cannot push a theme the way the Copilot app or VS Code does, so the
viewer's default whites and greys can clash with the surrounding UI. Instead,
the agent can pass a **theme seed**: a small set of colors and font families for
each color mode from which the viewer derives its full palette (stage, cards,
bands, rules, focus ring, accent, and contrast-corrected change colors), just as
it does for the Copilot app.

```json
{
  "light": {"background": "#f7f6f3", "text": "#2f2e2b", "muted": "#75736d", "border": "#e4e2dd", "accent": "#c96442"},
  "dark": {"background": "#1f1e1c", "text": "#ecebe7", "border": "#3a3935", "accent": "#d97757"}
}
```

- Both `light` and `dark` are optional; omitting a mode keeps the viewer's
  default palette in that mode. Color mode selection still follows the app (or
  the system), and the seed only controls colors.
- Each mode accepts `background` (required: the app surface behind the page),
  `text`, `muted`, `border`, `accent` (selection and links), `focus` (the focus
  ring, falling back to `accent`), and `sans` and `mono` (comma-separated font
  family names already available to the page—seeds never load external fonts).
  Any other key is rejected.
- Colors must be `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()`, or `rgba()`. Font
  families must be plain or quoted names separated by commas. Individual values
  are capped at 512 characters and the entire seed at 4096. Any invalid input
  rejects the whole seed so arbitrary CSS never reaches the page.
- Rules and card borders use the seed's `border` color verbatim so they match
  the host app, even when softer than the default theme's 3:1 edges; semantic
  lines like graph links still enforce 3:1 contrast.
- Pass a seed to `projections view --theme SEED` or
  `projections view show --theme SEED` as a built-in name (`claude` for Claude
  Code's Preview pane, `chatgpt` for the ChatGPT and Codex apps' browser panes),
  inline JSON, or a path to a JSON file. The CLI validates the seed (failing
  with details if invalid) and appends it to the printed and opened URL as
  `?theme=` holding the percent-encoded compact JSON. With `projections mcp`,
  append `?theme=` to the URL returned by `open_projection` using
  `encodeURIComponent(JSON.stringify(seed))` (making sure `#` becomes `%23`).
- The seed lives strictly in that URL, not in the viewer process: opening the
  same viewer from another link (such as the Copilot app canvas or another
  browser) keeps its own theme. Reloads and reconnects preserve it. If a page
  receives an invalid seed, it ignores it, notes the issue in its status line,
  and reports why in `current_view` (which also notes when a valid seed was
  applied).
- Precedence is: a seed in the URL overrides the Copilot app's theme, which
  overrides the default theme.

Because a theme seed describes the host app rather than the repository or
machine (which may run several apps, including the Copilot app), Projections
does not persist a default seed. Its two built-in seeds cover both light and
dark modes: `claude` matches Claude Code's Preview pane to the Claude app's
adjacent Files and Terminal panes, and `chatgpt` matches the ChatGPT and Codex
desktop apps' surfaces, text, hairline rules, and selection blue. For another
app, the agent can read colors from the app's CSS or source, sample a screenshot
for surface, text, and rule colors, or ask the user, then store the seed in that
app's custom instructions or `AGENTS.md` and pass it whenever opening the
viewer. In the Copilot app and VS Code, leave the seed out since they theme the
viewer natively. For example, in a harness's instructions:

```md
When you show a Projections viewer in this app's browser pane, open it with
`projections view show --theme .harness/projections-theme.json …` (that file
holds the seed above), or add its `?theme=` to the URL you open.
```

### MCP Apps hosts

Projections no longer serves the viewer as an MCP App (the inline view rendered
inside conversations by hosts like Claude Desktop). It was removed because
Projections targets coding agents that already have their own shell and browser.
MCP Apps hosts receive the exact same tools as any other client:
`open_projection` launches the viewer and returns its URL for the agent to open
in its own browser or the system browser.
