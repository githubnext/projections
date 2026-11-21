# Developing the VS Code extension

This guide walks through how the
[Projections extension for VS Code](../../packages/integrations/vscode/README.md)
is wired together, and how to build, run, and test it locally.

## How it works

- **Backend.** The extension spawns the CLI (see
  [Distribution](../../packages/integrations/vscode/README.md#distribution) for
  which binary it picks) as `projections serve --stdio` and talks JSON-RPC 2.0
  over stdin/stdout, one message per line (`src/runner.ts`; protocol details are
  in [`docs/runner.md`](../runner/stdio-backend.md)). It sends `initialize`,
  then one `request` per API call, along with `$/cancelRequest` whenever the
  webview aborts an in-flight call. Standard error streams to the
  **Projections** output channel. Each workspace folder's panel, comparator
  tests, and commands share a single backend (`src/backends.ts`). Once nothing
  needs it anymore (the panel is closed and the folder has no test files), the
  extension closes its stdin to shut it down cleanly, killing it if it hasn't
  exited within three seconds.
- **UI.** The webview bundle (`dist/webview.js`, built with esbuild) imports
  both the mountable Inspector (`@githubnext/projections-inspector/mount`) and
  the VS Code UI package (`@githubnext/projections-host-vscode`) so they share a
  single React instance, then mounts the Inspector with `VscodeProjectionView`
  on a root element tagged `data-host-ui="vscode"`. Menus and widgets use native
  VS Code controls (VSCode Elements and codicons), and `inspector.css` styles
  the Inspector shell as VS Code title areas, sidebar sections, panel tabs,
  quick picks, and status bars using the `--vscode-*` CSS variables so it tracks
  any color theme. The Inspector's `mount.css`, VS Code UI stylesheets, and the
  codicon font ship as webview resources (`dist/inspector/`, `dist/vscode-ui/`),
  with the font loaded under `font-src ${cspSource}`.
- **Transport.** The webview connects via `createMessageTransport`: each API
  call goes over `postMessage` to the extension bridge (`src/bridge.ts`), which
  validates that the path starts with `/api/` (`parseTransportMessage`) and
  forwards it as a JSON-RPC `request` (canceling on abort). Replies keep the
  transport shape `{status, body}` — or `{type, base64}` for binary payloads
  like recent-changes thumbnails — and reject responses larger than 64 MiB.
  Server-relative URLs resolve against a sentinel origin `http://stdio.invalid`
  that is never actually fetched. Rather than long-polling for working-tree
  changes, the transport subscribes via `next` and the bridge replies from the
  backend's `changes` notifications. Remote workspaces work identically because
  the backend runs alongside the extension host.
- **Explore.** In-page links switch the mounted view directly
  (`viewLinksInPlace`), and clicking a recent-changes cell's projection, before,
  or after opens the Inspector directly on that state (`initial`). In a
  repository that already defines projections, the Inspector lists only the
  repo's own projections plus any candidate opened from Explore; Explore itself
  scans recent commits for every candidate. The extension relabels that grid's
  buttons in VS Code's own terminology via `sweepLabels` (Check recent commits,
  Check again) so the word "sweep" never surfaces in the UI.
- **Security.** There is no listening port or auth token — the backend is only
  reachable through the parent process's pipes, so no other local process or web
  page can talk to it, and the webview holds no credentials. Because the webview
  never makes network calls, `portMapping` isn't needed.
- **Trust.** The extension passes `--trust` only in trusted workspaces
  (`untrustedWorkspaces: limited`). In Restricted Mode, only built-in extractors
  and renderers run and definitions can't be saved; granting workspace trust
  restarts the backend with `--trust`. When a repository has no projections yet,
  the backend runs in an explore session so Adopt can write in either mode;
  otherwise writing requires a trusted workspace.

## Webview content security policy

```
default-src 'none';
script-src 'nonce-<random>' <webview resources> 'wasm-unsafe-eval';
style-src <webview resources> 'unsafe-inline';
img-src <webview resources> data: blob:;   font-src <webview resources> data:;   media-src data: blob:;
connect-src <webview resources>;   worker-src blob:;   frame-src blob:;
object-src 'none'; base-uri 'none'; form-action 'none'
```

- All scripts come from the extension's own packaged files; nothing is fetched
  over the network or from localhost.
- Because a webview can't launch a Worker from a cross-origin resource URL, the
  engine and comparator Workers ship as single-file bundles (`dist/workers/`)
  started from Blob URLs, with the engine's Wasm modules passed in as bytes.
- Renderers still run inside `sandbox="allow-scripts"` frames with opaque
  origins. Since sandboxed frames can't load webview resource URLs directly,
  each built-in renderer (a self-contained HTML file) is fetched and loaded via
  a Blob URL. A Blob document inherits the webview's CSP alongside its own, so
  we attach the page's nonce to parsed script tags while preserving the
  renderer's stricter `connect-src 'none'` and `frame-src 'none'` rules.
- Extension messages arrive from the webview's origin, whereas renderer frames
  post from `null`, preventing a renderer from impersonating the extension
  transport.
- Custom repository renderer bundles (`renderer: {bundle}`) follow the same
  pattern through the Inspector's `relayRendererFrames`. Before a frame's `src`
  is set to `http://stdio.invalid/custom-renderers/…`, the page requests the
  file from the extension (`rendererFile`). The bridge accepts only
  `/custom-renderers/` paths, fetches the file through the backend (enforcing
  frame a Blob document with the page's nonce and original fragment. Because a
  local renderer dev server isn't reachable from a webview, the built bundle is
  used instead.

## Develop and test

```sh
npm run build --workspace @githubnext/projections-inspector   # the mountable Inspector and its client assets
npm run build --workspace @githubnext/projections-host-vscode  # the VS Code UI and its codicon font
cargo build -p projections-cli --release && rm -f packages/cli/dist/projections && cp target/release/projections packages/cli/dist/   # the backend
npm run build --workspace projections-vscode     # also bundles the JSON Schemas into dist/schemas
npm test --workspace projections-vscode          # client, bridge, CLI, schema, packaging and agent tool tests, and the real backend
npm run test:vscode --workspace projections-vscode   # downloads VS Code into .vscode-test and runs the smoke test
```

The smoke test (`test/smoke/`, where `suite.cjs` runs each workflow in
`workflows/` in order using `helpers.cjs`) opens a demo repository — npm
workspaces with dependency changes on a branch and one adopted projection — with
schema downloads disabled. It exercises the full extension end to end:

- **Explore, Inspector, and validation.** It opens Explore, inspects candidates
  and recent commits, opens a candidate cell in the Inspector, and previews
  Adopt as a dry-run diff. It checks that the Inspector lists only the repo's
  adopted projection, compares `main` → `HEAD` in the webview's engine Worker,
  jumps from entity evidence to the editor, runs **Compare Branch With
  Default**, and confirms invalid definitions are caught using the bundled
  schema.
- **Jobs-to-be-done sidebar, status bar, and tab layout.** It verifies that a
  new tab defaults to Branch changes (since the demo is one commit ahead of
  main), that the sidebar shows its four views in order (Viewing, Projections,
  Definition, Suggested) with plain command titles and Add to CI… in the
  Projections `…` menu, and that Suggested lists candidates with Adopt. In
  Viewing, only the active choice is checked (", selected" for screen readers),
  the title stays "Viewing", and rows show concise facts. The status bar item
  displays the choice with the projector mark and a tooltip listing revisions,
  span, and changed files; the tab itself has no choice control or Pin. Clicking
  the status bar opens the Viewing quick pick (grouped rows focused on the
  current choice, plus Show in Side Bar): choosing Current state shows a single
  revision and updates the check and status bar, Uncommitted compares `HEAD` →
  the working tree and persists for new tabs, and Compare two revisions…
  includes Swap. Rows are leaves with Open Definition in their context menu
  (with no Develop tab or command), changed projections carry a count badge from
  the decoration provider in the modified color, side-by-side panes fill the
  stage with a single 1px divider, and from first paint a tab never shows "No
  extraction loaded" or more than one loading bar (at most 24 px tall).
- **Definition view, editing, and live refresh.** The Definition view tracks the
  active tab across multiple tabs while keeping its title "Definition", and
  pinning locks it with a message naming the pinned projection. Its definition
  row opens the file, built-in part rows (and Go to Source…'s built-in item)
  open bundled documentation in the Markdown preview without leaving VS Code,
  and Configure… on the default comparator updates the file cleanly. Editing a
  source file marks the open tab out of date without re-extracting (preserving
  jobs and results) and shows the notice, the row's "Out of date" label, and the
  status bar warning until Refresh clears them; hidden tabs restore their result
  and notice without re-extracting. Editing the definition marks the tab out of
  date and Refresh applies "Your edits"; Show committed and Use my edits toggle
  between committed and edited definitions (persisted across reload), further
  edits exit Show committed, and discarding edits returns to the committed
  definition. Saving a custom renderer's source while its tab is open starts its
  watch task — the Renderer row reports built, then build failed with
  diagnostics in Problems, and closing the tab stops the task.
- **History, bookmarks, agent tools, wizard, and Testing view.** Find Recent
  Changes populates Viewing's Recent changes (clicking one selects it and shows
  its subject in the status bar), Bookmark adds it under Bookmarks (clicking
  reselects it) and Remove deletes it, and a renderer's `scenarios.json` appears
  under Definition's Renderer. The suite lists and invokes agent tools via
  `vscode.lm.invokeTool` (listing projections, running a comparison, opening a
  tab pinned to two revisions with an entity selected) and previews a `set_part`
  write that shows a diff and writes only on approval. It walks **New
  Projection…** end to end: picking a built-in extractor (Workspace
  dependencies) and a compatible renderer (default first, excluding renderers
  that don't support `graph/v0`), rejecting an existing ID in place, entering a
  new ID and title, and verifying `projections init` writes and opens the new
  definition and tab with its row selected. Before any panel opens, it also
  checks the Testing view: the **Projections** controller lists the projection's
  checks plus the repo's standalone comparator tests
  (`tools/first.comparator.test.yaml`) at their exact lines, reporting one pass
  and one failure on the failing expectation line. The suite drives the
  Inspector just like on a desktop: on GitHub-hosted Windows runners, whose
  default display is 1024×768 with animations disabled, `test/smoke/run.mjs`
  first switches to a 1920×1080 display and enables animations.

Several screenshot and asset scripts keep visual regressions in check:

- `scripts/screenshots/capture-themes.mjs` records real VS Code `--vscode-*`
  variables across color themes (`packages/host/vscode-ui/fixtures/themes/`).
- `scripts/screenshots/screenshots.mjs` captures the Inspector with the VS Code
  UI in dark, light, and high contrast themes, comparing against
  `docs/design/images/desktop-surfaces/vscode-*.png` and capturing Explore after
  checking recent commits (`vscode-explore-dark.png`).
- `scripts/screenshots/jobs-screenshots.mjs` captures the four sections in a 300
  px sidebar beside a projection tab in Dark and Light Modern
  (`sidebar-four-sections-*.png`, `jobs-tab-*.png`), collapsed sections with
  static titles (`sidebar-collapsed-dark.png`), the Testing view after a run
  (`testing-view-dark.png`), a comparator test file's gutter
  (`comparator-test-gutter-dark.png`), side by side
  (`vscode-side-by-side-after.png`), a loading tab (`vscode-loading-after.png`),
  the out-of-date notice (`jobs-out-of-date-dark.png`), and D4's edited
  definition notice (`jobs-edited-dark.png`).
- `scripts/screenshots/status-bar-screenshots.mjs` captures the status bar item
  across choices (`status-bar-choices-dark.png`), its tooltip
  (`status-bar-tooltip-dark.png`), and the Viewing quick pick
  (`status-bar-quick-pick-dark.png`), using keybindings whose `args` pass
  choices to **projections.setChoice** for the active folder.
- `scripts/screenshots/new-projection-screenshots.mjs`
  (`npm run screenshots:new-projection`) captures New Projection…'s initial pick
  from the Projections title bar, the compatible renderers list, and the final
  window in Dark and Light Modern (`new-projection-*.png`).
- `scripts/icon.mjs` renders `media/icon.png` from the brand's app icon.

### Manual test script

1. Build everything above, open this folder in VS Code, and launch **Run
   Extension** (or run `code --extensionDevelopmentPath=$PWD <repository>`)
   against a repo with projections — for example, one generated with
   `node test/smoke/demo-repo.mjs ../../cli/dist/projections`.
2. Run **Projections: Open Inspector**. It should open beside the editor, list
   the repo's projections, extract the default revisions, and render the
   comparison in the graph renderer.
3. Switch between light, dark, and high contrast themes: the Inspector should
   follow along, with its accent matching `focusBorder`.
4. Select a node and open its evidence from Details to jump straight to that
   line. Try Parts → Save to definition… and verify the definition path opens
   the file. In the sidebar, confirm the Definition view tracks the active tab:
   its definition row opens the file, its built-in Renderer row opens bundled
   docs in VS Code's Markdown preview (follow an internal link to another
   bundled page), and **Open Documentation on GitHub** on hover is the only
   action that leaves for a browser. Pin it and check that its message names the
   projection. Click the status bar item and switch the Viewing choice — both
   the Viewing row checkmark and status bar label should update.
5. Press `⌘K` → **Reveal After in source control** and check that Source Control
   opens with the commit ready to copy.
6. In a Restricted Mode window, confirm a repo-defined extractor prompts for
   trust; grant trust and verify the backend restarts with `--trust` and
   extracts.
7. Run **Projections: Compare Branch With Default** on a feature branch and
   confirm it compares the merge base → `HEAD`.
8. Run **Projections: Explore Repository**, check recent commits, and click a
   cell to open the Inspector on that candidate and change.
9. Run **Projections: Adopt…**, pick a candidate, review the diff editor, and
   confirm to write the definition.
10. Click **New Projection…** (`+`) in the Projections title bar, pick a
    built-in extractor and renderer, verify an existing ID is rejected in place,
    then pick a new name and confirm both the definition and tab open with the
    row selected. Also try **Ask an agent to write it** to verify chat opens in
    agent mode with a prefilled prompt.
11. Open `.github/projections/<id>.json` and introduce a schema error — Problems
    should flag it even when offline.
12. Close the panel and confirm the backend exits (`ps` should show no
    `projections serve` process).
