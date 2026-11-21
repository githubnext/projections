# Developing the VS Code extension

How the
[Projections extension for VS Code](../../packages/integrations/vscode/README.md)
is built, and how to develop and test it.

## How it works

- **Backend.** The extension starts the CLI (see
  [Distribution](../../packages/integrations/vscode/README.md#distribution) for
  which) as `projections serve --stdio` and speaks JSON-RPC 2.0 with it over the
  child's standard input and output, one message per line (`src/runner.ts`; the
  protocol is in [`docs/runner.md`](../runner/stdio-backend.md)): `initialize`,
  then one `request` per API call, with `$/cancelRequest` when the webview
  aborts one. Its standard error goes to the **Projections** output channel. A
  folder's panel, its comparator tests and commands share one backend
  (`src/backends.ts`); when nothing holds it any more (the panel closed and the
  folder has no test files), its standard input is closed, which stops it (it is
  killed if it hasn't exited three seconds later).
- **UI.** The webview page (`dist/webview.js`, an esbuild bundle) imports the
  mountable Inspector (`@githubnext/projections-inspector/mount`) and the VS
  Code UI (`@githubnext/projections-host-vscode`) together, so they share one
  React, and mounts the Inspector with `VscodeProjectionView` as its projection
  view on a root marked `data-host-ui="vscode"`. The projection view, its menus
  and widgets are VS Code's own controls (VSCode Elements and codicons), and the
  VS Code UI's `inspector.css` draws the Inspector's shell as VS Code's title
  area, side bar sections, panel tabs, quick picks and status bar, all from the
  `--vscode-*` variables VS Code gives the webview, so it follows the color
  theme. The Inspector's `mount.css`, the VS Code UI's stylesheets and the
  codicon font are webview resources (`dist/inspector/`, `dist/vscode-ui/`); the
  font loads under `font-src ${cspSource}`.
- **Transport.** The webview mounts the Inspector with `createMessageTransport`:
  every backend call is a `postMessage` to the extension, whose bridge
  (`src/bridge.ts`) accepts only `/api/` paths (`parseTransportMessage`) and
  sends each as a JSON-RPC `request`; an aborted call is cancelled in the
  backend. Replies keep the transport's shape: `{status, body}`, a binary body
  (a recent-changes thumbnail) as `{type, base64}`, and responses over 64 MiB
  fail. Server-relative URLs the backend returns resolve against the sentinel
  origin `http://stdio.invalid`, which nothing is fetched from. Working-tree
  changes aren't long-polled: the webview's transport subscribes (`next`) and
  the bridge answers from the backend's `changes` notifications. Remote
  workspaces work the same way: the backend runs beside the extension host.
- **Explore.** In-page links switch the mounted view (`viewLinksInPlace`); a
  recent-changes cell's projection, before and after open the Inspector there
  (`initial`). In a repository that already has projections, the Inspector lists
  only its own, plus a candidate the Explore view opened; the Explore view
  checks recent commits for, and opens, every candidate. The extension names
  that grid's buttons in VS Code's words (`sweepLabels`: Check recent commits,
  Check again), so the UI never says "sweep".
- **Security.** There is no port, token or listener: the backend is reachable
  only through the pipes of the process that started it, so no other local
  process or web page can call it, and nothing in the webview holds a
  credential. The webview has no network access, so `portMapping` isn't needed.
- **Trust.** The backend gets `--trust` only in a trusted workspace
  (`untrustedWorkspaces: limited`). In Restricted Mode only built-in extractors
  and renderers run and definitions aren't saved; granting trust restarts the
  backend with `--trust`. In a repository that defines no projections yet, the
  backend is an explore session, so Adopt writes in either mode; otherwise
  writing needs a trusted workspace.

## Webview content security policy

```
default-src 'none';
script-src 'nonce-<random>' <webview resources> 'wasm-unsafe-eval';
style-src <webview resources> 'unsafe-inline';
img-src <webview resources> data: blob:;   font-src <webview resources> data:;   media-src data: blob:;
connect-src <webview resources>;   worker-src blob:;   frame-src blob:;
object-src 'none'; base-uri 'none'; form-action 'none'
```

- Scripts are the extension's own files; nothing is fetched from the network or
  from localhost.
- A webview can't start a Worker from a resource URL (another origin), so the
  engine and comparator Workers are single-file bundles (`dist/workers/`)
  started from Blob URLs, and the engine's Wasm modules are passed as bytes.
- Renderers still run in `sandbox="allow-scripts"` frames (opaque origin). A
  sandboxed frame can't load a webview resource URL, so each built-in renderer
  bundle (one self-contained HTML file) is fetched and opened from a Blob URL. A
  Blob document inherits this policy in addition to its own, so its inline
  scripts get the page's nonce (set on the parsed script elements). The
  renderer's own policy (`connect-src 'none'`, `frame-src 'none'`) still
  applies.
- Messages from the extension come from the webview's origin; renderer frames
  post from `null`, so they can't pose as the extension's transport.
- Custom renderer bundles from the repository (`renderer: {bundle}`) are relayed
  the same way (the Inspector's `relayRendererFrames`): when a renderer frame's
  `src` is set to `http://stdio.invalid/custom-renderers/…`, before the frame
  loads anything, the page asks the extension for the file (`rendererFile`; the
  bridge accepts only `/custom-renderers/` paths and fetches them from the
  backend, which applies its trust policy) and gives the frame a Blob document
  of it with the page's nonce and the same fragment. A renderer development
  server isn't reachable from a webview, so the built bundle is used.

## Develop and test

```sh
npm run build --workspace @githubnext/projections-inspector   # the mountable Inspector and its client assets
npm run build --workspace @githubnext/projections-host-vscode  # the VS Code UI and its codicon font
cargo build -p projections-cli --release && rm -f packages/cli/dist/projections && cp target/release/projections packages/cli/dist/   # the backend
npm run build --workspace projections-vscode     # also bundles the JSON Schemas into dist/schemas
npm test --workspace projections-vscode          # client, bridge, CLI, schema, packaging and agent tool tests, and the real backend
npm run test:vscode --workspace projections-vscode   # downloads VS Code into .vscode-test and runs the smoke test
```

The smoke test (`test/smoke/`: `suite.cjs` runs each workflow in `workflows/` in
order, with the helpers in `helpers.cjs`) opens a demo repository (npm
workspaces whose dependencies change on a branch, with one adopted projection)
with schema downloads off. It opens Explore and checks the candidates, checks
recent commits, opens a candidate's cell in the Inspector on that change,
previews Adopt (a dry run, shown in the diff editor), checks that the Inspector
lists only the repository's projection and compares `main` → `HEAD` in the
webview's engine Worker, opens an entity's evidence in the editor, runs
**Compare Branch With Default**, and checks that a bad definition is reported
from the bundled schema. In the side bar and a projection tab it checks the
jobs-to-be-done layout: a new tab opens on Branch changes (the demo is a commit
ahead of main), the side bar's four views are in order (Viewing, Projections,
Definition, Suggested) with plain command titles and Add to CI… in the
Projections view's `…` menu, Suggested lists the candidate with Adopt, the
Viewing view checks only the current choice (", selected" for screen readers),
its title stays "Viewing" and its rows say short facts, the status bar item
reads the choice with the projector mark and its tooltip has the revisions, the
span and the files changed, the tab has no choice control or Pin, the item's
click opens the Viewing quick pick (the view's rows grouped, opening on the
current choice, then Show in Side Bar) and picking Current state there shows one
revision, checks its row and renames the item, Uncommitted compares `HEAD` → the
working tree and is remembered for a newly opened tab (and the status bar item
names it), Compare two revisions… has Swap, rows are leaves with Open Definition
in their context menu (and there is no Develop tab or command), a changed
projection's row has its count as a badge (the decoration provider's, in the
modified color), and side by side's panes fill the stage with one 1px divider.
From its first paint a tab never shows "No extraction loaded" and at most one
loading bar, at most 24 px tall. The Definition view follows the active tab
across two tabs, its title staying "Definition", the pin holds it and its
message names the pinned projection, its definition row opens the file, a
built-in part's row (and Go to Source…'s built-in item) opens its bundled
documentation in the Markdown preview without opening anything outside VS Code,
and Configure… on the default comparator offers its choice and leaves the file
valid. Editing a file makes the open tab out of date without extracting again
(the same jobs and result), with the notice, the row's "Out of date" and the
status bar item's warning (its quick pick's Refresh refreshes the tab), and its
Refresh clears them. A hidden tab comes back with its result and the notice
without extracting. Editing the definition makes the tab out of date, and
Refresh applies the edits ("Your edits"); Show committed and Use my edits switch
the tab between the committed definition and the edits (remembered across a
reload), edits that change again end Show committed, and discarding them returns
the tab to the committed definition. Saving a custom renderer's source while its
tab is open starts its watch task: the Renderer row says built, then build
failed with the error in Problems, and closing the tab stops the task. Find
Recent Changes lists the recent commits that change a projection under Viewing's
Recent changes; a click makes one the choice, which the status bar item names by
its subject and the tab shows, Bookmark lists it under Bookmarks (a click on it
sets the choice) and Remove takes it out; a renderer's `scenarios.json` shows
under Definition's Renderer. It lists and invokes the agent tools through
`vscode.lm.invokeTool` (the projections, a comparison, and opening a tab pinned
to two revisions with an entity selected), and previews a write (`set_part`)
whose confirmation shows the diff and writes only once approved. It runs **New
Projection…** as a person would: from a built-in extractor (Workspace
dependencies), a renderer that fits it (its default first, none that doesn't
present `graph/v0`), an ID the repository has refused in place, then a new ID
and title; `projections init` writes the definition with that extractor and
renderer, and its definition and tab open with its row selected. Before any
panel opens, it checks the Testing view: the **Projections** controller lists
the projection with its checks, and the demo repository's comparator tests
(`tools/first.comparator.test.yaml`, used by no projection) at their lines;
running them reports one pass and one failure at the line of the expectation
that failed, and running the projection reports its checks. It drives the
Inspector as on a desktop: on a GitHub-hosted Windows runner, whose display is
1024×768 with animations off, `test/smoke/run.mjs` first sets a 1920×1080
display and turns animations on. `scripts/screenshots/capture-themes.mjs`
records the `--vscode-*` variables real VS Code injects for several color themes
(`packages/host/vscode-ui/fixtures/themes/`), and
`scripts/screenshots/screenshots.mjs` takes the Inspector with the VS Code UI in
VS Code's dark, light and high contrast themes and compares each with the
fixtures' screenshots (`docs/design/images/desktop-surfaces/vscode-*.png`) and
the Explore view after checking recent commits (`vscode-explore-dark.png`).
`scripts/screenshots/jobs-screenshots.mjs` takes the four sections in a 300 px
side bar beside a projection tab in Dark and Light Modern
(`sidebar-four-sections-*.png`, `jobs-tab-*.png`), the sections collapsed with
their static titles (`sidebar-collapsed-dark.png`), the Testing view after a run
(`testing-view-dark.png`), a comparator test file's gutter
(`comparator-test-gutter-dark.png`), side by side
(`vscode-side-by-side-after.png`), a tab loading (`vscode-loading-after.png`)
and, after an edit, the out-of-date notice (`jobs-out-of-date-dark.png`), and
after the definition is edited, D4's notice (`jobs-edited-dark.png`).
`scripts/screenshots/status-bar-screenshots.mjs` takes the status bar item on
several choices (`status-bar-choices-dark.png`), its tooltip
(`status-bar-tooltip-dark.png`) and the Viewing quick pick its click opens
(`status-bar-quick-pick-dark.png`), setting choices with keybindings, whose
`args` give **projections.setChoice** a choice for the folder in front.
`scripts/screenshots/new-projection-screenshots.mjs`
(`npm run screenshots:new-projection`) takes New Projection…'s first pick from
the Projections title bar, the renderers that fit a built-in extractor and the
window once it is written, in Dark and Light Modern (`new-projection-*.png`).
`scripts/icon.mjs` renders `media/icon.png` from the brand's app icon.

### Manual test script

1. Build as above, then open this folder in VS Code and run **Run Extension**
   (or `code --extensionDevelopmentPath=$PWD <repository>`), with a repository
   that has projections (for example one made by
   `node test/smoke/demo-repo.mjs ../../cli/dist/projections`).
2. Run **Projections: Open Inspector**. The Inspector opens beside the editor,
   lists the projections and extracts the default revisions; the graph renderer
   draws the comparison.
3. Switch the color theme (light, dark, high contrast): the Inspector follows;
   the accent follows `focusBorder`.
4. Select a node, open its evidence in the Details panel: the file opens at its
   line. Open Parts → Save to definition…: the definition path opens the file.
   In the side bar, the Definition view follows the projection tab in front; its
   definition file row opens the file, and its Renderer row (a built-in) opens
   the renderer's documentation in the Markdown preview, inside VS Code; follow
   a link in it to another bundled page. The row's **Open Documentation on
   GitHub** (on hover) is the one way to the browser. Pin it: its message names
   the projection. The status bar item names the Viewing choice; click it, pick
   another choice: the Viewing row's check and the item follow.
5. `⌘K` → **Reveal After in source control**: the Source Control view shows and
   the commit is offered for copying.
6. In a Restricted Mode window, a projection with a repository extractor says it
   needs trust; trust the workspace: the backend restarts with `--trust` and
   extracts.
7. Run **Projections: Compare Branch With Default** on a feature branch: it
   compares the merge base → `HEAD`.
8. Run **Projections: Explore Repository**, check recent commits, and open a
   cell: the Inspector opens on that candidate and change.
9. Run **Projections: Adopt…**, pick a candidate: the diff editor shows the
   definition; confirm to write it.
10. Click **New Projection…** (`+`) in the Projections view's title: start from
    a built-in extractor and renderer, try an ID that exists (refused in place),
    then name it. The definition and its tab open and its row is selected. Try
    **Ask an agent to write it**: the chat opens in agent mode with the prompt
    filled in.
11. Open `.github/projections/<id>.json` and break a field: the Problems view
    reports it, also offline.
12. Close the panel: the backend process exits (`ps` shows no
    `projections serve`).
