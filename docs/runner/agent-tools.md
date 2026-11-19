# Agent tools

```sh
projections mcp [--trust] [-C DIR]
```

Projections offers coding agents one set of tools, implemented once in the CLI
over the same service the Inspector uses. The VS Code extension registers them
as language model tools for VS Code's agent (from `serve --stdio`'s `tools/list`
and `tools/call`), and `projections mcp` serves them to any other agent as a
[Model Context Protocol](https://modelcontextprotocol.io) server. Results are
concise text a model reads (names, counts and summaries, cut at 24 KB, never raw
documents), with the same facts as `structuredContent`.

- `list_projections`: The projections a revision defines, each with its
  extractor, renderer and comparator and whether it runs repository code, and
  invalid definition files with their errors. Runs nothing.
- `compare`: One projection's comparison of two revisions (default: the
  suggested pair, as the editor's; in VS Code, the projection tab's): its steps,
  each change with its label and summary, counts by status, the comparator's
  classification, such as API compatibility levels, and generated values (how
  many changed, by the basis parts that moved, and how many were only
  regenerated from the same inputs), named as generated rather than extracted
  facts. `maxChanges` bounds the changes described. Given revisions apply the
  base revision's definition (`definition: head` the head's); the suggested or
  shown pair applies the definition the viewer (or tab) applies, the working
  tree's unless it shows the committed one, so a bookmark saved before its
  projection was written still compares. `definitionRevision` chooses another.
- `explore`: The built-in projections that apply here, each with the files that
  suggested it, whether it is adopted and whether it runs repository code.
- `sweep`: Projections on the last changes: per projection, changed in N of M,
  the median size and the changes it showed most on, and the changes where
  several changed. `latest` summarizes the latest sweep (one the Explore view
  ran).
- `check`: `projections check`'s report: pass, fail, warn or skip per check;
  `render` adds the renderer checks.
- `prepare`: Runs the environment's prepare steps (`projections prepare`), in
  the working tree or, with `revision`, the workspace for a commit; each step's
  outcome, or the failing step with its log's end. Needs trust.
- `run_comparator_tests`: Comparator tests' cases, with each failure's
  expectation, message and diff.
- `describe_part`: A built-in extractor, renderer or the comparator: what it
  reads or accepts, its inputs or options, and a definition template.
- `open_projection`: Shows the person a projection: in VS Code a projection tab,
  with `projections mcp` the [viewer](#the-viewer); on a pair or a `choice`
  (`branch`, `uncommitted`, `last-commit`, `now`, `release`, `bookmark:<id>`) or
  a renderer `scenario`, in a `mode`, optionally selecting an entity. The agent
  opens the viewer's URL for the person (in its own browser, else the system's)
  and gives them the link only when it can't. With `projections mcp`, `viewer`
  names one of several independent viewers, each its own page, to show
  projections side by side.
- `current_view`: What the view shows: its projection and definition file,
  choice and resolved revisions, mode, selection (with its generated values and
  how each differs), summary counts (including regenerated items) and changed
  items, why an extraction failed, and whether it is out of date or uses
  uncommitted definition edits, and whether the person chose the projection from
  the page's title. With `projections mcp`, `viewer` reads a named viewer, and
  the result lists the others.
- `refresh`: Extracts what the view shows again and says what it shows then.
- `screenshot`: A PNG of a projection drawn by its real renderer in a headless
  browser (as `--png`), returned as an image; by default what the view shows, in
  its mode, playback position, theme and size.
- `adopt`: Writes explore candidates' definitions and bookmarks (as
  `projections adopt`).
- `set_part`: Sets a definition's `extractor`, `comparator` or `renderer`
  (`null` removes one), keeping its other fields, previewed as a diff.
- `update_snapshots`: Rewrites comparator tests' snapshots to what the
  comparator produces now.

The first seven are read-only (`readOnlyHint`); the three writes are not, and
`set_part` and `update_snapshots`, which can replace content, are
`destructiveHint`. No tool writes CI: where the Projections step goes depends on
the repository's workflows, so the agent reads them and proposes the change, as
`projections help agents ci` explains, and writes it only once the person
agrees. Each tool's `inputSchema` is a JSON Schema object with
`additionalProperties: false`; arguments that don't match are a result with
`isError`.

**Writes preview, then confirm.** A write called without `confirm` previews: the
files it would create or change (a diff for `set_part`, the differing snapshots
for `update_snapshots`), and in `structuredContent.confirm` a token naming
exactly that write (the files' current contents and what it would write). Called
again with the same arguments and `confirm` set to the token, it writes, but
only if nothing changed: when the files or the change differ, nothing is written
and the result (`isError`) is the new preview with a new token. An agent shows
the person the preview before confirming, and adopts only what they chose. In VS
Code the editor asks the person instead, and confirms on their approval.

````json
{"jsonrpc": "2.0", "id": 5, "method": "tools/call", "params": {"name": "set_part", "arguments": {"projection": "deps", "renderer": "dag"}}}
{"jsonrpc": "2.0", "id": 5, "result": {"content": [{"type": "text", "text": "Setting the renderer of deps changes .github/projections/deps.json:\n```diff\n  …\n-   \"renderer\": \"graph\",\n+   \"renderer\": \"dag\",\n  …\n```\n\nNothing was written. Show the person this preview; to write it, call set_part again with the same arguments and confirm: \"5d0c4e1b2a39f8e7c6d1\".\n"}],
  "structuredContent": {"projection": "deps", "path": ".github/projections/deps.json", "changed": true, "written": false, "confirm": "5d0c4e1b2a39f8e7c6d1", "...": "..."}, "isError": false}}
{"jsonrpc": "2.0", "id": 6, "method": "tools/call", "params": {"name": "set_part", "arguments": {"projection": "deps", "renderer": "dag", "confirm": "5d0c4e1b2a39f8e7c6d1"}}}
````

**Trust** is the server's, as for `serve --stdio`: without `--trust`, a
projection whose extractor is repository code doesn't extract (`compare`,
`sweep` and `check` say it needs trust), `set_part` and `update_snapshots`
preview but don't write, and `adopt` writes only in an explore session (a
repository with no projections of its own yet). Previews always work. Start
`projections mcp --trust` only once the person has reviewed the repository's
projection code.

**Protocol.** `projections mcp` speaks MCP over stdio: JSON-RPC 2.0, one message
per line, protocol version `2025-06-18` (it also accepts `2025-03-26` and
`2024-11-05` from a client that asks for them). It answers `initialize`
(capabilities `{"tools": {"listChanged": false}}`, with instructions for the
agent), `ping`, `tools/list` and `tools/call`; `notifications/initialized` is
accepted and `notifications/cancelled` stops a call, which then gets no reply.
Tool calls run concurrently. Standard output carries only protocol messages;
diagnostics go to standard error. It serves the repository at `-C DIR` (or the
working directory) and exits when standard input closes or on a signal. It lists
exactly the tools `serve --stdio` lists, with the same schemas, so VS Code's
agent and any other get the same tools. The view actions (`open_projection`,
`current_view`, `refresh`) are answered by the viewer, and `compare`, `check`,
`describe_part`, `set_part` and `screenshot` take what they omit from what it
shows, saying so, as VS Code's tools do from the projection tab in front.

**Reviewing a change to the tools.** This repository's `agent-tools` projection
(`.github/projections/agent-tools.json`) lists every tool, its parameters and
the surfaces that expose it (`projections mcp`, VS Code's `languageModelTools`
and the Copilot app canvas), read from source at each revision. Its comparator
classifies each change as the agents calling the tools meet it (a parameter
removed, made required or narrowed is breaking) and flags drift between
surfaces, such as a stale VS Code manifest:
`projections compare main.. -p agent-tools --trust`.

## The viewer

```sh
projections view [--open] [--trust] [--port N] [-p ID] [--choice CHOICE | --before REV --after REV] [--mode MODE] [--viewer NAME] [--theme SEED]
projections view show|current|screenshot|refresh [--viewer NAME]
projections view stop [--rotate]
```

The viewer is a page on loopback that a coding agent drives and the person
watches ([design](../design/agent-viewer.md)): the projection's stage, with its
comparison modes, playback, zoom and settings, under a one-line header saying
what is compared in words and a status line. It is how an agent shows the person
its work, and what a person asking to "open it in the inspector" means. There is
no editing, and the page names no files: errors are plain words, and the details
reach the agent through `current_view`. Selecting an item, changing the mode or
playing is reported to the agent, and every open page mirrors the others. The
title is also a menu of the repository's projections: the person can switch the
page to another one, which becomes what the viewer shows for the agent too.

One viewer can show several **named viewers** side by side: `--viewer NAME` on
`projections view` and its subcommands, or `viewer` on the view tools and
`screenshot`, names one, made when first shown. Each has its own state and page
(`http://127.0.0.1:PORT/TOKEN/?viewer=NAME`), and its pages mirror only one
another. Without a name, everything uses the default viewer, as before; the
other tools' defaults (`compare`, `check`, `set_part`) come from it.

`projections view` serves it until interrupted and prints its URL
(`http://127.0.0.1:PORT/TOKEN/`); requests without the random token are refused,
and so are requests whose `Host` isn't loopback. The bare port (or a link
without the right token) answers with a short page saying the viewer needs its
full link and how to get it (`projections view current`), never the link itself.
The token and port are kept per project in the user cache, so a viewer that
restarts serves the same URL; `--port N` (on `projections view` or
`projections view show`) picks the port when it starts one, and is refused while
a viewer runs on another. `projections view stop --rotate` forgets the link: the
next viewer has a new token, and earlier links stop working. `open_projection`
in `projections mcp` starts one in the MCP server's process when none runs. A
per-repository record in the user cache lets the subcommands and other MCP
servers find the running one: `projections view show` (starting one in the
background, which stops after 15 idle minutes, when none runs),
`current [--json]`, `screenshot --out FILE` and `refresh` call the same tools
and print their results. `screenshot --page` captures the viewer's own page in a
headless browser instead, with its header, toolbar and summary bar, as a page
opened now shows it. A page counts as open while it asks the viewer for the view
(every 20 seconds at most); when none does, `current_view` says what the viewer
saw instead: a page that loaded but never ran its script or never asked, one
that stopped asking (closed, hidden or suspended), requests refused for a
non-loopback host, or requests without the token. An agent opens the page for
the person itself: in its own browser when it has one, else in the system
browser (`projections view show --open`, which opens a running viewer's page
too); the bare link is the fallback. The page follows the working tree with the
working tree's definition: a save extracts and replays again.

In the GitHub Copilot app, `projections canvas install` adds the viewer as a
canvas (`.github/extensions/projections/extension.mjs`): opening it starts or
reuses the viewer, its actions are the same four tools, and the page follows the
app's theme
([the canvas](../../packages/integrations/copilot-canvas/README.md)).

In Claude Code's Preview pane (the Claude app), `preview_start` starts only a
server named in `.claude/launch.json`, so the agent adds an entry that runs the
viewer in the foreground on a fixed port with Claude's colors, starts it, and
navigates the Preview tab to the full link
`projections view show --theme claude` prints (the bare port shows only a page
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

`--trust` belongs in `runtimeArgs` only when the projection runs repository
code, and `autoPort: false` keeps Claude from moving the server to another port,
which the viewer wouldn't follow. Whether `.claude/launch.json` is committed or
ignored is the repository's choice. The pane refuses requests from a sandboxed
frame to a loopback address, the viewer's renderer frames among them, so the
page opens a renderer's document itself there, in the same sandboxed frame
([the agent viewer](../design/agent-viewer.md#renderer-frames-a-browser-wont-load)).

Add it to an agent as a stdio server whose command is `projections mcp`, run in
the repository (or with `-C DIR`). For example, in an MCP client configuration:

```json
{"mcpServers": {"projections": {"command": "projections", "args": ["mcp"]}}}
```

In VS Code, the Projections extension already gives the agent these tools for
each workspace folder, on the backend its views share, so `projections mcp`
isn't registered there: the agent would see every tool twice.

### A theme seed for another app's browser pane

An app that shows the viewer in its own browser pane, such as a custom agent
harness, can't theme the page the way the Copilot app and VS Code do, so the
page's default whites and greys may not match the app around it. The agent can
give the page the app's colors instead: a **theme seed**, a few colors and
families for each color mode, from which the page derives the rest of its theme
(the stage, cards and bands, rules, focus ring and accent, contrast-corrected
change colors) as it does from the Copilot app's.

```json
{
  "light": {"background": "#f7f6f3", "text": "#2f2e2b", "muted": "#75736d", "border": "#e4e2dd", "accent": "#c96442"},
  "dark": {"background": "#1f1e1c", "text": "#ecebe7", "border": "#3a3935", "accent": "#d97757"}
}
```

- `light` and `dark` are each optional; a mode the seed leaves out keeps the
  page's own theme in that mode. The page's color mode still follows the app
  (else the system); the seed decides only its colors.
- Each mode takes `background` (required: the app's surface the page sits on),
  `text`, `muted`, `border`, `accent` (selection, links), `focus` (the focus
  ring; the accent when absent) and `sans` and `mono` (font family names the
  page already has; a seed loads no fonts). Nothing else is accepted.
- Colors are `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()` or `rgba()`; families are
  plain or quoted names separated by commas; each value is at most 512
  characters and the seed at most 4096. Anything else is refused whole, so a
  seed never reaches the page as CSS.
- Rules and card edges are drawn in the seed's `border` as given, as the app
  draws its own, even when that is quieter than the default theme's 3:1 edges;
  lines that carry meaning, such as a graph's links, keep 3:1.
- `projections view --theme SEED` and `projections view show --theme SEED` take
  it as a built-in seed's name (`claude`, for Claude Code's Preview pane),
  inline JSON or a JSON file's path, check it (an invalid seed fails with what
  is wrong) and put it in the link they print and open, as `?theme=` with the
  seed's compact JSON, percent-encoded. With `projections mcp`, add `?theme=` to
  the URL `open_projection` gives (`encodeURIComponent(JSON.stringify(seed))`; a
  `#` must be `%23`).
- The seed lives only in that link, not in the viewer: a page opened from
  another link (the Copilot app's canvas on the same viewer, another browser)
  keeps its own theme. Reloading and reconnecting keep it. A page whose seed
  isn't valid ignores it, says so in its status line, and `current_view` says
  why; `current_view` also says when a page took one.
- A seed in the link wins over the Copilot app's theme, which wins over the
  default theme.

The seed belongs to the app, not to the repository or the machine (one machine
may run several apps, the Copilot app among them), so Projections keeps no
default seed. Its only built-in seed is `claude`, Claude Code's Preview pane,
matched to the Claude app's own panes beside it (Files, Terminal) in both modes.
The agent finds the colors from the app itself: its own CSS or source when the
agent can read them, a screenshot of itself sampled for its surface, text and
rule colors, or by asking the person. It keeps the seed in the app's own agent
instructions (its custom instructions or `AGENTS.md`) and passes it every time
it opens the page. In the Copilot app and VS Code, which theme the viewer
themselves, it passes none. For example, an instruction for a harness:

```md
When you show a Projections viewer in this app's browser pane, open it with
`projections view show --theme .harness/projections-theme.json …` (that file
holds the seed above), or add its `?theme=` to the URL you open.
```

### MCP Apps hosts

Projections no longer serves the viewer as an MCP App (the inline view that MCP
Apps hosts such as Claude Desktop show in the conversation); it was removed
because Projections is for coding agents, which have a shell and a browser of
their own. A host that supports MCP Apps gets the same tools as any other
client: `open_projection` starts the viewer and gives its URL, which the agent
opens in its own browser, or the system browser.
