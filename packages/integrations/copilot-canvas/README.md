---
description: Shows the Projections viewer as a Copilot app canvas
icon: panel-right
---

# Projections canvas for the GitHub Copilot app

`extension.mjs` is a Copilot CLI extension that shows the Projections viewer
(`projections view`) as a canvas in the GitHub Copilot app's side panel. It is a
thin adapter: the viewer, its page and its tools are the CLI's.

- **Install** it in a repository with `projections canvas install`, which writes
  it to `.github/extensions/projections/extension.mjs` (commit it to share it).
  It runs the `projections` CLI on `PATH`, or the one `PROJECTIONS_CLI` names.
- **Open** (`open_canvas` with canvas `projections`) starts or reuses the
  project's viewer and returns its URL. Its input is `open_projection`'s: a
  projection, and `before` and `after` or a `choice` (`branch`, `uncommitted`,
  `last-commit`, `now`, `release`, `bookmark:<id>`), a `mode`, a `scenario` or
  an `entity` to select, and the canvas's own `project`. The viewer is keyed by
  project, so opening again, or the app rehydrating the canvas after a reload,
  shows the same view; an instance's input is applied once (recorded in the
  session's workspace), so a rehydrated canvas never undoes what the agent
  showed since.
- **Side by side:** `viewer` names one of several independent viewers, each its
  own page and state, so canvases side by side show different projections. An
  instance opened on a named viewer keeps it: its actions address it unless they
  name another. The person can switch a canvas to another projection from its
  title, and `current_view` says so.
- **Project:** as in a terminal, the CLI uses the nearest project from the
  session's working directory: a directory with its own `.github/projections`,
  else the repository's root. `project` (a directory relative to the
  repository's root, such as `opensource`) names another, as `--root` does.
- **Actions** are the agent tools of the same names and schemas, read from the
  CLI's catalog (`projections mcp`'s `tools/list`): `open_projection`,
  `current_view`, `screenshot` (an image the model sees) and `refresh`.
- **Session start** tells the agent, briefly, that the canvas exists.
- **Theme and layout:** the page follows the app's theme tokens and light or
  dark mode when the app mirrors them onto the canvas document, renderer stages
  included (its surfaces, text, rules, accent, focus ring and fonts; change
  colors stay Projections'), and sets `--status-bar-color` so the app's header
  continues its top edge. Its toolbar, stage and summary bar lie flat on the
  app's colour, edge to edge, as the page lays them everywhere.
- **Trust:** a viewer runs repository code (custom extractors and renderers)
  only when started with `--trust`. Once you have reviewed the repository's
  projections, run `projections view --trust`: it starts one, or replaces one
  running without trust (as the canvas starts after a restart) at the same URL,
  so the canvas reconnects. `projections view stop` stops it. The canvas never
  grants trust itself and doesn't remember it across restarts: trust is a review
  of the code as it is, and the next checkout may run other code.

The design is described in
[docs/design/agent-viewer.md](../../../docs/design/agent-viewer.md).
