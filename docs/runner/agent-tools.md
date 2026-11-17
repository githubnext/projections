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
  and gives them the link only when it can't.
- `current_view`: What the view shows: its projection and definition file,
  choice and resolved revisions, mode, selection (with its generated values and
  how each differs), summary counts (including regenerated items) and changed
  items, why an extraction failed, and whether it is out of date or uses
  uncommitted definition edits.
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
agent), `ping`, `tools/list` and `tools/call`, and to an
[MCP Apps host](#mcp-apps-hosts) `resources/list`, `resources/templates/list`
and `resources/read` too; `notifications/initialized` is accepted and
`notifications/cancelled` stops a call, which then gets no reply. Tool calls run
concurrently. Standard output carries only protocol messages; diagnostics go to
standard error. It serves the repository at `-C DIR` (or the working directory)
and exits when standard input closes or on a signal. It lists exactly the tools
`serve --stdio` lists, with the same schemas, so VS Code's agent and any other
get the same tools. The view actions (`open_projection`, `current_view`,
`refresh`) are answered by the viewer, and `compare`, `check`, `describe_part`,
`set_part` and `screenshot` take what they omit from what it shows, saying so,
as VS Code's tools do from the projection tab in front.

## The viewer

```sh
projections view [--open] [--trust] [--port N] [-p ID] [--choice CHOICE | --before REV --after REV] [--mode MODE]
projections view show|current|screenshot|refresh
```

The viewer is a page on loopback that a coding agent drives and the person
watches ([design](../design/agent-viewer.md)): the projection's stage, with its
comparison modes, playback, zoom and settings, under a one-line header saying
what is compared in words and a status line. It is how an agent shows the person
its work, and what a person asking to "open it in the inspector" means. There is
no editing, and the page names no files: errors are plain words, and the details
reach the agent through `current_view`. Selecting an item, changing the mode or
playing is reported to the agent, and every open page mirrors the others.

`projections view` serves it until interrupted and prints its URL
(`http://127.0.0.1:PORT/TOKEN/`); requests without the random token are refused,
and so are requests whose `Host` isn't loopback. `open_projection` in
`projections mcp` starts one in the MCP server's process when none runs. A
per-repository record in the user cache lets the subcommands and other MCP
servers find the running one: `projections view show` (starting one in the
background, which stops after 15 idle minutes, when none runs),
`current [--json]`, `screenshot --out FILE` and `refresh` call the same tools
and print their results. An agent opens the page for the person itself: in its
own browser when it has one, else in the system browser
(`projections view show --open`, which opens a running viewer's page too); the
bare link is the fallback. The page follows the working tree with the working
tree's definition: a save extracts and replays again.

In the GitHub Copilot app, `projections canvas install` adds the viewer as a
canvas (`.github/extensions/projections/extension.mjs`): opening it starts or
reuses the viewer, its actions are the same four tools, and the page follows the
app's theme
([the canvas](../../packages/integrations/copilot-canvas/README.md)).

Add it to an agent as a stdio server whose command is `projections mcp`, run in
the repository (or with `-C DIR`). For example, in an MCP client configuration:

```json
{"mcpServers": {"projections": {"command": "projections", "args": ["mcp"]}}}
```

In VS Code, the Projections extension already gives the agent these tools for
each workspace folder, on the backend its views share, so `projections mcp`
isn't registered there: the agent would see every tool twice.

### MCP Apps hosts

In a host that shows MCP servers' interactive views
([MCP Apps](https://github.com/modelcontextprotocol/ext-apps), such as Claude
Desktop), the viewer appears in the conversation itself: `open_projection` shows
it there, or beside the conversation, and there is no page to open. The person
plays, scrubs, zooms, changes the mode and selects there, as in the viewer's
page, and `current_view` and `screenshot` read what they see. The host shows the
view in its sandbox, with no network, so `projections mcp` relays its requests
to the viewer; the view never drives it, and never sees its token
([the view](../../packages/integrations/mcp-apps/README.md)).

`projections mcp` offers this only to a host whose `initialize` declares the
extension (`io.modelcontextprotocol/ui` with `text/html;profile=mcp-app`): it
adds the view (`ui://projections/viewer`, in `resources/list` and
`resources/read`), links `open_projection` to it (`_meta.ui.resourceUri`) and
lists `viewer_request`, the view's relay, which hosts offer only to views
(`visibility: ["app"]`). Other clients see the same tools as before.

**Claude Desktop.** Open **Settings ▸ Developer ▸ Edit Config** and add the
server to `claude_desktop_config.json`. Claude Desktop starts it with neither
your shell's `PATH` nor a working directory you choose, so give the CLI's full
path (`command -v projections` prints it) and the repository with `-C`:

```json
{
  "mcpServers": {
    "projections": {
      "command": "/absolute/path/to/projections",
      "args": ["mcp", "-C", "/absolute/path/to/your-repository"]
    }
  }
}
```

Restart Claude Desktop (or, with Developer Mode on, use **Developer ▸ Reload MCP
Configuration**), and ask Claude to show you a projection. Claude asks before it
first shows the view; it opens it beside the conversation where it can (the side
panel), else in the conversation, where the view's header has a button that
moves it beside the conversation. Add `--trust` to `args` only once you have
reviewed the repository's projection code, as for any `projections mcp`.

**Other hosts.** Configure `projections mcp` as a stdio server as the host
documents; a host that supports MCP Apps shows the view, and one that doesn't
uses the tools as text. The view needs a host whose sandbox lets it run
WebAssembly and start Blob Workers and Blob frames, as Claude's does: it runs
the shared engine and the renderers itself. In a host whose policy forbids them,
the view says it couldn't start, and `open_projection` still says what is shown
and gives the viewer's URL to open in a browser. A host that has no larger
display mode shows the view in the conversation only.
