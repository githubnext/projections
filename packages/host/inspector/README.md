---
description: The mountable Inspector UI for developing projections
---

# Inspector

The Inspector is the mountable UI for developing projections: their extractors,
renderers and comparators, alone or together. It presents results with
`@githubnext/projections-host`. It has no page of its own: the VS Code extension
(`packages/integrations/vscode/`) mounts it in a webview over
`projections serve --stdio`, the CLI mounts it in headless pages for `--png` and
`check`, and the browser suite mounts it in a test harness (see
[Integration boundary](#integration-boundary)). It is not a hosted application
or an authentication provider.

In a repository the Inspector works on **two independent axes**:

1. **The projection** (what you are developing): a combination of three
   independent parts, an **extractor** (turns a revision into entities and
   relationships), a **comparator** (orders a comparison's changes) and a
   **renderer** (presents an extraction or comparison), named by its definition.
   All of them always come from the **working tree**. Saving any part of it
   replays the comparison: a definition or extractor change (`GET /api/changes`)
   extracts **both** sides again, a renderer change reloads the renderer (or,
   while its package runs `npm run dev`, updates in place from the development
   server) and a comparator change recomputes the comparison. The previous
   extractions stay shown while the next ones run. A save is read once its files
   have been quiet for 120 ms, so an editor that saves in chunks never replays a
   half-written definition, and a definition that doesn't parse yet is replayed
   again on the next save.
2. **The data** (what you test it against): a **Before → After** pair of
   revisions, any branch, tag, commit SHA or the working tree, so a projection
   is tried against real history rather than only `HEAD` against the dirty tree.
   It opens on `HEAD~1 → HEAD` (with one commit, `HEAD → Working tree` when the
   tree has changes), or on the pair last used for this projection in this
   repository (remembered in this browser). **Show one revision** replaces the
   pair with one revision. A change to the working tree's files extracts the
   working-tree side again; a commit or checkout, the pair's symbolic refs
   (`HEAD`, `HEAD~1`, a branch).

When one side fails to extract (an old commit's layout the extractor doesn't
handle yet), the main view says which side and ref failed, with each
diagnostic's code, path and message, the end of the extractor's stderr and a
link to the Diagnostics panel, and shows the other side alone meanwhile; saving
a fix extracts both again. A repository that defines no projections yet shows
the built-in defaults beneath a card with `projections init <id>` and a prompt
for a coding agent, both copyable; the first projection it defines then replaces
them. Until it is dismissed (remembered per repository), a one-line tip under
the title bar names the loop: edit and save, and choose Before → After.

It is a full-window workbench, like an editor, that gives the content being
developed as much room as possible. Its parts are rounded **cards on a gutter**:
the Explorer, the docked Details panel, the bottom panel and the view share one
radius, border and surface and float one 8 px gutter apart, between the title
bar and the status bar, which sit on the gutter. Inside its card the view is
flat, as everywhere: its toolbar and summary bar are bands and its stage runs
edge to edge. Resize handles lie in the gutters and show a line on hover.

- **Title bar** (40 px): a toolbar (Radix Toolbar: one Tab stop, arrow keys
  between items) of three columns.
  - On the left, the Explorer toggle and a quiet **Projections Inspector** mark.
  - In the centre, the **projection switcher**, the document title: the current
    projection's title and a chevron ("Checkout architecture ▾"), centred in the
    window. Switching is not the common flow (you stay on one projection to
    iterate on it), so it is out of the way but always says what you are working
    on. Other projections' failures stay in sight: the trigger counts them
    beside an alert icon ("1 failing"; its name and tooltip say which). A click,
    Enter, Space, Arrow Down or ⌘P / Ctrl+P opens it: a combobox that filters
    every projection by title or ID as you type, over a listbox of them with
    their IDs (mono) and a status dot that is an icon with words, never color
    alone (**OK**, **Failed**, **Needs trust**, **Extracting**), the current one
    checked. Arrow keys move (and wrap), Enter switches, Escape closes and focus
    returns. Switching keeps the **Before → After** pair, and the projection is
    remembered for the repository. On a phone the list is a sheet under the
    title bar.
  - On the right, the **status line**, **Open** (a saved artifact), **Settings**
    (a gear that opens a menu of app preferences: the **Theme**, System, Light
    or Dark, and under **Advanced**, **Definition from**), **Commands** (the
    palette) and the panel and Details toggles. The status line says in plain
    words what is shown and what just happened, for example "`v1.0` → `v2.0` ·
    replayed 3 s ago after `extract.py` changed", "Extracting `HEAD~1`
    (before)…", "Before (`HEAD~1`) failed to extract · see Diagnostics" or
    "Showing a saved artifact"; refs and files are in the mono font. It is a
    polite live region whose ticking relative time is hidden from assistive
    technology (which reads the clock time), and its whole text is its tooltip.

  Like the view's toolbar the bar is planned from its own width, never wrapped
  or clipped, and each side keeps room for the wider side, so the switcher stays
  centred: as it narrows, Commands keeps only its shortcut, Open becomes an
  icon, the mark hides, the status line is visually hidden (it stays a live
  region), and finally Open, Commands and the panel and Details toggles move
  into **More actions**. The switcher's title truncates last, with its whole
  title as a tooltip; the Settings gear stays in the bar.

- **Explorer** (the left card: resizable, collapsible with ⌘B, its width,
  visibility and collapsed sections remembered; open by default, and a sheet
  over the view below 1012 px): a `nav` landmark of collapsible sections (a
  registry other sections can join) for the **current projection** only (the
  title bar names it). Section labels sit on the card on one text column, with
  sections apart by spacing and an inset rule.
  - **Parts**: the projection's **Definition** file and its three parts as
    labelled selectors, **Extractor**, **Comparator** and **Renderer**, each
    with its origin (built-in, a file in mono, or the dev server) and status
    (for example "OK" or "Dev server live"): the definition's own part, or for
    this session another one, so you can see that each is independent. The
    extractor can be another projection's or a built-in one (extracting both
    sides again); the comparator the default one with its ordering (by
    dependents or a `data.*` field, inline), another projection's comparator
    file or any comparator file (`*.comparator.yaml`) in the repository
    (comparing again in the browser, without extracting); the renderer a
    built-in renderer or another projection's custom one (rendering again).
    Renderers that can't present the extractor's schema are listed but disabled
    with the reason ("Expects `database/v0`; this extractor emits
    `architecture/v0`"). The definition file stays the source of truth: a
    changed part is marked **changed from definition** with **Reset**, and
    **Save to definition…** shows the definition file's diff and copies its JSON
    (the Inspector API can't write files). Trust applies to an override's
    repository code as to the definition's. ⌘K has the same choices ("Use
    renderer: …", "Use extractor: …", "Use comparator: …"). Choosing the
    definition's or a part's name shows the Diagnostics panel.
  - **Compare**: **Show one revision**, then the **Before** and **After** fields
    (type a branch, tag, commit SHA or "Working tree" and press Enter; the
    Inspector API checks the ref first) with **Swap** between them; **Pairs**
    (the default pair, `HEAD → Working tree` and recently used pairs);
    **Renderer scenarios** from a custom renderer package's `scenarios.json`
    (they need no extraction; **Back to** returns to the pair); and **History**:
    the working tree, `HEAD`, the pair's and added refs and recent commits, plus
    **+ any ref**. Each History row can be extracted inline (status, time and
    error) and set as **Before** or **After**, showing which it is; the fields
    and the rows are the same pair.

  In fixtures mode the Explorer has **Scenarios** and **Checks**, and the title
  bar's centre names the scenario; for a saved artifact, its revisions to
  compare, and the switcher lists the artifact's projections.

- **Main view**: the projection view (renderer, table and text) fills the rest.
  Selecting an item draws no detail card over it: the Details panel shows it.
- **Details** (the right card, like an editor's secondary side bar: toggled from
  the title bar and with ⌥⌘B / Ctrl+Alt+B, resizable, its visibility and width
  remembered; closed by default, and a sheet over the view below 1012 px): the
  raw details of the selection for authors, the host's `RawDetails` block: its
  identity, kind and change, and each side's item with its confidence, all its
  `data` and its evidence. It stays open and follows the selection (Escape in it
  clears the selection).
- **Panel** (a card under the view: resizable, collapsible): Diagnostics (with a
  count), Raw output, Extraction, Changes and Provenance; Checks in fixtures
  mode. It opens on Diagnostics when an extraction outside the pair fails.
- **Status bar** (22 px): the presented pair, the comparator (its digest on
  hover), the last extraction time, the renderer protocol version and trust.

Below 1012 px the Explorer, the Details panel and the panel float over the view
as sheets with the same card look; collapsed, the stage takes the room.

Every extraction applies the definition from **Definition from** (Settings >
Advanced; the working tree by default), so they share a definition digest and
any two compare **in the browser** with the projection's comparator. Choosing
another revision there extracts both sides again with its definition;
extractions made with different definitions are refused with an explanation,
never mixed. Extractions run one at a time; queued ones wait, and **Cancel**
stops the running one. Execution authorization is fixed by the runner at
startup: started with `--trust` (in VS Code, a trusted workspace), the Inspector
runs the repository's projection code (and an override's) without asking again.
Without it, a projection whose extractor runs repository code shows the trust
step as the main view (a custom renderer that differs from the default branch's
is withheld too; the built-in renderer for its schema draws instead): what would
run (the extractor's command, in mono) and how to trust it; saved artifacts and
built-in extractors work without it. Browser payloads cannot grant trust.

### Keyboard

<!-- prettier-ignore -->
| Shortcut | Action |
|---|---|
| ⌘K / Ctrl+K | Command palette: extract, choose a pair or a renderer scenario, show one revision, swap, switch projection, definition from, panel views, open an artifact, theme |
| ⌘P / Ctrl+P | Open the projection switcher (type to filter, Enter switches) |
| ⌘B / Ctrl+B | Show or hide the Explorer |
| ⌥⌘B / Ctrl+Alt+B | Show or hide the Details panel |
| ⌘J / Ctrl+J | Show or hide the panel |
| ⌘E / Ctrl+E | Compare `HEAD → Working tree` (fixtures mode: run the checks) |
| ⌘I / Ctrl+I | Swap Before and After |
| ⌘O / Ctrl+O | Open a saved artifact |

In the palette and the switcher, arrow keys move, Enter runs and Escape closes;
panel tabs move with the arrow keys and splitters resize with them.

## Integration boundary

`InspectorApp({api?, engine, loadArtifact, initialDocument?, renderers?, runComparator?, customRendererBase?, onOpen?, handleRef?})`
is an injectable React UI. `InspectorApi` and its wire types are exported from
the package root. Import the host and Inspector stylesheets in a custom host.

Hosts (an editor webview, a headless page, a test harness) embed the whole
Inspector with the mountable bundle the client build emits, `mount.js` and
`mount.css` (types from `@githubnext/projections-inspector/mount`):

```js
import {mountInspector, createMessageTransport} from './mount.js'
const inspector = mountInspector(element, {transport, host, assets, view, initial, viewLinksInPlace})
const handle = await inspector.handle() // selectProjection, setPair, selectEntity, summary
```

- **Transport** (`InspectorTransport`): every runner call is a
  `request({method, path, body?, signal?})` to an `/api/` path, plus an optional
  `next(channel, since)` change subscription (otherwise `/api/changes` is
  long-polled through `request`).
  `createMessageTransport({post, listen, subscriptions?})` carries the requests
  over `postMessage` to a bridge (the VS Code extension's relays them to
  `projections serve --stdio` as JSON-RPC), so the embedded UI needs no network
  access; bridges validate requests with `parseTransportMessage` (`/api/` paths
  only). Any `{origin, request}` object is a transport too: the CLI's headless
  pages and the browser harness use a same-origin `fetch` whose requests their
  host answers in-process. There is no HTTP transport or startup token any more.
- **Opening** (`view`, `initial`, `viewLinksInPlace`): `view` is `explore`,
  `inspect`, `snapshot` or `stage`; `initial` (`{projection, before, after}`)
  opens on a projection and pair (an explore candidate is listed through
  `including`); `viewLinksInPlace` follows the pages' own `?view=` links (with
  their projection and pair) without navigation, for hosts that can't navigate.
- **Host** (`InspectorHost`): optional `openFile(path, line?, column?)`
  (evidence and part source paths), `revealInScm(ref)` (command palette, for the
  shown pair), `copyText(text)`, `openExternal(url)` (cross-origin `http(s)`
  links) and `theme` (`{get, subscribe}` of `{colorMode, accent?}`; the System
  theme choice follows it, and the accent recolors focus, selection and
  playback). Without a capability the Inspector behaves as a plain browser page.
- **Assets** (`InspectorAssets`): the engine and comparator Workers and Wasm
  modules and the built-in renderer bundles; `webAssets(base)` is the build's
  layout. A host whose document can't start Workers from its resource URLs (a VS
  Code webview) passes Blob URLs and Wasm bytes.

`docs/design/desktop-surfaces.md` describes the hosts built on this seam.

The runner is the Inspector service built into the CLI
(`packages/cli/src/service/`), reached over `projections serve --stdio`
([Stdio backend](../../../docs/runner/stdio-backend.md)); the request paths it
answers:

<!-- prettier-ignore -->
| Route | Use |
|---|---|
| `GET /api/definitions?ref=` | Definitions at a revision, the full `commit` it names (custom renderer URLs use it) and whether execution is authorized; for the working tree, a custom renderer's running development server, and `setup` (the `init` command and agent prompt) when it defines no projections |
| `GET /api/changes?since=N` | Long-polls the working tree's generation and names what changed (repository mode) |
| `GET /api/pairs?projection=` | Bookmarks, tags, branches, the merge base and the suggested Before → After pairs, with the default a projection opens on (repository mode) |
| `POST /api/definition` | Previews (`dryRun`) or saves parts to the working tree's definition file; saving needs the preview's `digest` and `--trust` (repository mode) |
| `GET /api/scenarios?projection=` | A custom renderer package's `scenarios.json` as extraction documents of the working tree's definition, for the **Scenario** picker (repository mode) |
| `GET /api/revisions[?limit=N≤100]` | `{revisions:[{ref,commit,title,kind?,dirty?,date?}]}`, working tree first |
| `POST /api/jobs` | `{projectionId, before, definitionRevision?}` extracts one revision (`job.extraction`); with `after` (and `definition: "base"\|"head"`) compares two (`job.comparison`) |
| `GET /api/jobs/:id`, `POST /api/jobs/:id/cancel` | Poll and cancel |
| `GET /api/comparator?projection=&ref=` | `{default:true}` or `{rules:"<base64>", digest:"sha256:<hex>"}`; requested only for custom comparators. `?rules=<path>&ref=` returns any comparator file the same way |
| `GET /api/renderers` | Optional `{renderers:[…], customRendererBase?}`; a 404 is tolerated |
| `GET /api/document` | A CLI-supplied document (`serve --stdio --document FILE`, `--png`) |
| `GET /api/fixtures`, `GET /api/fixtures/changes?since=` | Fixtures mode: scenarios, extractions and renderer bundles; a long poll for live reload |

Comparator rules run in the rules interpreter (`./comparator/rules.wasm`) in the
comparator runtime's dedicated Worker (`./comparator/worker-entry.js`); their
digest is checked against the supplied one and their output is validated by the
engine against both extractions. If the runner cannot supply the rules, the pair
shows an explicit failure. Built-in renderer bundles are read from
`./renderers/index.json` and run in sandboxed frames; a host must serve
`./renderers/**` with the renderer content security policy
(`rendererResponseHeaders` from `@githubnext/projections-host/build`) and must
not forbid framing them. A custom renderer bundle, declared by a definition's
`renderer: {bundle}`, is loaded from
`${customRendererBase}<projection>/index.html?ref=<definition revision>` when
the runner provides that base; otherwise the host says so and shows its table
view. A renderer that fails is reported and the table and text views stay
usable.

## Snapshot page

`?view=snapshot` is the chrome-free view `--png` (on `show`, `compare` and
`check`) captures in a headless browser (`src/snapshot/`), mounted by the CLI's
headless page. It presents the served document through the host's
`ProjectionStage`, its legend and the Default UI's `SummaryBar` below it (totals
per kind, and a comparison's changes, in the renderer's words, which the page
waits for) at the theme, comparison mode and progress the query names, in the
frame it names (`src/snapshot/frames.tsx`): by default (`frame=card`) one
rounded card with a hairline edge holding stage, legend and summary bar, divided
by hairlines, on no page background (or the `matte` colour) so the capture is
transparent outside its corners; `frame=none` the stage alone, edge to edge;
`frame=page` the Inspector's look, the stage edge to edge with the legend and
the summary bar as bands below it, for sweep thumbnails. It validates the
document with the shared engine first, and presents the CLI's comparison rather
than computing one. When every pane has acknowledged painting what was asked and
fonts are loaded it sets `<html data-projections-snapshot="ready">`; a renderer
that is missing, stops, reports an error or lacks the requested mode sets
`"failed"` and `data-projections-snapshot-error` instead.

## Offline artifacts

**Open** loads a saved extraction or comparison into the Explorer, beside any
live extractions; in VS Code, **Projections: Open Artifact…** starts with one
(`serve --stdio --document`) and runs nothing. Opening a saved file uses
`@githubnext/projections-engine/artifacts` with the shared Wasm Worker: strict
raw JSON, structural validation, provenance, semantic digests and supplied
comparison claims are checked. A saved extraction is shown on its own; a saved
comparison becomes a preselected before/after pair that the browser compares
again. Saved artifacts carry no comparator files, so offline comparisons of
projections with a custom comparator report that they are unavailable. No
extractor code is executed. Files are bounded by the shared 32 MiB artifact
limit.

## Fixtures mode

`projections serve --stdio --fixtures <file-or-dir>... [--renderer <bundle>...]`
(in VS Code, **Projections: Open Renderer Scenarios…** on a renderer package)
opens the same workbench for developing renderers and comparators against
scenario fixtures (`projections.scenarios` documents). The Explorer lists the
scenarios by group; the main view presents the selected one in the real host
view with any comparison mode, a viewport preview (desktop, 820 px tablet, 390
px phone) and the theme (in Settings). Comparisons are computed in this browser
with the scenario's comparator, the default one with options or a comparator
file, so a comparator can be previewed with its steps in the Text view. The page
reloads data when a watched file changes (a scenario file, a fixture, a
comparator file or a renderer bundle); a changed bundle gets a new URL, so its
frame reloads.

The **Checks** panel runs the built-in renderer checks
(`@githubnext/projections-renderer-testing`) against the live renderer in a
frame of its own: neutral endpoints, no motion in step holds, per-step
highlighting scope, affordances inside their unit, a host-drawn legend, no
horizontal overflow at phone width and the selection round trip. They measure
the renderer document through a probe the runner injects only in fixtures mode.
`?view=stage` is a bare stage for tests (`window.projectionsStage`), which
`projections check` mounts in a headless page; see the testing package.

## Browser assets

Vite emits the engine Worker modules and Wasm under `dist/client/engine/`, the
comparator runtime Worker and the rules interpreter under
`dist/client/comparator/`, the check probe as `dist/client/fixtures/probe.js`
and the built-in renderer bundles plus `index.json` under
`dist/client/renderers/`, beside `mount.js` and `mount.css`; `webAssets(base)`
passes explicit URLs under that layout to each Worker factory. There is no
`index.html`. Production CSP must permit same-origin scripts, workers and frames
and `'wasm-unsafe-eval'`, not general `'unsafe-eval'`. Worker disposal is tied
to page teardown.

`npm run build -w @githubnext/projections-inspector` builds the UI library and
browser assets. The native CLI embeds `dist/client` (for its headless pages)
when it is built, so rebuild the CLI afterwards. The VS Code extension copies it
into its own `dist/inspector/`.

After building the public workspace and the CLI,
`npm run test:browser -w @githubnext/projections-inspector` mounts the
production bundle in a harness page (`browser/harness.ts`) over a real
`projections serve --stdio`, with every request to the page's origin answered by
Playwright routes (nothing listens), against real temporary Git histories and
Node extractors. It covers extracting revisions, A/B marks, definition
mismatches, renderer/table/text views, a renderer that never becomes ready,
panel views, failure evidence, cancellation, fixed startup authorization, the
workbench geometry (cards on a gutter, light and dark, desktop and phone), the
projection switcher, the docked Details panel, the keyboard and command palette,
saved artifacts and strict rejection of altered input; the Explore view with its
sweep, Adopt and Add to CI; and in fixtures mode, scenario loading, live reload,
a custom comparator preview and the checks catching a deliberately broken
renderer. Run it with `--project=chromium-desktop --workers=2` locally. No
private host, paid provider or user credential is required.
