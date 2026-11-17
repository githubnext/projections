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

|              | All                        | Changes                                                                                                                                                       |
| ------------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Diff         | the whole union, marked    | changes and context; runs of other items fold into "N unchanged" rows that expand in place                                                                    |
| Side by side | both revisions             | the same folds in both panes, computed on the union so they line up                                                                                           |
| Swipe        | both, stacked              | the same union folds                                                                                                                                          |
| Animated     | the whole projection plays | lists: items arrive and leave between context rows, folds stay. Canvases: the changes and context, laid out on their own, play through the comparison's steps |

In every mode, canvases (graphs, schemas, packings) **lay out only the changes
and their context**: the rest takes no room, so a schema of hundreds of tables
with a few changes reads at a legible size. Nothing is faded: what is shown is
drawn at full strength, and context is told apart from the changes by the
absence of change marks, not by opacity. A shown item's other parts fold (a
context table's unchanged columns become one "12 unchanged columns" row that
opens in place). One affordance over the stage says what is hidden ("Hiding 45
unchanged tables and 380 columns · Show all"). Switching between Changes and All
moves items from their old places to their new ones (skipped under reduced
motion). No relationship is ever drawn to an item the scope leaves out: a
changed relationship always brings both its ends.

## Decisions

1. Context is first-class and lives in the comparison, like `steps`.
2. Context only for now. "Impact" (dependents) is a possible second kind later.
3. No generic significance levels yet; renderer controls (the api renderer's
   "Breaking only") remain the finer layer.
4. Changes removes what it leaves out from view in every mode, Animated included
   (revised after testing: fading left a large schema tiny and its faded items
   below accessible contrast).
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
  every schema, plus a database table's `constraint` and `index`, and a
  dependency-injection service's registrations and a registration's
  implementation, by their entity kinds (`isContainment`).
- **Host core**: `scope`, `setScope`, `scopeCounts` and `scopeHidden` on the
  controller; `changesOnly` (now on by default for a comparison), `variedOnly`
  and `regeneratedOnly` remain the controllable state underneath, so embedders
  and the VS Code extension keep working. The summary filter and find no longer
  turn the scope off. A comparison without changes says so and offers "Show
  all".
- **Kit**: `RendererProps.scope` (`changesScope`: the host's ids, or the same
  derivation past the filter's ID limit), `foldList`, `useFolds` and `Fold`, and
  `MountOptions.scope`: a canvas declares `subset` (with its parts left out,
  kept whole or folded) and receives a `model` of only what is shown
  (`scopedModel`), with `scope.all` and `scope.expand` to open folds.
- **Renderers**: the api renderer folds declarations and text-diff its unchanged
  outputs; graph, database, dependency-injection, file-packing and
  runtime-policy lay out only the changes and their context. The database folds
  a shown table's other columns into one row; graph canvases and the database
  move between the two layouts when the scope changes.
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
- Containment for dependency injection is the vocabulary's entity kinds (service
  → registration → implementation), whatever the relationships' own kinds: the
  extractors name those relationships differently, and the renderer reads them
  by their ends. `isContainment` replaces a list of kinds.
- When the Changes scope would hide nothing (every item is a change or gives one
  context), the switch is replaced by "Changes 2 · nothing hidden", so it never
  offers a choice that changes nothing.
- Dependency-injection and file-packing layouts change at once when the scope
  changes; graph canvases and the database move between them.
- A comparison without any change shows every item under the "No changes"
  notice, rather than receding everything.
- Text diffs fold their unchanged lines in every scope, as a diff's hunks do:
  lines aren't items. The Changes scope folds the unchanged outputs.
- Pull requests open in Diff on the Playground's tab and VS Code's pull request
  choice (over a definition's `presentation.mode`, as a surface default). A
  `projections pr` document opens in the Changes scope but in its definition's
  mode: the Inspector's document view doesn't know it holds a pull request yet.
- Text diffs keep three unchanged lines around each change, as `git diff` does,
  so a run of up to seven lines between two changes stays open.
