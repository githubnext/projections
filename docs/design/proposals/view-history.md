# Proposal: view history

Status: **proposal**. Nothing here is implemented yet. This document describes
how a projection view could support Back and Forward navigation, and what that
requires from hosts and renderers.

Projection views are no longer static pictures. Clicking a collapsed module in
the architecture renderer expands it and re-runs the layout; selecting a hidden
component does the same; the summary bar filters what you see; an agent can
switch to a different commit pair. Once people navigate through states inside a
view, they naturally expect a way to go back.

## The problem

- **Exploring an architecture.** You expand _payments_, then _ledger_, zoom in
  on a link between them, and then want the overview back. Today you have to
  hunt down each module's collapse card and zoom out manually.
- **The agent moves the view.** You're inspecting a change in _auth_ when the
  agent calls `open_projection` for an entity in _billing_; the boundary opens
  and selection jumps, with no way to return to what you were reading.
- **Filters.** You click "2 breaking changes" in the summary bar, pick one,
  clear the filter, and lose your place.
- **Live updates.** Saving a file triggers a re-extraction, and the architecture
  renderer resets its expansion whenever the document changes
  (`packages/renderers/graph/src/architecture/view.tsx`), collapsing everything
  you just opened.
- **The agent and the user see different pictures.** `screenshot` defaults to
  the current view's pair, mode, and playback, but misses what the renderer
  expanded or where it's zoomed, so the agent ends up describing a different
  picture than the one on screen.
- **Reloads.** A VS Code tab restores mode, selection, and "changes only"
  (`packages/integrations/vscode/src/webview/tab-state.ts`), but drops expansion
  and zoom; the viewer restores only what its server tracks.

Those last three issues don't even need a back button — they need the view to be
**state the host can capture and restore**. History is just the most visible
payoff.

## State taxonomy

View state falls into four buckets. Only the first pushes history entries, while
the first two are captured in every entry and every link.

<!-- prettier-ignore -->
| Class | Meaning | Host-owned | Renderer-owned |
|---|---|---|---|
| **History** | A deliberate move to another place; pushes an entry | Projection, pair (`choice` or before/after), scenario, definition revision; comparison mode; renderer, table or text view; the item filter (summary figure, changes only, varied only, regenerated only); a selection made from outside the drawing | Expanding or collapsing, drilling in; a selection that had to reveal its item |
| **Restorable** | Part of the view, recorded in the current entry, never an entry of its own | Selection of a visible item and its property path; find text; renderer control values; chosen renderer; swipe position | Viewport (zoom, pan, scroll) per pane; folds a person opened |
| **Preference** | How this person likes to look at any view | Highlighting, speed, loop, holds, connector, theme | None |
| **Ephemeral** | Never kept | Hover, anchors, playing, playback position, loading and errors | Focus ring, tooltips, a drag in progress, measured sizes |

Here is how today's renderers map onto those buckets:

<!-- prettier-ignore -->
| Renderer | History | Restorable | Ephemeral |
|---|---|---|---|
| `graph` architecture | Expanded boundaries (`expanded`) | Zoom and pan; **Every component**, **Relationships** | Hover, tooltips |
| `graph` dependencies | Expanded transitive summaries | Zoom and pan; transitive and paths controls | Hover |
| `graph` infrastructure | None | Zoom and pan | Hover |
| `text-diff` | None | Opened folds of unchanged lines; scroll | `narrow` (derived from width) |
| `file-packing` | None | Zoom and scroll | `focused`, `pointed` (tooltips) |
| `api`, `database`, `code-statistics`, `dependency-injection`, `runtime-policy` | None | Scroll | Measured sizes |

Two refinements to the coordinator's original sketch:

- **Not every selection creates a history entry.** Pushing on every click of an
  already-visible card would turn Back into click-undo. A selection only pushes
  when it comes from outside the drawing (table, detail card, summary fact, or
  agent) or when the renderer had to reveal a hidden item; otherwise it simply
  updates the current entry in place.
- **Pan and zoom must come from the renderer.** The host only sees scroll
  offsets in CSS pixels (`viewport`), not zoom, and raw pixel offsets break on
  resize. Viewport state therefore lives with the renderer in its own units (for
  the kit, a multiple of the fitted scale plus a center in content units).

## Ownership and protocol

The **host** owns each entry and the history stack, reading its own state from
the controller and storing the renderer's state opaquely. The **embedder**
(viewer or VS Code tab) owns the location (projection, pair, scenario) that the
controller doesn't know about and wires the stack into its surface. The
**renderer** owns the meaning of its own state.

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

Selection is stored as a target rather than a comparison row ID because row IDs
change between pairs, whereas a target identifies the underlying item.

**The renderer messages** are all additive:

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

Passing `navigate: true` asks the host to push a new entry (such as an
expansion); `false` replaces the current entry (such as a pan). The host makes
the final call using the rules below.

**Why not a capability flag?** `ready` is validated strictly, so an unknown
capability rejects the entire message — a renderer declaring `viewState` would
break in every older host. Instead, the host advertises support via `init.view`
(renderers already ignore unknown `init` fields), and renderers only emit
`viewState` when they see `init.view`. Older hosts simply drop the unknown
message type. That same strictness rules out adding a `history` field to control
declarations.

**Security.** View state is untrusted in both directions — a renderer could be
hostile, and a shared link could be crafted:

- The host accepts only plain JSON (null, booleans, finite numbers, strings,
  arrays, and plain objects), at most 16 levels deep and within
  `rendererLimits.viewState` (4 KiB serialized), inside the existing 64 KiB and
  240 messages/sec caps. It re-serializes what it stores so structured-clone
  types like `Map` or `ArrayBuffer` never survive.
- The host never interprets, renders, or logs the payload, and only hands a
  state back to a renderer with the same name. State from a different renderer —
  or state the renderer rejects — is dropped while the host part still restores.
- Renderers validate whatever they restore. The kit's
  `useViewState({version, parse})` requires a parser and drops any IDs missing
  from the current document.
- No code, ever: neither part may contain expressions, URLs, or markup.
- A renderer could encode parts of what it was shown into a link the user later
  shares. The 4 KiB cap bounds that, links are only shared intentionally, and
  the renderer already has the document — so this adds no new exposure, though
  the contract should note it explicitly.

## Semantics

**Push vs. replace.**

- **Push** happens on a history-class change or a renderer `viewState` with
  `navigate: true`.
- **Replace** happens on a restorable change (selecting a visible item, find
  text, controls, viewport), updating the current entry in place so Back returns
  to how you last left it — just like a browser restoring scroll position.
- **One action is one entry.** A push opens a transaction that closes at the
  pane's next `rendered` event or after 500 ms; further changes inside that
  window replace instead of pushing. That way, selecting a hidden component and
  the renderer expanding its parent boundary become a single entry.
- A change that produces an entry identical to the current one is a no-op.
  Pushing truncates the forward stack, and each page keeps up to 100 entries.
- Restoring an entry never pushes a new one: reports emitted during the restore
  transaction replace in place.

**When the underlying world moves.** Entries store what was requested (`choice`,
not its resolved commits), so going back to "Branch changes" shows the branch as
it stands now. Live re-extraction never creates an entry — the host sends the
current view in the new `init`, which also fixes the collapse-on-save bug.
Restoring resolves the selection target via `resolveTarget`: if the item no
longer exists, nothing is selected and a quiet notice appears ("_ledger_ isn't
in this comparison"). Renderers ignore missing IDs, and switching renderers or
hitting an unreadable state version drops only the renderer portion.

**Playback and panes.** Playback position isn't history, and navigating neither
starts nor pauses playback. Restoring applies at the current progress without
animating the change, while mode switches keep resetting playback position as
they do today. The `shared` part mirrors across every pane of the document (so
expanding a module in Before also expands it in After during side-by-side view,
which doesn't happen today). `viewport` is stored per `PaneKey`, while swipe
continues mirroring scroll. Switching modes carries `shared` over, and any pane
without a recorded viewport opens at the renderer's default.

**The agent.** When an agent changes the view (`open_projection` or a
selection), it pushes an entry with `origin: 'agent'` so Back takes you right
back to what you were reading (`refresh` does not push). In the viewer, multiple
pages mirror one server state: each page owns its own stack, incoming changes
from another page arrive as `mirror` entries, and a page ignores echoes of its
own reports. `current_view` gains `view` (the link below) and
`history {back, forward}` counts. The agent can open an exact view with
`open_projection {view}`, but gets no tool to step through the user's history
(see open question 2).

## Surfaces

The Default UI places Back and Forward on the left of the toolbar ahead of the
mode switch, gated behind a `history` feature flag (off for embedders, on in the
viewer and VS Code). The Inspector is being retired and won't add them.

- **Viewer in a browser.** Each entry calls `history.pushState`, storing the
  entry in `history.state` and the link in the URL fragment. That gives you
  native Back, Forward, Alt+←/→, ⌘[ and ⌘], and mouse buttons 4 and 5 even when
  focus sits inside a renderer frame, plus reload restoration. Pressing Back can
  change the pair the agent last opened; the page reports that like any other
  user change.
- **Copilot canvas.** Because the page is framed and `pushState` inside a frame
  pollutes the host app's session history, the canvas (flagged in the page URL
  by its adapter) manages the stack in memory, uses `replaceState` only for
  reloads, and handles shortcuts itself.
- **VS Code tab.** The stack lives in webview state (`vscode.setState`) so it
  survives tab hiding and window reloads. The page handles shortcuts while
  focused, and `Projections: Go Back` and `Go Forward` commands bind the same
  shortcuts when the tab is active, leaving VS Code's own Go Back free for
  editors.
- **Focus inside a renderer frame.** In the canvas and VS Code, keyboard and
  mouse events inside the sandboxed frame never reach the host. The kit forwards
  the four key chords and mouse buttons 4 and 5 via an additive
  `navigate {direction}` message.
- **Static images.** `projections snapshot --view LINK` and the `screenshot`
  tool's `view` input (defaulting to the current view, renderer state included)
  pass the state in `init.view.restore` and wait for `rendered` as usual.

## Links

A **view link** is the portable form of a history entry — a versioned query
string that never includes the viewer's port or session token:

```
v=1&projection=architecture&choice=branch&mode=diff
  &select=after.entity.payments%2Fledger&filter=changes&search=ledger
  &renderer=graph&state=<base64url JSON>
```

- In the viewer, it lives in the URL fragment so neither servers nor logs see
  it. (The viewer's page URL itself isn't shareable because its port and token
  rotate on every run.)
- Everywhere else, it's passed as an argument: `projections view show --view`,
  `open_projection {view}`, `snapshot --view`, and eventually a VS Code URI.
- **Stability.** Unknown keys are ignored; item IDs are extraction IDs, which by
  contract contain no versions or positions; commits are full SHAs; `choice`
  resolves on open while explicit `before`/`after` pin the pair; and the
  renderer payload carries its own `version`.
- `v` only bumps when an existing key changes meaning, never when adding a new
  one.

## Rollout

1. **Host only.** Add `controller.view()`, `applyView`, the stack rules, toolbar
   buttons, viewer browser history, and VS Code tab persistence. Entries capture
   the location and host state — immediately giving Back/Forward for pairs,
   modes, filters, and agent jumps, plus `view` in `current_view`.
2. **Renderer protocol.** Add `init.view` and the two `viewState` messages, SDK
   validation with `rendererLimits.viewState`, and `useViewState` in the kit.
   Wiring `useStageZoom` to report viewports gives every kit stage renderer zoom
   restoration automatically. The `graph` architecture and dependencies views go
   first (they motivated this, and their expansion state is just a set of entity
   IDs), followed by `text-diff` folds.
3. **Links everywhere.** Wire up `open_projection {view}`, `view show --view`,
   `snapshot --view`, `screenshot` with renderer state, and then saved views.

Each phase updates the
[renderer frame contract](../../contracts/renderer-frames.md) and the
[agent viewer](../agent-viewer.md) doc.

## Alternatives considered

- **Host-controlled expansion via controls.** A renderer could expose "expanded
  boundaries" as a host control, but controls are toolbar chrome capped at 32
  controls and 50 choices with strict declarations. Expansion is per-item, lives
  in the drawing, and uses renderer-local IDs — adding a "set of IDs" control
  would just be a weaker `viewState` where the host pretends to understand the
  data. Rejected.
- **Renderer-owned stack.** Two independent stacks interleave badly (if you
  switch modes and then expand a box, which stack does Back pop?), side-by-side
  would have two stacks, and a sandboxed frame can't touch browser history or
  the toolbar. Rejected.
- **Replaying events instead of storing state.** Re-sending the sequence of
  selections that led to a view is brittle across re-extractions and misses
  internal clicks. Rejected.
- **Browser history only.** Using raw `pushState` without a stack model breaks
  in VS Code and the canvas and hides history from the agent. Kept only as a
  surface binding.
- **A server-owned stack in the viewer** shared across all pages so the agent
  could step through it. Simpler to mirror, but it fights each browser tab's own
  history. Deferred (open question 2).
- **Undo and redo.** The viewer doesn't edit anything; Back and Forward are the
  right words for view navigation.

## Open questions

1. **Should selecting a visible item push an entry?** Recommendation: no — it
   should replace. Only selections from outside the drawing, or selections that
   reveal a hidden item, should push.
2. **Should the agent be able to step through the user's history**, or only read
   the current link and open views? Recommendation: read and open only for now;
   revisit if we adopt a server-owned stack.
3. **Should Back be able to change the pair in the viewer**, where only the
   agent selects pairs today? Recommendation: yes — it only returns to a pair
   the agent already showed, and `current_view` reports it.
4. **Are renderer controls history?** "Every component" acts like a bulk
   expansion. Recommendation: keep controls restorable for now; marking a
   control as history requires a new declaration field that older hosts reject,
   so it waits for a protocol version bump.
5. **Should a link open the pair as it was, or as it is now?** Recommendation:
   `choice` resolves when opened, while saved views record explicit commits. A
   link pointing to missing commits says so and opens nothing.
6. **Should the viewport be typed in the protocol** instead of opaque so hosts
   can mirror zoom across panes or describe it to the agent? Recommendation:
   keep it opaque for now using the kit's shape as a convention, and promote it
   if a second renderer family adopts the same shape.
