# Proposal: changes, scope and context

Status: **Accepted; milestone 1 (interactive, no contract change) and milestone
2 (the contract) implemented.**

When reviewing a pull request, you want to see what changed — just like GitHub's
Files changed tab — rather than the entire projection. On a README, you want the
whole picture. Previously, "Changes only" (in Settings,
`presentation.changesOnly`) only dimmed unchanged items to 25% opacity. In the
`agent-tools` bookmark for #9, that meant scrolling past 78 faded rows in an
82-declaration API table just to spot 4 additive changes. This proposal makes
changes — along with the minimal context needed to understand them — the
first-class view of a comparison.

## Four independent axes

| Axis         | Question                        | Values                              |
| ------------ | ------------------------------- | ----------------------------------- |
| Mode         | How do Before and After relate? | Diff, Side by side, Animated, Swipe |
| Scope        | Which part of the projection?   | Changes, All, Noise                 |
| Focus        | Where does the view open?       | `RendererFocus` (unchanged)         |
| Highlighting | How loud are change marks?      | Animated, On, Off (unchanged)       |

Noise covers items that only varied within tolerance or were regenerated from
the same inputs.

### Changes means changes and their context

**Context** is whatever you need around a change to make sense of it: the
declaration that owns a changed parameter, the table holding a changed column,
or the two services connected by a new dependency. Like `steps`, context is
purely semantic — never positions or colors — and each renderer expresses it in
its own form:

|              | All                        | Changes                                                                                                                                                       |
| ------------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Diff         | the whole union, marked    | changes and context; runs of other items fold into "N unchanged" rows that expand in place                                                                    |
| Side by side | both revisions             | the same folds in both panes, computed on the union so they line up                                                                                           |
| Swipe        | both, stacked              | the same union folds                                                                                                                                          |
| Animated     | the whole projection plays | lists: items arrive and leave between context rows, folds stay. Canvases: the changes and context, laid out on their own, play through the comparison's steps |

Across every mode, canvases (graphs, schemas, packings) **lay out only the
changes and their context**. Everything else takes no space, so a schema with
hundreds of tables and a handful of edits renders at a comfortable, readable
size. Nothing is faded: visible items render at full contrast, and context is
distinguished from changes by the absence of change badges rather than by
opacity.

Unchanged parts inside a shown item fold neatly: a context table's unchanged
columns collapse into a single "12 unchanged columns" row that expands in place
and stays underneath as "Hide 12 unchanged columns" so you can collapse it again
(keyboard-accessible too). A single banner above the stage reports what's hidden
("Hiding 45 unchanged tables and 380 columns · Show all"). Toggling between
Changes and All, or opening and closing a fold, smoothly moves items to their
new positions while keeping links attached to their rows — only links added or
removed by the change fade (under reduced motion, everything jumps cleanly).
Relationships never point to an excluded item, because a changed relationship
always pulls in both of its endpoints.

## Decisions

1. Context is a first-class part of the comparison, right alongside `steps`.
2. We'll start with context only. "Impact" (downstream dependents) can be a
   second category later.
3. No generic significance levels for now; renderer-specific controls (such as
   the API renderer's "Breaking only") remain the finer filter.
4. Changes removes excluded items from the layout in every mode, including
   Animated. (We revised this after testing: fading left large schemas tiny and
   dropped faded items below accessible contrast.)
5. Surface defaults: pull requests (a host's PR page, VS Code's pull request
   choice, and `projections pr`) open to Changes in Diff mode; bookmarks and
   viewer comparisons open to Changes; single-revision views have no scope. A
   definition can opt out with `presentation.changesOnly: false` — the field
   keeps its name and now means Changes instead of All.
6. Scope and filters now compose instead of fighting each other. Summary-bar
   figures and find narrow within the active scope, and renderer controls layer
   on top. The scope controls what gets laid out; figures and find never remove
   or reflow items. Instead, they recede non-matching items to `--pk-recede`
   (0.25) in both Changes and All, so clicking "9 registrations" in Changes dims
   the surrounding services and implementations while keeping the Changes layout
   intact. The filter message separates the two: `scope` carries what the
   Changes scope lays out, while `ids` carries what figures and find match
   (`null` when neither is active, so scope alone never recedes anything). Any
   container holding a matched item — like a card with a matching line — stays
   at full strength.
7. The toolbar places the scope control next to the mode switcher, keeping
   counts in the tooltip so they don't clutter the switch. Noise stays available
   from Settings ("Show") and from the summary bar's variation figures, and
   appears in the switch while active.
8. Folds are always computed on the union (the diff model), never independently
   per side.
9. Context is strictly additive: comparator rules can add context, never strip
   out the core's context, and nothing can hide a change.

## Milestone 1: interactive, no contract change

The renderer protocol stays unchanged. The host's `filter` message already
passes `changesOnly` and the visible `ids`; in Changes scope, those IDs are the
in-scope changes plus their context.

- **Structural context.** `changeContext` in the renderer SDK's `presentation`
  (shared by hosts and the kit) collects both endpoints of any changed
  relationship, plus any containers holding a changed or context entity along
  with their containment edges in either revision. Containment means `contains`
  in every schema, plus a database table's `constraint` and `index`, and a
  dependency-injection service's registrations and each registration's
  implementation, matched by entity kind (`isContainment`).
- **Host core.** The controller adds `scope`, `setScope`, `scopeCounts`, and
  `scopeHidden`. Underneath, `changesOnly` (now defaulting to on for
  comparisons), `variedOnly`, and `regeneratedOnly` remain controllable so
  embedders and the VS Code extension keep working without breaking. Summary
  filters and find no longer turn scope off, and a comparison with no changes
  says so and offers "Show all".
- **Kit.** `RendererProps.scope` exposes `changesScope` (the host's IDs, or the
  same derivation if the filter hits its ID limit), alongside `foldList`,
  `useFolds`, `Fold`, and `MountOptions.scope`. A canvas declares `subset`
  (choosing whether parts are omitted, kept whole, or folded) and receives a
  `model` containing only visible items (`scopedModel`), plus `scope.all`,
  `scope.expand`, and `scope.collapse` to toggle folds.
- **Renderers.** The API renderer folds unchanged declarations and text-diff
  folds unchanged outputs; graph, database, dependency-injection, file-packing,
  and runtime-policy lay out only changes and context. The database renderer
  folds a shown table's unchanged columns into one row, and both graph canvases
  and the database animate smoothly between layouts with links attached when
  scope or folds change.
- **Hosts.** The scope switch appears in the default view's toolbar (the
  Inspector, `projections view`, and the Copilot canvas), the VS Code UI, and
  embedded pull request pages (which default to Changes in Diff).

## Milestone 2: the contract

- Every change gains an optional `context: {before: string[], after: string[]}`
  holding the unchanged item IDs per revision that give it context (for a
  removal, those live in Before), plus optionally the name of the rule that
  added them. Engine validation checks that all referenced IDs exist and stay
  within bounds, raising explicit limit errors otherwise.
- **Core default context** moves into the Engine (both native and `rules.wasm`),
  just like default ordering, using the same structural context rules above.
- **Comparator files** gain a `context` section evaluated per change like
  `classify` (`name`, `description`, `where`, `variables`, and `before`/`after`
  CEL expressions returning `list<string>`), with incoming and outgoing
  `lookup`. Comparator tests can assert a change's context directly.
- **Compatibility.** Because comparison schemas are closed, renderers opt in by
  declaring a `context` capability, and hosts strip `context` for renderers that
  don't declare it. Older CLIs reject saved comparisons containing `context`.
- The SDK exposes each change's context, falling back to the structural
  derivation when absent, and `current_view` lists it.

As built: `Change.context` has the shape `{before, after, rules?}` in
`comparison/v0`, validated with codes `unknown-reference`, `invalid-context`,
`unexpected-context`, `missing-context`, and `context-limit` (capped at 1,000
IDs per change and revision, and 250,000 IDs / 16 MiB of ID bytes per
comparison). The Engine's `context` module computes the core structural context
shared by native and `rules.wasm`, applied by both the default comparator and
the rules interpreter and required by validation whenever `context` is present.
Comparator files support `context` rules and comparator tests support
`changes: [{id, context}]`. Kit renderers declare the `context` capability, and
`RendererFrame` strips `context` from `init` for renderers that do not.
`presentComparison`, `scopeRows`, and host rows thread it through;
`changeContext` and the new `rowContexts` consume it; and the host's Changes
scope and filter IDs follow it. The Inspector's summary items include each
change's context (`changeContextItems`), which `current_view` exposes in both
the CLI viewer and VS Code. The rules language is now at revision 4.

## Deviations

Notes on places where the implementation made concrete choices within the
decisions above:

- Side-by-side folds are computed per pane from the union's order. Because
  unchanged items match in both revisions, folds line up, but expanding a fold
  only opens it in that pane — the renderer protocol has no message for synced
  expansion, and milestone 1 adds none.
- Scope counts match the kinds shown in the summary bar's count figures: only
  the changes themselves, not their context (so four changed declarations count
  as 4 even though their parent tools are also shown), compared against every
  item in either revision. That way All is always larger than Changes whenever
  anything is hidden. A table's structural relationships (like a column's
  `contains`) aren't counted alongside its columns, keeping the switch and
  summary bar in sync.
- While side-by-side panes fold from the union's scope, each pane merges
  adjacent runs around items it doesn't contain (for instance, an added row
  doesn't exist in Before), so Before may show one fold where After shows two
  with the addition in between.
- Containment for dependency injection follows the vocabulary's entity kinds
  (service → registration → implementation) regardless of relationship kind
  names, since different extractors name those edges differently and the
  renderer reads them by endpoint. `isContainment` replaces a hard-coded list of
  relationship kinds.
- When Changes wouldn't hide anything (every item is either changed or context),
  the switch turns into "Changes · nothing hidden" so it never offers a no-op
  toggle.
- Dependency-injection and file-packing layouts switch immediately on scope
  changes; graph canvases and the database animate between them.
- An expanded fold stays in place labeled "Hide 7 unchanged columns" (or
  declarations, outputs, or lines) rather than turning into a separate collapse
  button, so you close it right where you opened it. In tables it stays at the
  bottom below the revealed columns; in lists and text diffs it stays above the
  run.
- The database renderer animates layout transitions frame by frame in script
  rather than via CSS transitions. Each link's endpoints travel with their rows:
  links drawn the same way in both layouts interpolate their waypoints, while
  links drawn differently take their new route with endpoints attached —
  including links shifting between individual rows and table headers when
  columns fold. Graph canvases move edges alongside cards and lay out Changes
  and All in the background as two views of one document, starting the
  transition once the new layout is ready.
- Nothing renders while either side of a pair is still extracting (the view
  shows a loading state), and canvases draw the host's initial scope straight
  away instead of rendering everything and then paring it down. If one side
  fails to extract, the other side still renders.
- A comparison with zero changes displays every item beneath a "No changes"
  notice rather than dimming the whole view.
- Text diffs fold unchanged lines in every scope, just like diff hunks, because
  lines aren't items; the Changes scope folds unchanged outputs.
- Pull requests open in Diff on host PR pages and VS Code's pull request choice
  (overriding a definition's `presentation.mode` as a surface default). A
  `projections pr` document opens in Changes scope but keeps its definition's
  mode because the Inspector's document view doesn't yet know it's holding a
  pull request.
- Text diffs keep three unchanged context lines around each change (matching
  `git diff`), so runs of up to seven unchanged lines between two changes stay
  expanded.
- A change's context can reference items from other changes — such as a modified
  table holding a changed column — not strictly unchanged items. That way,
  narrowing Changes to one change via find or a summary figure still shows its
  container. Only the change's own items are excluded.
- Context is only attached to changes whose status or identity changed (the
  items in Changes scope), never to expected variation, and is omitted when
  empty (like `varied`). When a saved comparison omits context, the renderer SDK
  derives it per change; for a comparison generated with context, that
  derivation is empty, so only older saved comparisons are marked as derived.
- Validation requires any present `context` to include the core structural
  context (`missing-context`), making "rules only add" an invariant of every
  comparison rather than just the interpreter. Saved comparisons without
  `context` remain valid.
- `rules` lists which comparator rules added context to a change, tracked per
  change rather than per ID; core structural context is left unnamed.
- Context rules run after `classify` and can read its `annotation`. If a rule
  emits an ID that doesn't exist in that revision, the comparison fails
  (`invalid-context`) instead of silently dropping it; references to the
  change's own items are silently ignored.
- CEL expressions can't read a change's context yet (`change` has no `context`
  field), so steps and later rules don't see it. Nothing needed it so far, and
  exposing it would change the declared `Change` type.
- `current_view` lists up to 20 context items per change along with the total,
  and includes identity changes (renames, splits, merges) that are marked
  `unchanged` because they still carry context.
- Core context is bounded while it's built, not just checked afterward. Walking
  in change order, each change keeps its nearest context items first — up to
  1,000 per revision — out of the comparison's total budget of 250,000 IDs and
  16 MiB of ID bytes (since IDs have no length cap, count alone wouldn't bound
  memory). Deep containment chains or huge change sets therefore can't exhaust
  memory or fail default comparisons against their own limits, and validation
  spends the same budget in the same order. The renderer SDK's fallback
  derivation for older saved comparisons is unbounded because it only runs
  during presentation.
