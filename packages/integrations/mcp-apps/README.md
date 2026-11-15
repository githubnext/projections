---
description: Shows the Projections viewer as an MCP App, in Claude Desktop and other MCP Apps hosts
icon: app-window
---

# Projections viewer as an MCP App

This package builds the page `projections mcp` serves to
[MCP Apps](https://github.com/modelcontextprotocol/ext-apps) hosts (SEP-1865,
`io.modelcontextprotocol/ui`), such as Claude Desktop: the viewer the agent
drives (`projections view`), shown by the host itself, in the conversation, a
side panel or full screen. The CLI embeds it; there is nothing to install.

- **The view** is `ui://projections/viewer`, one self-contained HTML document
  (`dist/viewer.html`): the viewer's page (the Inspector's `mountViewer`), its
  stylesheet, the shared engine and comparator Workers, their Wasm modules and
  the built-in renderer bundles, all inline. The host's sandbox gives a view no
  URL to load anything from and no network, loopback included, so the page makes
  its Workers and renderer documents Blob URLs, as the VS Code webview does.
- **Linked to `open_projection`** (`_meta.ui.resourceUri`): each call shows the
  view. It asks to open beside the conversation (`preferredDisplayMode`, which
  Claude reads), and its header has a button that asks the host for its larger
  mode (`ui/request-display-mode`) where the host offers one.
- **Its requests go through the server.** The page calls `viewer_request`, a
  tool only views may call (`visibility: ["app"]`), which `projections mcp`
  relays to the viewer as a browser's requests would go: the view state's long
  poll and reports, the service's read routes and extraction jobs, and renderer
  bundles (custom renderers too, relayed as Blob documents). The viewer stays
  the one source of the view state, so the view mirrors every other page of it,
  and `current_view` and `screenshot` read what the person sees there. Long
  answers come in parts. The view never sees the viewer's token and can't reach
  its control endpoints: it reads and reports, and drives nothing.
- **Theme:** the page follows the host's light or dark mode and maps its
  standardized style variables (`--color-background-primary`,
  `--color-text-primary`, `--color-text-secondary`, `--color-border-primary`,
  `--color-ring-primary`, `--color-text-info`, `--font-sans`, `--font-mono`,
  usually `light-dark()` values) onto the renderer theme tokens and the chrome,
  as the Copilot app's canvas variables are (`mcpAppThemeTokens` in
  [`packages/host/core`](../../host/core/README.md)). Change colors stay
  Projections'.
- **Only for hosts that say so.** `projections mcp` offers the view, its
  resource and the relay only to a client whose `initialize` declares the
  extension with `text/html;profile=mcp-app`; every other client sees exactly
  the tools `serve --stdio` lists.

Using it in Claude Desktop and other hosts is described in
[the agent tools](../../../docs/runner/agent-tools.md#mcp-apps-hosts).

## Developing

`npm run build` writes `dist/viewer.html` from the Inspector's client build
(build the Inspector first); rebuild the CLI to embed it. `npm run test:browser`
hosts the page in a minimal MCP Apps host (`browser/harness.ts`) shaped like
Claude's: an opaque-origin `srcdoc` frame under the policy Claude serves its
sandbox with, its tool calls relayed to this checkout's `projections mcp`.
