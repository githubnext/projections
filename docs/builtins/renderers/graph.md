# Graph

Entities as cards and relationships as arrows, laid out in layers, with every
change shown where it happens. One renderer serves six presentations of a graph:
`graph`, `graph-horizontal`, `dag`, `architecture`, `infrastructure` and
`dependencies`; the definition's `renderer` picks one. Compared across a pull
request, it answers "what was added, removed or rewired, and what does it
connect to?"

<!-- generated: facts -->

- Name: `graph`; also answers to `graph-horizontal`, `dag`, `architecture`,
  `infrastructure`, `dependencies`
- Draws: [`graph/v0`](../../reference/schemas/graph.md),
  [`dag/v0`](../../reference/schemas/dag.md),
  [`architecture/v0`](../../reference/schemas/architecture.md)
- Comparison modes: Diff, Side by side, Animated, Swipe; a comparison opens in
  Diff
- Package: `@githubnext/projections-renderer-graph`

<!-- end generated: facts -->

## When to use it

Use it for anything whose meaning is in its connections: services and the calls
between them, pipeline jobs and what they wait for, cloud resources and what
they reference, packages and what pulls them in. Each presentation words the
same graph for its domain, so pick the one that matches what the extraction
describes; they all accept the same extractions.

It suits graphs of up to a few hundred entities. For a containment hierarchy
sized by weight (a file tree), use [`file-packing`](file-packing.md); for a
container's registrations, [`dependency-injection`](dependency-injection.md);
for a database schema, [`database`](database.md).

Built-in extractors that draw with it by default:

<!-- generated: extractors -->

| Built-in extractor                                                          | Its default `renderer` |
| --------------------------------------------------------------------------- | ---------------------- |
| [`workspace-dependencies`](../extractors/workspace-dependencies.md)         | `dependencies`         |
| [`cargo-dependencies`](../extractors/cargo-dependencies.md)                 | `dependencies`         |
| [`swift-package-dependencies`](../extractors/swift-package-dependencies.md) | `dependencies`         |
| [`nuget-dependencies`](../extractors/nuget-dependencies.md)                 | `dependencies`         |
| [`terraform-infrastructure`](../extractors/terraform-infrastructure.md)     | `infrastructure`       |
| [`azure-what-if`](../extractors/azure-what-if.md)                           | `infrastructure`       |
| [`github-actions-jobs`](../extractors/github-actions-jobs.md)               | `dag`                  |
| [`scip-file-references`](../extractors/scip-file-references.md)             | `graph`                |

<!-- end generated: extractors -->

## What it draws

Each entity is a card: its kind on a small line above, in words (`component`
reads Component), and its label below, in the monospace font. Each relationship
is an arrow from the source card to the target card. Cards are placed in layers
(top to bottom, or left to right) so that most arrows point the same way, and
every card of a graph shares one width, sized to its longest text; text that
still doesn't fit ends in an ellipsis, and the card's tooltip has it whole.

The view opens fitted, with every card in view, unless that would draw its
smallest text below 8 px. Then it opens at that size on the top row, centred
across a top-to-bottom graph (from the leftmost card of a left-to-right one),
and you scroll for the rest; **Fit to view** always returns to everything in
view. A comparison in **Diff** that doesn't fit at 8 px opens, still at 8 px, on
its changes instead: the changed cards and relationships centred when they fit
there, else from their top-left card. A host can ask for another opening view
(see `RendererFocus`): the changes in any mode, fitted (at most at full size,
and not below 8 px), one item centred with the cards it connects to, or
everything; images can fit it whole whatever its text size
(`projections compare --png … --focus changes --fit`). At most 500 entities are
drawn, with a notice.

Many relationships into one card (a hub) each keep a port of their own: the card
grows wider, up to four times its width, so their arrowheads stand at least 12
units apart, and runs into it take tracks of their own across the gap above it.
Selecting or hovering a card traces each of its relationships whole, under a
halo.

### `graph`

The general presentation, top to bottom. Every entity kind is a card and every
relationship kind an arrow; nothing is grouped.

### `graph-horizontal`

The same graph laid out left to right, for long chains and wide pipelines that
would otherwise be one tall column.

### `dag`

Pipelines, build graphs and other directed acyclic graphs, top to bottom: the
presentation [`github-actions-jobs`](../extractors/github-actions-jobs.md) uses.
In one revision of a `dag/v0` extraction made entirely of `job`s, where several
jobs all wait on the same several jobs (and those lead nowhere else), their
`precedes` arrows meet at one join point instead of crossing as a mesh, and
**Inspect N shared dependencies** under the graph lists each of them so you can
select it. A comparison draws every arrow on its own. (`graph` draws such an
extraction the same way: the join points come from the extraction, not the
name.)

### `architecture`

Components grouped by module: a `module` whose only relationships are the
`contains` relationships to its children (each with no other parent) becomes a
dashed boundary around them, named on its top edge, instead of a card with an
arrow to each. Other relationships stay arrows, across boundaries. Containment
drawn as boundaries isn't counted in the summary bar.

An architecture of more than 40 components collapses each unchanged boundary
into one summary card, named for the boundary and counting its components
(`extractors`, `Module · 31 components`), with the boundary's own `data` (so a
module the extractor describes and sizes keeps its subtitle, size and color);
relationships into and out of it join the card, one arrow per pair of cards. A
boundary stays open when anything in it changed, when a changed relationship
touches it, or when it holds the item a host focused. A summary card shows an
expand icon in its corner: clicking it (or double-clicking, or pressing Enter or
Space on it), or an arrow joined to one, opens it, and a card in its place, with
a collapse icon, collapses it again. Cards are controls, so clicking them never
selects their text; selecting a hidden component elsewhere (the host's table,
the other pane) opens the boundary that holds it. The **Every component**
control shows every boundary open.

### `infrastructure`

Cloud resources in the
[infrastructure model](../../models/infrastructure-model.md), as
[`terraform-infrastructure`](../extractors/terraform-infrastructure.md) and
[`azure-what-if`](../extractors/azure-what-if.md) write it. A card's kind line
is its resource type (`aws_db_instance`, `virtualNetworks/subnets`, a data
source as `data.<type>`) and its label the resource's name. Modules, resource
groups and parent resources whose only relationships are containment (a virtual
network around its subnets) are boundaries.

A change is worded as its planned action, an icon and a word on the card:
**Create**, **Destroy**, **Replace** (**Replace, create first** when the new
resource is created before the old one is destroyed), **Update in place**,
**Redeploy**, **Read**, **Import**, **Forget** and **Moved**, so a replacement
never reads like an update. One revision shows each resource's pending action
after its type (`aws_db_instance · Replace`).

With **Dependents** on, selecting a resource brings forward everything with a
path of `references` to it and recedes the rest, and the footer says how many
(`3 resources depend on db`).

### `dependencies`

A package dependency graph, left to right from the workspace members
(`data.workspaceMember`), NuGet projects and target frameworks, or Swift targets
and products: what each pulls in, directly and transitively. A card names its
kind (Workspace, Package, or the extractor's own, such as Project), with the
package name and its version as code.

Lockfiles resolve hundreds of packages, so it shows what explains a change and
summarizes the rest:

- **Always shown**: the roots, their direct dependencies, every changed package,
  both ends of every changed dependency, and the shortest path from a root that
  pulls each of them in.
- **Collapsed**: every other package belongs to the first shown package that
  pulls it in, which gets one summary card ("12 more packages"). Selecting the
  summary expands that package by one level; the card stays in its place as
  "Collapse 12 packages", which closes the group again (and clears a selection
  it hides). **All packages** shows everything, with no summary cards.
- **One arrow per package**: a shared package keeps the arrow from the package
  that first pulls it in, plus every dependency added or removed; its other
  dependents are counted on its kind line ("Package · +3 dependents"). **Every
  dependency** draws them all.
- **Focus**: selecting a package brings forward what depends on it and what it
  depends on, drawn arrows or not, and the footer says how many
  (`3 packages depend on debug; it depends on 1 package`).

NuGet's `resolved` relationships (which target framework a package belongs to)
are membership, not dependencies, and aren't drawn.

## Options

The host draws these controls; set their starting values in the definition's
`presentation.rendererOptions` by ID:

<!-- prettier-ignore -->
| Presentation | Control | ID | Values | Default |
|---|---|---|---|---|
| `graph`, `graph-horizontal`, `dag`, `architecture` | Subtitle (offered when an entity's `data` has a field of strings) | `subtitle` | `none`, or a field as a JSON pointer (`/data/description`) | `none` |
| `graph`, `graph-horizontal`, `dag`, `architecture` | Icon (always offered: the `icon` field, and any other field of strings that names a card icon) | `icon` | `none`, or a field as a JSON pointer (`/data/icon`) | `none` |
| `graph`, `graph-horizontal`, `dag`, `architecture` | Size by (offered when an entity's `data` has a field of numbers) | `sizeBy` | `none`, or a field (`/data/tokens`) | `none` |
| `graph`, `graph-horizontal`, `dag`, `architecture` | Badges (offered when an entity's `data` has a field of strings, numbers or booleans, or lists of them) | `badges` | `none`, or a field as a JSON pointer (`/data/capabilities`) | `none` |
| `graph`, `graph-horizontal`, `dag`, `architecture` | Labels (offered with Badges) | `labels` | `none`, or a field (`/data/traits`) | `none` |
| `graph`, `graph-horizontal`, `dag`, `architecture` | Highlights (offered with Badges) | `highlights` | `none`, or a field (`/data/verification`) | `none` |
| `graph`, `graph-horizontal`, `dag`, `architecture` | Tags (offered with Badges) | `tags` | `none`, or a field (`/data/runs`) | `none` |
| `graph`, `graph-horizontal`, `dag`, `architecture` | Color by | `colorBy` | `none`, `kind`, or a field of strings, numbers or booleans (`/data/scope`) | `none` |
| `graph`, `graph-horizontal`, `dag`, `architecture` | Relationships (offered when two or more relationship kinds are drawn) | `relationships` | `all`, or one relationship kind (`depends-on`) | `all` |
| `graph`, `graph-horizontal`, `dag`, `architecture` | Relationship colors (offered when two or more relationship kinds are drawn) | `relationshipColors` | `true`, `false` | `false` |
| `infrastructure` | Dependents | `dependents` | `true`, `false` | `true` |
| `dependencies` | All packages | `transitive` | `true`, `false` | `false` |
| `dependencies` | Every dependency | `paths` | `true`, `false` | `false` |

```json
"presentation": {"rendererOptions": {"badges": "/data/capabilities", "colorBy": "/data/scope", "icon": "/data/icon"}}
```

The card options show facts the extraction keeps in `data` on the canvas:

- **Subtitle** draws a text field (what the entity is for, say) under each
  card's label in the text font, wrapped on up to three lines and ending in an
  ellipsis when longer; the card's tooltip has it whole. The card grows a line
  for each line.
- **Icon** draws a small icon before each card's kind line (and before a
  boundary's heading), in the kind line's muted color, so the parts of a system
  read at a glance. The field's value names the icon; it is never markup or a
  URL, since the data is untrusted and renderers run sandboxed. The renderer
  draws only its own fixed set of [Lucide](https://lucide.dev/icons) icons, by
  their Lucide names:

  <!-- card-icons -->

  `activity`, `app-window`, `binary`, `blocks`, `book-open`, `bot`, `box`,
  `boxes`, `braces`, `brain`, `cable`, `chart-bar`, `cloud`, `code`, `code-xml`,
  `component`, `container`, `cpu`, `database`, `file`, `file-code`, `file-text`,
  `flask-conical`, `folder`, `folder-tree`, `gauge`, `git-branch`,
  `git-compare`, `git-merge`, `git-pull-request`, `globe`, `hammer`,
  `hard-drive`, `key-round`, `layers`, `layout-dashboard`, `library`,
  `list-tree`, `lock`, `mail`, `message-square`, `monitor`, `network`,
  `package`, `palette`, `panel-right`, `pickaxe`, `play`, `plug`, `puzzle`,
  `rocket`, `route`, `scan`, `scan-search`, `search`, `server`, `settings`,
  `shapes`, `shield`, `smartphone`, `sparkles`, `square-terminal`, `table`,
  `terminal`, `test-tube`, `user`, `users`, `webhook`, `workflow`, `wrench`,
  `zap`

  <!-- end card-icons -->

  The `icon` field is always a choice, so a definition that presets it applies
  to revisions from before their icons too, which draw none. A card whose field
  names any other icon draws none, and the summary bar warns of it
  (`1 unknown icon`, filtering to those cards, its tooltip naming them). A
  changed icon crossfades with the card's step; the diff shows the After icon
  and lists the change with the card's other field changes.

- **Size by** draws a bar along each card's top edge, from its leading corner in
  the card's color, as long as the square root of a numeric field's share of the
  largest value, so the heavy parts of a graph stand out while every card keeps
  one width and the cards line up in columns. The number itself, compact
  (`12K`), is at the right of the card's kind line, and the legend says what the
  bar means (`Top bar: tokens`). A changed value's bar grows or shrinks with its
  card's step.
- **Badges** draws a field's values as small monospace pills under each card's
  label: each item of a list, a string or number itself, and a `true` boolean as
  the field's name. The card grows a row for each row of badges.
- **Labels** draws a field's values the same way in the text font, for words
  rather than code (`property tests`, `on npm`), before the badges.
- **Highlights** draws a field's values first, as semibold labels with a shield
  check in the accent color: the fact to see before any other (how a component
  is formally verified, say).
- **Tags** draws a field's values last, as a quiet line of code without pills
  (where a component runs, say).

In **Diff**, a modified card lists only the data changes it doesn't mark itself
(its size, badges, labels, highlights and tags show their own change), and
counts fields holding objects in one line (`2 more fields changed`); the host's
details show them.

- **Color by** draws a band in a color per value along each card's leading edge:
  its kind, or a field's value (a boolean as the field's name or `not <field>`).
  Cards without the field have no band.
- **Relationships** draws only one kind of relationship (containment is always
  drawn), for a graph whose kinds together are a tangle.
- **Relationship colors** draws each relationship kind in its own color.

Colors come from the theme's categorical palette, never the change colors, and
no card value shares a color with a relationship kind. A field whose every value
names a programming language (`Rust`, `TypeScript`) takes the languages' GitHub
colors instead, as file packing and code statistics do. The host's legend lists
them: the card colors under the field's name (or **Kind**), then a line for each
relationship kind. A field the document doesn't have isn't offered, and the host
says so when the definition presets one.

Every presentation also has the zoom actions **Zoom in**, **Zoom out** and **Fit
to view** (`zoom-in`, `zoom-out`, `zoom-fit`); they are actions, not options, so
they can't be preset. Ctrl/⌘-wheel and pinch zoom in the frame, and the canvas
scrolls to pan.

It presents a comparison in every mode: Diff, where a comparison opens, then
Side by side, Animated and Swipe. `presentation.mode` picks another to open in.

## What a comparison shows

- **Side by side and Swipe**: each pane draws one revision in its own layout.
  While the host highlights changes, each pane marks its side of them in the
  card's footer (`+ Added`, `− Removed`, `~ Modified`, `→ Renamed`, or the
  presentation's own words).
- **Animated**: one graph moves from Before to After in the comparison's steps.
  Removed cards fade, then the layout closes their gap; added cards get room,
  then fade in; arrows come and go with their endpoints and crossfade when
  rewired. Cards keep their layers and order throughout, so nothing passes
  through anything else, and the view never zooms while you scrub: where a
  revision's own layout would move a card or boundary through another, that end
  of the animation keeps the places of the graph with both revisions, and cards
  only fade in or out there. A module emptied by removals stays a boundary.
- **Diff**: one static graph of both revisions. Added cards and arrows are in
  the added color; removed ones stay where they were, dashed and struck through;
  modified cards are amber, with a renamed label or a changed version shown old
  (struck through) then new; an arrow rewired between other cards is drawn
  twice, its old route removed and its new one added. Diff cards show their text
  whole, wrapping instead of ending in an ellipsis. A modified card lists what
  changed in its `data`, each field with its old value struck through and its
  new one (`null` when absent); it shows three, then counts the rest. In
  `infrastructure`, a changed resource's card lists its attribute changes
  instead (down to the setting, `properties.hardwareProfile.vmSize`), what
  forces a replacement first and values known only after apply last. Badges a
  modified card gained are in the added color, and those it lost are struck
  through.

Change marks follow the host's highlighting, so Before, After and highlighting
off draw the graph plain.

The **summary bar** counts each kind, with its changes, in the presentation's
words; kinds it doesn't name take the host's
(`5 components +1 −1 · 3 modules · 4 uses +3 −3`). Every figure filters to its
items. Then the presentation's facts:

- `graph`, `graph-horizontal`, `dag` and `architecture`: the counts alone;
  `precedes` relationships count as dependencies (`6 dependencies`).
- `infrastructure`: resources, data sources, modules and resource groups, then
  the plan in Terraform's order and words, each action with its icon and count
  (`2 to add · 3 to change · 1 to replace · 1 to destroy · 1 to move`, and
  `to import`, `to redeploy`, `to read` and `to forget`). In one revision it
  counts each resource's pending action, as a plan does. Modules and resource
  groups aren't in the plan.
- `dependencies`: workspaces (or projects and target frameworks), packages and
  each kind of dependency (`dev dependency`, `peer dependency`), then, in a
  comparison, upgrades and downgrades by the part of the version that moved
  (`18 major upgrades · 6 minor upgrades · 4 patch upgrades · 1 patch downgrade`),
  packages whose versions can't be ordered (`2 packages changed otherwise`) or
  that were renamed, and how many changed packages are direct dependencies
  (`3 direct dependencies changed`). On the cards a version change reads
  **Upgraded** or **Downgraded**, and in Diff names the bump (**Major upgrade**,
  **Patch downgrade**).

Selecting a card or an arrow selects it in every pane and in the host's table;
the host's details show the change, with the comparator's summary of it when
there is one.

## Start from this definition

<!-- generated: definition -->

```json
{
  "extractor": "workspace-dependencies",
  "id": "workspace-dependencies",
  "renderer": "dependencies",
  "title": "Workspace dependencies"
}
```

<!-- end generated: definition -->

## Screenshot

The `architecture` presentation side by side: `InvoiceService` arrives in the
`invoicing` module with its new dependencies.

![The architecture presentation side by side: modules drawn as dashed boundaries, and InvoiceService marked Added in the invoicing module with its new arrows](../../images/comparators/moved-components-default.png)

## Limitations

- It draws at most 500 entities. Narrow larger graphs at the extractor (its
  include and exclude inputs, where it has them), or use the host's table.
- Layout is automatic: you can't pin a card or choose its layer, and cards are
  grouped only by containment-only `module`s (`architecture`) or the boundary
  kinds of `infrastructure`.
- Outside Diff, long names end in an ellipsis; the tooltip and the host's
  details have them whole.
- In Diff only `infrastructure` lists a modified card's field changes; the other
  presentations mark the card modified and show its label or version change, and
  the host's details list its fields.
- The join points of `dag` appear only in one revision of an extraction made
  entirely of `job`s.
- `dependencies` orders versions as semantic versions; any other version (a
  commit hash, a tag, a compound range) reads **Modified**.

## Related

- The extractors it draws by default:
  [`workspace-dependencies`](../extractors/workspace-dependencies.md),
  [`cargo-dependencies`](../extractors/cargo-dependencies.md) and
  [`nuget-dependencies`](../extractors/nuget-dependencies.md) (`dependencies`);
  [`terraform-infrastructure`](../extractors/terraform-infrastructure.md) and
  [`azure-what-if`](../extractors/azure-what-if.md) (`infrastructure`);
  [`github-actions-jobs`](../extractors/github-actions-jobs.md) (`dag`);
  [`scip-file-references`](../extractors/scip-file-references.md) (`graph`).
- [`file-packing`](file-packing.md), which also draws `graph/v0`: a containment
  hierarchy as nested circles.
- [`dependency-injection`](dependency-injection.md) and
  [`runtime-policy`](runtime-policy.md), which draw `architecture/v0`
  extractions written in their own vocabularies.
- [The default comparator](../comparators/default.md), which decides the steps
  the animation plays.

## How it works

The [package README](../../../packages/renderers/graph/README.md) covers how one
bundle serves every presentation, and the
[renderer kit guide](../../guides/renderer-kit-graphs.md) the shared graph
canvas, its layout and its routes.

## Build your own

The graph draws every graph the same way: cards, arrows and the layers the
layout chooses. Write your own renderer when the picture should say more:

- **Your own visual language**: swimlanes per team, a map of regions and zones,
  a sequence or state diagram, C4 or BPMN notation, an icon for each kind of
  service.
- **Grouping or placement it doesn't do**: cards grouped by owner or deployment
  unit, layers you choose rather than the layout's, a fixed place for what
  readers look for first.
- **Emphasis from your data**: the critical path, heat by a metric (latency,
  cost, test time), or sizes and colors that carry meaning.

Try the lighter options first. Another presentation may already fit:
`graph-horizontal` for long chains, `architecture` to draw containment as
boundaries (write `module` entities that only `contains` their children). The
controls above and `presentation.mode` set how it opens, and
[`file-packing`](file-packing.md) draws the same `graph/v0` extraction as a
hierarchy. To change which changes come first, or to word each change in your
domain (the host's details show it), add a comparator file.

**In VS Code**, choose **+ New Projection…** in the Projections view, then
**Write a custom extractor, renderer or comparator** › **Custom renderer**, and
pick the built-in extractor it draws. It writes the definition
(`.github/projections/<id>.json`) and a TypeScript, Vite and React renderer
package built on the renderer kit (`.github/projections/<id>/renderer`), and
opens the definition and the projection's tab. Or choose **Ask an agent to write
it** and describe what the projection should show.

**With the CLI**:

```sh
projections init <id> --extractor <extractor> --renderer custom
```

Then, in the renderer package, run `npm install`, then `npm run dev` for a
development server with hot updates, `npm run workbench` to open its scenarios
in the fixtures workbench in a browser, and `npm test` to run the renderer
checks on every scenario. In VS Code an open projection tab uses your
uncommitted definition edits ("Your edits"), and saving the renderer's sources
rebuilds it (in a trusted workspace, while its tab is open, with its `watch` or
`build` script) and reloads the view; the Testing view runs each projection's
checks (`projections check -p <id>`, renderer checks included).
[Develop a renderer](../../guides/develop-a-renderer.md) walks through it; the
[renderer kit guide](../../guides/renderer-kit.md) and the
[renderer kit API](../../reference/renderer-kit.md) cover the graph canvas this
renderer is built from, which yours can use too.
