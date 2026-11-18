# Database

A database schema as an entity-relationship diagram: a card per table, view and
enum, a row per column and key, and a link for each foreign key. Compared across
a pull request, it answers "which tables, columns, keys and types did this
migration add, drop or change?"

<!-- generated: facts -->

- Name: `database`; also answers to `schema`
- Draws: [`database/v0`](../../reference/schemas/database.md)
- Comparison modes: Diff, Side by side, Animated, Swipe; a comparison opens in
  Diff
- Package: `@githubnext/projections-renderer-database`

<!-- end generated: facts -->

## When to use it

Use it to review schema changes from the model the application defines (EF Core,
Django, Prisma, Rails) rather than from migration scripts: a column made
required, a type widened, a foreign key added, a table renamed. It draws one
schema at a time; data, row counts and query plans aren't part of it.

The renderer also answers to `schema`, an older name for the same renderer: it
draws exactly the same.

Built-in extractors that draw with it by default:

<!-- generated: extractors -->

| Built-in extractor                                | Its default `renderer` |
| ------------------------------------------------- | ---------------------- |
| [`efcore-schema`](../extractors/efcore-schema.md) | `database`             |
| [`django-schema`](../extractors/django-schema.md) | `database`             |
| [`prisma-schema`](../extractors/prisma-schema.md) | `database`             |
| [`rails-schema`](../extractors/rails-schema.md)   | `database`             |

<!-- end generated: extractors -->

## What it draws

- **Tables** are cards: the table's name, then a row per column with its type. A
  column shows the most specific type it states (its native database type, such
  as `varchar(200)`, when the extractor knows it), with `?` when it's nullable;
  the declared type behind a native one is in its tooltip. Primary keys come
  first, then foreign keys, then the rest by name.
- **Keys**: a single-column primary key or foreign key is its column's `PK` or
  `FK` marker. Every other key (a composite primary key, a unique key, an index,
  a check) is a row under the columns: its kind (`PK`, `FK`, `UK`, `IX`, `CK`),
  the columns it covers, and its own name when it isn't just those
  (`IX_Users_Email`).
- **Views** are cards with a dashed outline, labelled _view_; **enums** are
  cards labelled _enum_, with a row per value, and a column typed by an enum
  links to it with a dotted line.
- **Foreign keys** link the dependent column to the column it references, routed
  around other cards. A many-to-many relationship (Prisma's implicit relations)
  links the two tables' headers, with no arrowhead. Referenced tables sit on the
  left and dependent tables on the right; when that doesn't fit the frame's
  width, cards stack in one column and links run along the left.
- Anything else the extraction has is a tag under the cards.

Names, types, keys and values are code, in the monospace font, and are never cut
short: where a card can't fit them on one line they wrap. The schema opens
fitted, everything in view, unless that would draw its smallest text below 8 px;
then it opens at that size, at its top left, and you scroll for the rest.

## Options

The host draws one control; set its starting value in the definition's
`presentation.rendererOptions`:

| Control       | ID                  | Values                                                        | Default |
| ------------- | ------------------- | ------------------------------------------------------------- | ------- |
| Relationships | `showRelationships` | `true`, `false` (hide the foreign-key and many-to-many links) | `true`  |

It also has the zoom actions **Zoom in**, **Zoom out** and **Fit to view**
(`zoom-in`, `zoom-out`, `zoom-fit`), which are actions, not options; zoom scales
the laid-out schema without reflowing it, and Ctrl/⌘-wheel and pinch zoom too.

It presents a comparison in every mode: Diff, where a comparison opens, then
Side by side, Animated and Swipe. `presentation.mode` picks another to open in.

## What a comparison shows

- **Side by side and Swipe**: each pane draws one revision; while the host
  highlights changes, each marks its side of them.
- **Animated**: the schema moves from Before to After in the comparison's steps,
  laid out with one card width so the frame never zooms. Leaving cards, rows,
  links and tags fade as the layout closes their gap; arrivals fade in as it
  opens room. Cards keep their columns and order, so an added table inserts
  without reordering the others, and a column's name and type switch halfway
  through its own step.
- **Diff**: one static schema holding both revisions, laid out once. Added cards
  and rows are green; removed ones are red with their names struck through (a
  removed card and its links dashed); changed cards are amber-edged. A changed
  column or key lists each change under it, in words from its data: **Type
  changed** (its old type struck through under the new one), **Made required**
  or **Made optional**, **Renamed** (its old name struck through), **Columns
  changed**, or the other fields that changed.

Status is never color alone: each card's header ends in its status word
(`+ Added`, `− Removed`, `~ Modified`, `→ Renamed`), each row in a glyph
(`+ − ~ →`) with the word as its tooltip and for assistive technology. The space
is reserved, so status appearing never moves anything, and marks follow the
host's highlighting.

The **summary bar** counts the schema in its own words, with each kind's
changes: tables, columns, primary keys, foreign keys, indexes, constraints and
enums (`5 tables +1 · 24 columns +8 ~2`). Then, in a comparison, what the counts
can't say, each filtering to its rows: `2 column types changed`,
`1 column made required`, `1 column made optional`, tables, views, enums,
columns and keys renamed (`1 table renamed`), and enum values, which are data
rather than entities (`5 enum values +2`, counted in one revision too).

Tables, enums, columns, keys, key markers and tags are each selectable;
selecting one selects it in every pane and in the host's table, and scrolls it
into view.

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

- It draws the schema the model defines, not the database: objects the model
  doesn't know (triggers, stored procedures, grants) aren't there.
- Key kinds it doesn't know become tags, and foreign keys must be `foreign-key`
  or `relation` relationships to be drawn as links.
- Layout is automatic: you can't place a table or group tables by schema or
  module.
- A large schema opens at the 8 px floor rather than fitted, so you scroll to
  see all of it.

## Related

- The extractors it draws by default:
  [`efcore-schema`](../extractors/efcore-schema.md),
  [`django-schema`](../extractors/django-schema.md) and
  [`prisma-schema`](../extractors/prisma-schema.md).
- The [`database/v0` schema](../../reference/schemas/database.md).
- [`graph`](graph.md), for relationships beyond foreign keys.
- [The default comparator](../comparators/default.md), which decides the steps
  the animation plays.

## How it works

The [package README](../../../packages/renderers/database/README.md) covers the
extraction shape it reads, its layout and its transitions.

## Build your own

The database renderer draws a classic ERD. Write your own renderer when your
team reads its schema another way:

- **Another notation**: crow's-foot cardinality, UML class diagrams, or a
  document database's nested collections.
- **Grouping or emphasis it doesn't do**: tables grouped by schema, bounded
  context or owning service; the tables a migration locks or rewrites
  emphasized; row counts or sizes from your own inventory.
- **The migration, not the model**: the ordered operations a migration runs,
  with the ones that need a backfill or downtime called out.

Try the lighter options first. **Relationships** off draws just the tables, and
`presentation.mode` sets the mode a comparison opens in. To say which schema
changes are risky (a dropped column, a narrowed type), add a comparator file:
its summaries reach the host's details, and its order changes which step the
animation plays first.

**In VS Code**, choose **+ New Projection…** in the Projections view, then
**Write a custom extractor, renderer or comparator** › **Custom renderer**, and
pick the built-in extractor it draws. It writes the definition
(`.github/projections/<id>.json`) and a TypeScript, Vite and React renderer
package built on the renderer kit (`.github/projections/<id>/renderer`), and
opens the definition and the projection's tab. Or choose **Ask an agent to write
it** and describe what the projection should show.

**With the CLI**:

```sh
projections init <id> --extractor prisma-schema --renderer custom
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
[renderer kit API](../../reference/renderer-kit.md) cover the pieces.
