# Proposal: changes, scope and context

Status: **Accepted; milestone 1 (interactive, no contract change) implemented,
milestone 2 (the contract) in progress.**

On a pull request a person wants the changes, as GitHub's Files changed shows
them, not the whole projection. On a README they want the whole picture. Until
now "Changes only" (Settings, `presentation.changesOnly`) only faded unchanged
items to 25%: the `agent-tools` bookmark of #9 has 4 additive changes in an
82-declaration api table, and a reviewer scrolled past dimmed rows to find them.
This proposal makes the changes, and what they need to be read, the first-class
view of a comparison.

## Four independent axes

| Axis         | Question                        | Values                              |
| ------------ | ------------------------------- | ----------------------------------- |
| Mode         | How do Before and After relate? | Diff, Side by side, Animated, Swipe |
| Scope        | Which part of the projection?   | Changes, All, Noise                 |
| Focus        | Where does the view open?       | `RendererFocus` (unchanged)         |
| Highlighting | How loud are change marks?      | Animated, On, Off (unchanged)       |

Noise is the items that only varied: within tolerance, or regenerated from the
same inputs.

### Changes means changes and their context

**Context** is what a person needs to read a change: the declaration a changed
parameter belongs to, the table a changed column is in, the two services a new
dependency connects. It is semantic, like `steps`, never positions or colors.
The renderer's form realises it:

|              | All                        | Changes                                                                                                                                                                     |
| ------------ | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Diff         | the whole union, marked    | changes and context; runs of other items fold into "N unchanged" rows that expand in place                                                                                  |
| Side by side | both revisions             | the same folds in both panes, computed on the union so they line up                                                                                                         |
| Swipe        | both, stacked              | the same union folds                                                                                                                                                        |
| Animated     | the whole projection plays | lists: items arrive and leave between context rows, folds stay. Canvases: nothing hidden; the view frames the changes and context, and far items stay faded for orientation |

In Diff, Side by side and Swipe, canvases (graphs, packings) keep the union's
layout, so nothing moves, draw changes and context at full strength, recede the
rest strongly, and fit the view to the changes and context.

## Decisions

1. Context is first-class and lives in the comparison, like `steps`.
2. Context only for now. "Impact" (dependents) is a possible second kind later.
3. No generic significance levels yet; renderer controls (the api renderer's
   "Breaking only") remain the finer layer.
4. Animated Changes on canvases keeps far items faded, not hidden.
5. Defaults per surface: a pull request (the Playground PR tab, the VS Code pull
   request choice, `projections pr`) opens Changes in Diff; bookmarks and
   compare in the viewer open Changes; one revision has no scope. A definition
   opts out with `presentation.changesOnly: false`, the field keeping its name
   and now meaning Changes rather than All.
6. Scope filters nest: the summary bar's figures and find narrow within the
   scope ("+1 workspaces" in Changes is that change and its context), and
   renderer controls apply on top. They used to exclude each other.
7. The toolbar shows the scope beside the mode, with counts ("Changes 4 · All
   82"). Noise stays reachable from Settings ("Show") and the summary bar's
   variation figures, and joins the switch while it is the scope.
8. Folds are computed on the union (the diff model), never per side.
9. Context is only ever added: rules can add context, never remove the core's,
   and nothing hides a change.

## Milestone 1: interactive, no contract change

The renderer protocol is unchanged. The host's `filter` already carries
`changesOnly` and the shown `ids`; in the Changes scope the ids are the changes
in scope and their context.

- **Structural context** (`changeContext` in the renderer SDK's `presentation`,
  shared by hosts and the kit): a changed relationship's endpoints, and the
  items containing a changed or context entity with the containment
  relationships between them, in either revision. Containment is `contains` in
  every schema, plus a database table's `constraint` and `index` and a
  dependency-injection service's `registration` and a registration's
  `implements` (`containmentKinds`).
- **Host core**: `scope`, `setScope` and `scopeCounts` on the controller;
  `changesOnly` (now on by default for a comparison), `variedOnly` and
  `regeneratedOnly` remain the controllable state underneath, so embedders and
  the VS Code extension keep working. The summary filter and find no longer turn
  the scope off. A comparison without changes says so and offers "Show all".
- **Kit**: `RendererProps.scope` (`changesScope`: the host's ids, or the same
  derivation past the filter's ID limit), `foldList`, `useFolds` and `Fold`, and
  `data-scope` on the root, under which canvases recede what is outside the
  scope strongly in still modes and faintly while animating.
- **Renderers**: the api renderer folds declarations; canvases frame the changes
  and their context.
- **Hosts**: the scope switch in the default view's toolbar (the Inspector,
  `projections view` and the Copilot canvas), the VS Code UI and the
  Playground's pull request tab, which opens Changes in Diff.

## Milestone 2: the contract

- Each change gains optional `context: {before: string[], after: string[]}`, the
  unchanged item IDs per revision that give it context (a removal's live in
  Before), optionally with the name of the rule that added them. Engine
  validation checks the IDs exist and are bounded, with explicit limit errors.
- **Core default context** in the Engine (native and `rules.wasm`), as the
  default order is: the structural context above.
- **Comparator files** gain a `context` section evaluated per change like
  `classify` (`name`, `description`, `where`, `variables`, `before`/`after` CEL
  expressions returning `list<string>`), with `lookup` incoming and outgoing.
  Comparator tests can assert a change's context.
- **Compatibility**: comparison schemas are closed, so renderers declare a
  `context` capability and hosts strip `context` for those that don't. Older
  CLIs reject saved comparisons with `context`.
- The SDK exposes a change's context, falling back to the structural derivation
  when absent; `current_view` lists it.

## Deviations

Recorded as implementation chose within the decisions above.

- Side by side folds are computed per pane from the union's order. Unchanged
  items are the same in both revisions, so the folds line up, but expanding a
  fold expands it in that pane only: the renderer protocol has no message for
  it, and milestone 1 adds none.
- The scope counts are the summary bar's count figures: their changes, without
  context ("Changes 4" for four changed declarations, though their tools show
  too), and their totals. A table's structural relationships (a column's
  `contains`) aren't counted beside its columns, so the switch and the summary
  bar agree.
- Side by side panes fold from the union's scope, but each pane merges adjacent
  runs around items it doesn't have (an added row is absent from Before), so
  Before can show one fold where After shows two with the addition between.
- The database renderer keeps its measured layout in milestone 1: a context
  table's unchanged columns stay in place, receded to 40%, rather than folding;
  tables outside the scope recede. Folding columns inside table cards needs its
  layout to measure folds, and follows.
- A comparison without any change shows every item under the "No changes"
  notice, rather than receding everything.
- Text diffs fold unchanged lines only in the Changes scope; All shows every
  line, as it shows every item elsewhere.
- Pull requests open in Diff on the Playground's tab and VS Code's pull request
  choice (over a definition's `presentation.mode`, as a surface default). A
  `projections pr` document opens in the Changes scope but in its definition's
  mode: the Inspector's document view doesn't know it holds a pull request yet.
- Recession is a CSS `filter: opacity()` on HTML boxes (it composes with the
  opacity renderers animate inline, which hid the filter on database tables) and
  the opacity inside SVG.
