---
description: "Built-in graph renderer: graphs, DAGs and architectures"
---

# Graph renderer

`@githubnext/projections-renderer-graph` is the built-in renderer for `graph`,
`graph-horizontal`, `dag`, `architecture`, `infrastructure` and `dependencies`
definitions. It reads `init.projection.renderer` to choose the presentation, so
one bundle (and one copy of the graph layout engine) serves all six names. The
DAG and architecture renderers were separate packages
(`@githubnext/projections-renderer-dag` and `-architecture`); they are now
presentations of this bundle, and their scenarios live in `scenarios.json` here.

- `graph-horizontal` is the same graph laid out left to right.
- `dag` presents pipelines, build and dependency graphs. A single extraction
  whose entities are all `job`s routes each complete shared-prerequisite stage
  (`precedes` relationships) through one join/split point that ELK places as a
  node of its own, with a menu to inspect each dependency.
- `dependencies` is a package dependency graph, left to right from the workspace
  members (`data.workspaceMember`, as `workspace-dependencies` and
  `cargo-dependencies` write them) or NuGet projects and target frameworks: what
  each one pulls in, directly and transitively. It replaces the former list
  renderer (`@githubnext/projections-renderer-dependencies`), which only
  repeated the flat package list GitHub's dependency review already shows. See
  [Dependency graphs](#dependency-graphs).
- `graph`, `graph-horizontal`, `dag` and `architecture` show facts from `data`
  when asked, through controls a definition presets in
  `presentation.rendererOptions`: **Subtitle** (`subtitle`, a `/data/<field>`
  pointer to text) draws a field under each card's label in sans, **Icon**
  (`icon`, always offered with the `icon` field, and any other field naming one
  of the kit's `cardIconNames`, Lucide names such as `terminal`) draws that icon
  before each card's kind line and a boundary's heading (any other name draws
  none, and the summary bar warns of it as an `unknown-icons` fact), **Size by**
  (`sizeBy`, a numeric field) draws a bar along each card's top edge as long as
  the square root of its share of the largest value and shows the number,
  **Badges** (`badges`) draws a field's values as monospace pills under each
  card's label, **Labels** (`labels`) as sans ones, **Highlights**
  (`highlights`) first in the accent color with a shield and **Tags** (`tags`)
  last as a quiet line of code, **Color by** (`colorBy`: `kind` or a field)
  draws a band in a color per value along each card's leading edge (a field of
  language names in their GitHub colors), **Relationships** (`relationships`:
  `all` or one kind) draws one kind of relationship, and **Relationship colors**
  (`relationshipColors`, offered when two or more relationship kinds are drawn,
  off by default) colors each relationship kind. The host legend lists the
  colors and what width means. Only fields the document has are offered
  (`src/facts.ts`); the kit's `GraphCanvas` draws them (`subtitle`, `icon`,
  `weight`, `badges`, `accent`).
- `architecture` uses compound mode: an unambiguous, containment-only `module`
  becomes a dashed boundary around its children instead of `contains` arrows.
  Boundaries are ELK compound nodes, laid out with their children, and
  interpolate with them. Each card names its kind, and the host's summary bar
  counts the components of each kind (`contains` relationships are drawn as
  boundaries, not counted, and so are modules when every one is a boundary, see
  the kit's `boundaryNouns`), so there is no kind legend. One revision of up to
  60 components draws every one. In a comparison of more than 40 components (or
  one revision of more than 60), each unchanged boundary collapses into a
  summary card that counts its components and carries the boundary's own `data`,
  with its relationships joined to the card; activating it (a click, a double
  click, Enter or Space) expands it, and the kit draws an expand or collapse
  icon on such cards (`syntheticAction`'s `expanded`)
  (`src/architecture/collapse.ts`).
- `infrastructure` presents
  [the infrastructure model](../../../docs/models/infrastructure-model.md)
  (`terraform-infrastructure`, `azure-what-if`) as a resource graph. A card's
  kind line is its resource type, as code (`aws_db_instance`,
  `virtualNetworks/subnets`), and its label the resource name. Modules, resource
  groups and containment-only parent resources (a virtual network around its
  subnets) are boundaries. A change is worded as its planned action, as a badge
  and a word in the status footer: Create, Destroy, Replace
  (`Replace, create first` when created before destroyed), Update in place,
  Redeploy, Read, Import, Forget and Moved, so a replacement never reads like an
  update and a destruction never rests on red alone. One revision shows each
  pending action after its type (`aws_db_instance · Replace`). The host's
  summary bar states the plan, each action with its count, filtering to its
  resources (below). With the **Dependents** control (on by default), selecting
  a resource brings forward everything with a path of `references` to it and
  recedes the rest; the caption says how many resources depend on it.

Graphs are laid out densely with ELK's layered algorithm, in level layers (each
layer's cards share one top, or one left edge), with each card over the card it
links to wherever it can sit there, so that relationship runs straight, and
relationships that leave and enter the cards' faces along the layers (top to
bottom, or left to right for `graph-horizontal`), several into one card at
evenly spaced ports across its face. A graph's cards share the width its longest
card text needs, from 112 to 216 units (longer text ends in an ellipsis and the
card's tooltip has it whole), and one revision's cards leave out the status
footer a comparison reserves, so typical graphs open fitted with their text at
full size. Comparisons animate in the comparison's own step order with the
[renderer kit](../kit/README.md)'s staged graph canvas: Before and After keep
the layers and order of the union of both revisions, the first step makes room
for every arrival, the steps between hold still while entities fade in and out
where they belong, and the last step closes the gaps. Every step keeps the
union's boundaries, so a module emptied by removals stays a boundary, and when a
revision's own layout would move a card or boundary through another, that end
keeps the union's places instead. Removals fade before their gap closes,
additions get room before they fade in, relationships fade with the endpoint
that brings or takes them and crossfade when rewired between survivors, and
routes morph with their cards. Framing covers every layout and never changes
while scrubbing. Change emphasis follows the host's `highlighting` and is absent
at both endpoints. Step boundaries are reported with `client.steps`.

Every presentation also has a **Diff** mode: one static union of both revisions,
laid out once (the union layout the animation passes through, so it stays close
to Before and After), with every change marked where it is: added cards and
relationships in the added hue, removed ones kept in place, dashed and struck
through, modified cards amber with a renamed label or a changed version shown
old (struck through) then new, a modified card's changed `data` fields listed on
it (each old value struck through, then the new; `infrastructure` lists its
attribute changes instead, below), and a relationship rewired between other
endpoints drawn twice, its old route dashed and removed, its new one added. The
host's summary bar along the bottom of every view counts each kind and its
changes, in the renderer's nouns (the dependency graph says workspaces, packages
and dependencies; containment drawn as boundaries is no figure), then states as
facts what those counts can't; no presentation draws a summary line over the
graph:

- `graph`, `dag` and `architecture`: the bar's counts are their summary (and
  architecture's component kinds, which no legend lists); a DAG's `precedes`
  relationships count as dependencies (`6 dependencies`), not as a verb. A
  merged before/after graph suits DAGs and architecture because their layout is
  their meaning: survivors stay in their layers and order.
- `infrastructure`: the plan, each planned action with how many resources it
  touches and its icon, in Terraform's order
  (`2 to add · 3 to change · 1 to replace · 1 to destroy · 1 to move`; modules
  and resource groups are boundaries and aren't counted), each filtering to its
  resources. In one revision the plan counts each resource's own pending action
  (`data.action`), as a plan's summary line does. A changed resource's card
  lists its attribute changes (`data.values`, down to the setting that changed:
  `properties.hardwareProfile.vmSize`), each path with the old value struck
  through and the new one, what forces a replacement (`data.replacePaths`) first
  and values known only after apply last; the card shows three, then counts the
  rest.

Diff cards show their data whole: long types, names, versions and values wrap
(after `_ . / - , :` first) and the card grows, never ending in an ellipsis. The
diff opens fitted, every card in view, as every mode and a single revision do,
unless that draws text below the kit's 8 px opening floor: then it opens at the
floor on the top row's leftmost card and scrolls.

- `dependencies`: the bar counts workspace members, packages and dependencies
  with their changes, then upgrades and downgrades by the part of the version
  that moved, in the cards' words
  (`18 major upgrades · 6 minor upgrades · 4 patch upgrades`, from the versions
  themselves), packages whose versions can't be ordered or that were renamed,
  and how many changed packages are direct dependencies, each filtering to its
  packages. A changed version reads old struck through, then new, and the footer
  names the bump (`Major upgrade`, `Patch downgrade`).

Build with `npm run build -w @githubnext/projections-renderer-graph`.

## Dependency graphs

Lockfiles resolve hundreds of packages, so the `dependencies` presentation shows
the structure that explains a change and summarizes the rest:

- **Always shown:** the roots, every package they depend on directly, every
  changed package, both ends of every changed relationship, and the shortest
  path from a root that pulls each of them in (breadth-first in ID order, so the
  same documents always present the same graph).
- **Summarized:** every other package belongs to the first shown package that
  pulls it in, nearest the roots first, and that package gets one summary card
  ("12 more packages"). Selecting a summary expands its owner by one level, and
  the card stays in its place as "Collapse 12 packages" (the same ID, so it
  keeps focus and moves rather than reappearing), which closes the group again
  and clears a selection it hides. Packages expanded inside a collapsed group
  open again with it. The host-drawn **All packages** toggle shows everything
  (up to the canvas's entity limit) and no collapse cards. Summaries are
  presentation only: they carry `data-graph-synthetic`, never a selection ID,
  and arrive and leave in the step of the package that owns them, so they never
  look changed at either endpoint.
- **Edges:** a shared package (`debug`, required by five others) would pull an
  edge from each of its dependents across the graph, so each shown package keeps
  the edge from the package that first pulls it in (its primary path,
  breadth-first from the roots in ID order) and every dependency added or
  removed; its other dependents are counted on its kind line ("Package · +3
  dependents"). Only unchanged edges and version-range updates are left out, and
  the package's own card shows its new version, so no change is hidden. The
  host-drawn **Every dependency** toggle draws them all again.
- **Focus:** selecting a package brings forward everything that depends on it
  and everything it depends on, drawn edge or not, and recedes the rest; the
  footer says how many ("3 packages depend on debug; it depends on 1 package").
- **Cards** name the kind (`workspace`, `package`, or the extractor's own such
  as `project`) and show the package name and version as identifiers in the
  theme's monospace font; a version change crossfades with the card's step.
  While emphasized, a version change reads Upgraded or Downgraded, beside the
  `upgraded` or `downgraded` icon, in the card's reserved status footer
  (Modified when the versions can't be ordered), and its accessible name says
  so; the summary label is sans.
- NuGet's `resolved` relationships (target membership of every package) are not
  dependencies and aren't drawn; `direct-dependency` and `depends-on` are.

Fixtures: `fixtures/npm-workspace-v{1,2,3}.json` are real extractions of the npm
workspace revisions in `fixtures/npm-workspace/`, regenerated with
`node packages/renderers/graph/fixtures/make-dependencies.mjs`;
`fixtures/nuget-*.json` are synthetic NuGet-shaped extractions written by
`fixtures/make-nuget.mjs`.
