# Proposal: view history

Status: **proposal**. Nothing here is implemented. It records how a projection
view could gain back and forward, and what that asks of hosts and renderers.

A projection view is no longer a fixed picture. Clicking a collapsed module in
the architecture renderer expands it and lays the graph out again; selecting a
component a collapsed module hides does the same; the summary bar filters; the
agent opens another pair. Once a view has state a person moves through, they
expect to go back.

## The problem

- **Exploring an architecture.** A person expands _payments_, then _ledger_,
  zooms into a link between them, then wants the overview again. Today they must
  find each module's collapse card and zoom out by hand.
- **The agent moves the view.** The person is reading a change in _auth_ when
  the agent calls `open_projection` with an entity in _billing_; the boundary
  opens and the selection jumps. Nothing returns them to what they were reading.
- **Filters.** They click "2 breaking changes" in the summary bar, select one,
  clear the filter, and lose the item they were on.
- **Live updates.** Saving a file re-extracts, and the architecture renderer
  resets its expansion whenever the document changes
  (`packages/renderers/graph/src/architecture/view.tsx`), so every save
  collapses what the person opened.
- **The agent and the person see different things.** `screenshot` defaults to
  the current view's pair, mode and playback, but not to what the renderer
  expanded or where it is zoomed. The agent describes a picture the person isn't
  looking at.
- **Reloads.** A VS Code tab restores its mode, selection and "changes only"
  (`packages/integrations/vscode/src/webview/tab-state.ts`), but not expansion
  or zoom; the viewer restores only what its server holds.

The last three need no back button at all: they need the view to be **state the
host can capture and restore**. History is the most visible use of that, not the
only one.

## State taxonomy

Four classes. Only the first creates entries; the first two are captured in
every entry and every link.

<!-- prettier-ignore -->
| Class | Meaning | Host-owned | Renderer-owned |
|---|---|---|---|
| **History** | A deliberate move to another place; pushes an entry | Projection, pair (`choice` or before/after), scenario, definition revision; comparison mode; renderer, table or text view; the item filter (summary figure, changes only, varied only, regenerated only); a selection made from outside the drawing | Expanding or collapsing, drilling in; a selection that had to reveal its item |
| **Restorable** | Part of the view, recorded in the current entry, never an entry of its own | Selection of a visible item and its property path; find text; renderer control values; chosen renderer; swipe position | Viewport (zoom, pan, scroll) per pane; folds a person opened |
| **Preference** | How this person likes to look at any view | Highlighting, speed, loop, holds, connector, theme | None |
| **Ephemeral** | Never kept | Hover, anchors, playing, playback position, loading and errors | Focus ring, tooltips, a drag in progress, measured sizes |

By renderer, today:

<!-- prettier-ignore -->
| Renderer | History | Restorable | Ephemeral |
|---|---|---|---|
| `graph` architecture | Expanded boundaries (`expanded`) | Zoom and pan; **Every component**, **Relationships** | Hover, tooltips |
| `graph` dependencies | Expanded transitive summaries | Zoom and pan; transitive and paths controls | Hover |
| `graph` infrastructure | None | Zoom and pan | Hover |
| `text-diff` | None | Opened folds of unchanged lines; scroll | `narrow` (derived from width) |
| `file-packing` | None | Zoom and scroll | `focused`, `pointed` (tooltips) |
| `api`, `database`, `code-statistics`, `dependency-injection`, `runtime-policy` | None | Scroll | Measured sizes |

Two refinements of the coordinator's sketch:

- **Not every selection is history.** Clicking cards that are already in view
  would make Back an undo of clicks. A selection pushes only when it comes from
  outside the drawing (table, detail card, summary fact, agent) or the renderer
  had to reveal its item; otherwise it replaces the current entry's selection.
- **Pan and zoom must come from the renderer.** The host sees only scroll
  offsets in CSS pixels (`viewport`), not zoom, and pixels don't survive a
  resize. The viewport is therefore part of the renderer's state, in units the
  renderer chooses (the kit: a multiple of the fitted scale and a centre in
  content units).

## Ownership and protocol

The **host** owns the entry and the stack. It captures its own part directly
from the controller and stores the renderer's part without understanding it. The
**embedder** (viewer, VS Code tab) owns the location (projection, pair,
scenario), which the controller doesn't know, and binds the stack to its
surface. The **renderer** owns the meaning of its own part.

```ts
// @githubnext/projections-host
interface ViewLocation {
  projection: string
  choice?: string // 'branch', 'uncommitted', 'bookmark:<id>'…
  before?: string // full commit IDs, when no choice names the pair
  after?: string
  scenario?: string
  definitionRevision?: string
}
interface ProjectionView {
  mode?: ComparisonMode
  showAs?: 'renderer' | 'table' | 'text'
  filter?: 'changes' | 'varied' | 'regenerated' | {summary: SummaryFilter}
  search?: string
  selection?: ProjectionTarget // identity on a side, never a row ID
  renderer?: {
    name: string
    controls?: {[id: string]: ControlValue}
    state?: {version: number; shared?: Json; viewports?: Partial<Record<PaneKey, Json>>}
  }
}
interface HistoryEntry {
  location: ViewLocation
  view: ProjectionView
  origin: 'person' | 'agent' | 'link' | 'mirror'
}
controller.view(): ProjectionView
controller.applyView(view: ProjectionView): ViewRestoration // what couldn't be restored, and why
controller.onViewChange: (change: {push: boolean}) => void
```

Selection is stored as a target because selection IDs are comparison row IDs: a
change's ID differs between pairs, while a target names the item itself.

**The renderer messages**, all additive:

```ts
// host → renderer, in init: present only when the host keeps view state
init.view?: {restore?: RendererViewState}
// renderer → host: the person changed the view
{type: 'viewState', state: RendererViewState, navigate: boolean}
// host → renderer: apply a state (history, a link, the other pane, a re-extraction)
{type: 'viewState', state: RendererViewState}

interface RendererViewState {
  version: number // the renderer's own format; it drops versions it can't read
  shared?: Json   // the same in every pane of the document: expanded boundaries
  viewport?: Json // this pane only: zoom and centre
}
```

`navigate: true` asks for a push (an expansion); `false` replaces the current
entry (a pan). The host decides, by the rules below.

**Why not a capability flag.** `ready` is validated strictly: an unknown
capability refuses the whole message, so a renderer declaring `viewState` would
fail in every older host. Instead the host advertises support in `init`, whose
unknown fields renderers already pass through, and a renderer sends `viewState`
only when it saw `init.view`. An older host drops the unknown message type. The
same strictness rules out adding a `history` field to control declarations.

**Security.** View state is untrusted in both directions: a renderer may be
hostile, and a link may be crafted.

- The host accepts only plain JSON (null, booleans, finite numbers, strings,
  arrays, plain objects), at most 16 levels deep and `rendererLimits.viewState`
  (4 KiB) as serialized JSON, within the existing 64 KiB and 240 per second
  limits. It re-serializes what it stores, so no structured-clone type (a `Map`,
  an `ArrayBuffer`) survives.
- It never interprets, draws or logs the contents, and gives a state back only
  to a renderer of the same name. A state of another renderer, or one the
  renderer refuses, is dropped and the host part restored alone.
- Renderers validate what they restore; the kit's
  `useViewState({version, parse})` makes a parser mandatory and drops IDs the
  document doesn't have.
- No code, ever: no expressions, URLs or markup in either part.
- A renderer can encode what it was shown into a link the person later shares.
  The cap bounds that; links are only shared deliberately; and a renderer
  already has the document. This is no new exposure, but the contract says so.

## Semantics

**Push or replace.**

- Push: a history-class change; a renderer `viewState` with `navigate: true`.
- Replace: a restorable change (selection of a visible item, find text,
  controls, viewport), which updates the current entry in place, so Back returns
  to an entry as it was last seen, as browsers restore scroll.
- **One action is one entry.** A push opens a transaction that closes at the
  pane's next `rendered` or after 500 ms. Within it, further changes replace.
  The host's selection of a hidden component and the renderer's expansion in
  response are one entry.
- A change that leaves the entry equal to the current one is no change. Pushing
  truncates the forward stack. The stack keeps 100 entries per page.
- Applying an entry creates none: reports during the restore's transaction
  replace.

**When the world moved under an entry.** Entries keep what was asked (`choice`,
not its resolved commits), so going back to "Branch changes" shows the branch as
it is now. A live re-extraction is never an entry: the host sends the current
view in the new `init`, which also fixes the reset-on-save scenario. Restoring
resolves the selection's target (`resolveTarget`); an item that no longer exists
leaves nothing selected, with a quiet notice ("_ledger_ isn't in this
comparison"). Renderers ignore IDs they don't have. A renderer switch or a
version the renderer can't read drops the renderer part only.

**Playback and panes.** Playback position isn't history, and navigating neither
starts nor stops playback. A restore applies at the current progress, without
animating the change; mode changes keep resetting position as today. The
`shared` part is mirrored to every pane of the document (in side by side,
expanding in Before expands in After too, which today it doesn't). `viewport` is
per pane and stored per `PaneKey`; swipe keeps mirroring scroll. Switching mode
carries `shared` over; a pane with no recorded viewport opens as the renderer
would.

**The agent.** An agent action that changes the view (`open_projection`, a
selection) pushes an entry with `origin: 'agent'`, so Back returns the person to
what they were reading. `refresh` doesn't. In the viewer, several pages mirror
one server state; each page keeps its own stack, and another page's change
arrives as a `mirror` entry. A page ignores the echo of its own report.
`current_view` gains `view` (the link below) and `history {back, forward}` (the
counts). The agent opens a precise view with `open_projection {view}`; it gets
no tool to move through the person's history (open question 2).

## Surfaces

The Default UI draws Back and Forward at the left of the toolbar, before the
mode switch, behind a `history` feature flag that is off for embedders and on in
the viewer and VS Code. The Inspector, which is being retired, gets nothing.

- **Viewer in a browser:** `history.pushState` per entry, with the entry in
  `history.state` and the link in the fragment. Browsers then supply Back,
  Forward, Alt+←/→, ⌘[ and ⌘] and mouse buttons 4 and 5, even while focus is in
  a renderer frame. Reload restores the entry. Pressing Back can change the pair
  the agent last showed; the page reports it like any other change.
- **Copilot canvas:** the page is framed, and `pushState` in a frame joins the
  app's own session history. So in the canvas (which its adapter would mark in
  the page's URL) the page keeps the stack itself, writes only `replaceState`
  (for reload), and handles the shortcuts itself.
- **VS Code tab:** a stack in webview state (`vscode.setState`), so it survives
  hiding and window reloads. The page handles the shortcuts while it has focus;
  `Projections: Go Back` and `Go Forward` commands carry the same keybindings
  when the tab is active. VS Code's own Go Back keeps navigating editors.
- **Focus inside a renderer frame.** In the canvas and VS Code, key and mouse
  events in the sandboxed frame never reach the host. The kit forwards the four
  chords and buttons 4 and 5 as an additive `navigate {direction}` message.
- **Static images:** `projections snapshot --view LINK` and the `screenshot`
  tool's `view` input (defaulting to the current view, renderer part included)
  pass the state in `init.view.restore`. The capture waits for `rendered` as
  today.

## Links

A **view link** is the portable form of an entry: a versioned query string that
never contains the viewer's port or session token.

```
v=1&projection=architecture&choice=branch&mode=diff
  &select=after.entity.payments%2Fledger&filter=changes&search=ledger
  &renderer=graph&state=<base64url JSON>
```

- In the viewer it is the URL fragment, which no server and no log sees. The
  page URL itself is never shareable: its port and token change every run.
- Elsewhere it is an argument: `projections view show --view`,
  `open_projection {view}`, `snapshot --view`, and later a VS Code URI.
- **Stability:** unknown keys are ignored; IDs are extraction IDs, which by
  contract never contain versions or positions; commits are full IDs; a `choice`
  resolves when opened, and explicit `before`/`after` pin the pair; the renderer
  part carries its own `version`.
- `v` changes only when a key changes meaning, never to add one.

## Rollout

1. **Host only.** `controller.view()` and `applyView`, the stack and its rules,
   the toolbar buttons, the viewer's browser history and the VS Code tab.
   Entries hold the location and the host part. This already gives Back for
   pairs, mode, filters and agent moves, and `current_view` gains `view`.
2. **The renderer protocol.** `init.view` and the two `viewState` messages, the
   SDK's validation and `rendererLimits.viewState`, and the kit's
   `useViewState`. `useStageZoom` reports the viewport, so every kit stage
   renderer restores zoom at once. The `graph` architecture and dependencies
   views adopt first: they motivated this, and their expansion state is a set of
   entity IDs. Then `text-diff` folds.
3. **Links everywhere.** `open_projection {view}`, `view show --view`,
   `snapshot --view`, `screenshot` with the renderer part, then saved views.

Each phase updates the
[renderer frame contract](../../contracts/renderer-frames.md) and the
[agent viewer](../agent-viewer.md) record.

## Alternatives considered

- **Host-controlled expansion through controls.** A renderer could declare
  "expanded boundaries" as a control and the host would own it. Controls are
  settings drawn in the host's chrome, capped at 32 with 50 choices, and their
  declarations are strict; expansion is per item, in the drawing, and named by
  the renderer's own synthetic IDs. A new "set of IDs" control would be a
  narrower `viewState` with the host pretending to understand it. Rejected.
- **The renderer keeps its own stack.** Two stacks interleave wrongly (a mode
  switch, then an expansion: which does Back undo?); side by side would have
  two; a sandboxed frame can't reach browser history or the toolbar. Rejected.
- **Replaying events instead of storing state.** Re-sending the selections that
  led to a view is fragile across re-extraction and invisible for internal
  clicks. Rejected.
- **Browser history only.** No stack model, just `pushState`. It doesn't work in
  VS Code or the canvas, and the agent can't read it. Kept only as a binding.
- **A server-owned stack in the viewer**, shared by every page, which the agent
  could move through. Simpler mirroring, but it fights each tab's browser
  history. Deferred (open question 2).
- **Undo and redo.** The viewer edits nothing; Back and Forward are the right
  words for moving between views.

## Open questions

1. **Is selecting a visible item an entry?** Recommendation: no; it replaces.
   Only a selection from outside the drawing, or one that reveals its item,
   pushes.
2. **May the agent move through the person's history**, or only read the current
   link and open views? Recommendation: read and open only for now; reconsider
   with a server-owned stack.
3. **May Back change the pair in the viewer**, where only the agent chooses
   pairs today? Recommendation: yes. It returns to something the agent already
   showed, and `current_view` reports it.
4. **Are renderer controls history?** "Every component" is a bulk expansion.
   Recommendation: restorable only for now; marking a control as history needs a
   declaration field, which older hosts would refuse, so it waits for a protocol
   version.
5. **Should a link open the pair as it was, or as it is?** Recommendation: a
   `choice` resolves when opened; saved views write explicit commits. A link
   whose explicit commits no longer exist says so and opens nothing.
6. **Should the viewport be typed in the protocol** rather than opaque, so hosts
   could mirror zoom across panes or describe it to the agent? Recommendation:
   opaque now, with the kit's shape as a convention; promote it if a second
   renderer family needs the same shape.
