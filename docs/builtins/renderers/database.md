# Database

This renderer draws a database schema as an entity-relationship diagram—one card
per table, view, and enum, a row for each column and key, and connecting lines
for foreign keys. Across a pull request, it shows at a glance which tables,
columns, keys, and types a migration adds, drops, or alters.

<!-- generated: facts -->

- Name: `database`; also answers to `schema`
- Draws: [`database/v0`](../../reference/schemas/database.md)
- Comparison modes: Diff, Side by side, Animated, Swipe; a comparison opens in
  Diff
- Package: `@githubnext/projections-renderer-database`

<!-- end generated: facts -->

## When to use it

Use it when you want to review schema changes directly from the application's
model (EF Core, Django, Prisma, or Rails) rather than piecing them together from
migration scripts. It makes it easy to spot a column made required, a widened
type, a new foreign key, or a renamed table. It covers one schema at a time and
doesn't include row data, row counts, or query plans.

The renderer also responds to `schema`, an older alias for the same renderer;
the output is identical.

Built-in extractors that use it by default:

<!-- generated: extractors -->

| Built-in extractor                                | Its default `renderer` |
| ------------------------------------------------- | ---------------------- |
| [`efcore-schema`](../extractors/efcore-schema.md) | `database`             |
| [`django-schema`](../extractors/django-schema.md) | `database`             |
| [`prisma-schema`](../extractors/prisma-schema.md) | `database`             |
| [`rails-schema`](../extractors/rails-schema.md)   | `database`             |

<!-- end generated: extractors -->

## What it draws

- **Tables** appear as cards with the table name at the top and one row per
  column underneath. Each column shows the most specific type available (its
  native database type like `varchar(200)` when the extractor provides it),
  followed by `?` if nullable, with the underlying declared type in a tooltip.
  Primary keys sort first, then foreign keys, then the remaining columns
  alphabetically.
- **Keys.** Single-column primary and foreign keys appear inline as `PK` or `FK`
  markers on their column. Composite primary keys, unique keys, indexes, and
  check constraints appear as rows beneath the columns, showing their kind
  (`PK`, `FK`, `UK`, `IX`, `CK`), the columns they cover, and their name when it
  differs from the column list (such as `IX_Users_Email`).
- **Views and enums.** Views render as dashed-outline cards labeled _view_.
  Enums render as cards labeled _enum_ with one row per value, and any column
  typed by an enum connects to it with a dotted line.
- **Foreign keys** connect the dependent column to its referenced column, routed
  cleanly around other cards. Implicit many-to-many relations (as in Prisma)
  link the two table headers without arrowheads. Referenced tables sit on the
  left and dependent tables on the right; if the frame is too narrow, cards
  stack in a single column with links routed along the left edge.
- **Other entities** from the extraction appear as tags beneath the cards.

Names, types, keys, and enum values use a monospace font and never truncate—long
entries wrap onto multiple lines. The diagram opens fitted to the viewport
unless doing so would shrink the smallest text below 8 px, in which case it
opens at 8 px from the top left so you can scroll.

## Options

The host shows one toggle. Set its starting value in
`presentation.rendererOptions`:

| Control       | ID                  | Values                                                        | Default |
| ------------- | ------------------- | ------------------------------------------------------------- | ------- |
| Relationships | `showRelationships` | `true`, `false` (hide the foreign-key and many-to-many links) | `true`  |

You also get **Zoom in**, **Zoom out**, and **Fit to view** (`zoom-in`,
`zoom-out`, `zoom-fit`), which are interactive actions rather than preset
options. Zoom scales the existing layout without reflowing it, and Ctrl/⌘-wheel
and pinch gestures work as well.

All four comparison modes are supported—Diff (the default), Side by side,
Animated, and Swipe. Use `presentation.mode` to open in a different mode.

## What a comparison shows

- **Side by side and Swipe** draw one revision per pane and mark each side's
  changes when the host's highlighting is on.
- **Animated** transitions from Before to After step by step using a consistent
  card width so the viewport never zooms mid-animation. Removed cards, rows,
  links, and tags fade out as the layout closes the gap; added ones fade in as
  room opens. Cards keep their columns and order so new tables don't shuffle
  existing ones, and a column's name and type swap halfway through its step.
- **Diff** renders both revisions in a single static diagram. Added cards and
  rows are green, removed ones are red with struck-through names (and dashed
  outlines and links), and modified cards have an amber border. Each modified
  column or key spells out what changed directly underneath: **Type changed**
  (old type struck through beneath the new one), **Made required** or **Made
  optional**, **Renamed** (old name struck through), **Columns changed**, or
  other changed fields.

Status never relies on color alone. Every card header reserves space for its
status word (`+ Added`, `− Removed`, `~ Modified`, `→ Renamed`), and every row
reserves space for a glyph (`+ − ~ →`) with the full status in its tooltip and
accessible name. Toggling change highlighting never shifts the layout.

The **summary bar** reports counts in schema terms with deltas for tables,
columns, primary keys, foreign keys, indexes, constraints, and enums
(`5 tables +1 · 24 columns +8 ~2`). In a comparison, it also calls out changes
that raw counts don't capture—each acting as a filter—such as
`2 column types changed`, `1 column made required`, `1 column made optional`,
renamed objects (`1 table renamed`), and enum values (`5 enum values +2`, also
counted in single-revision views since enum values live in data rather than as
separate entities).

Tables, enums, columns, keys, key markers, and tags are all selectable; clicking
one highlights it across every pane, selects it in the host's table, and scrolls
it into view.

## Start from this definition

<!-- generated: definition -->

```json
{
  "extractor": "efcore-schema",
  "id": "efcore-schema",
  "inputs": {
    "project": "src/App/App.csproj"
  },
  "renderer": "database",
  "title": "EF Core schema"
}
```

<!-- end generated: definition -->

## Limitations

- It reflects the application's model rather than the live database, so
  database-only objects like triggers, stored procedures, and grants don't
  appear.
- Unrecognized key kinds fall back to tags, and foreign keys must use
  `foreign-key` or `relation` relationships to render as links.
- Layout is fully automatic; you can't pin tables or group them by database
  schema or module.
- Large schemas open at the 8 px minimum text size rather than fitted to the
  viewport, so you scroll to inspect the rest.

## Related

- Default extractors: [`efcore-schema`](../extractors/efcore-schema.md),
  [`django-schema`](../extractors/django-schema.md), and
  [`prisma-schema`](../extractors/prisma-schema.md).
- The [`database/v0` schema](../../reference/schemas/database.md).
- [`graph`](graph.md) — for relationships beyond foreign keys.
- [The default comparator](../comparators/default.md) — determines the step
  order for animations.

## How it works

See the [package README](../../../packages/renderers/database/README.md) for
details on the extraction shape, layout algorithm, and transitions.

## Build your own

The database renderer draws a standard ERD. Build a custom renderer when your
team needs a different perspective on the schema:

- **Another notation** — crow's-foot cardinality, UML class diagrams, or nested
  collections for a document database.
- **Custom grouping or overlays** — tables grouped by schema, bounded context,
  or owning service; highlights for tables locked or rewritten by a migration;
  or row counts and table sizes from your own inventory.
- **Migration steps instead of model state** — the ordered operations a
  migration executes, calling out steps that need a backfill or downtime.

Check the lighter options first. Turning **Relationships** off gives you a clean
table-only view, and `presentation.mode` lets you choose the opening comparison
mode. To flag risky schema changes (such as a dropped column or narrowed type),
add a comparator file—its summaries surface in the host's details panel, and its
ordering controls which steps animate first.

**In VS Code**, select **+ New Projection…** in the Projections view, choose
**Write a custom extractor, renderer or comparator** › **Custom renderer**, and
pick the built-in extractor it draws. VS Code scaffolds the definition
(`.github/projections/<id>.json`) and a TypeScript, Vite, and React renderer
package built on the renderer kit (`.github/projections/<id>/renderer`), then
opens both the definition and the projection tab. You can also choose **Ask an
agent to write it** and describe what you want shown.

**With the CLI**:

```sh
projections init <id> --extractor prisma-schema --renderer custom
```

Inside the generated renderer package, run `npm install`, then use `npm run dev`
for a hot-reloading dev server, `npm run workbench` to preview your scenarios in
the browser, and `npm test` to run renderer checks across every scenario.

In VS Code, an open projection tab picks up your uncommitted definition edits
("Your edits"), and saving renderer source files automatically rebuilds and
reloads the view in a trusted workspace (using its `watch` or `build` script).
Run projection and renderer checks from the Testing view or via
`projections check -p <id>`. For a full walkthrough, see
[Develop a renderer](../../guides/develop-a-renderer.md), the
[renderer kit guide](../../guides/renderer-kit.md), and the
[renderer kit API](../../reference/renderer-kit.md).
