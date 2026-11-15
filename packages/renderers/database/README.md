---
description: "Built-in database renderer: relationship-aware ERD cards"
---

# Database renderer

`@githubnext/projections-renderer-database` presents `database/v0` extractions
and comparisons as relationship-aware ERD cards. It handles the definition
renderer names `database` and `schema` (the prototype's name).

## Extraction shape

<!-- prettier-ignore -->
| Entity kind | Presented as | Data |
|---|---|---|
| `table` | A card | |
| `view` | A card with a dashed outline, labeled *view* | |
| `column` | A row of the table that `contains` it (any relationship from a table to a column) | `type` (required), `databaseType`, `nullable` |
| `enum` | A card, labeled *enum*, with a row per value; a column typed by it (any relationship from the column to the enum) links to it with a dotted line | `values` (strings or `{name}`) |
| `primary-key`, `index`, EF Core's `unique-key` and `check-constraint`, or `constraint` with `data.type` (`primary-key`, `foreign-key`, `unique`, `index`, `check`) | Part of its table (below) | `columns` or Prisma's `fields` (column names), optional `table` |
| anything else | A tag under the cards | |

Keys and indexes belong to their table: the table that holds them (a
relationship from the table), else `data.table`, else the table of the columns
they constrain. A single-column primary key or foreign-key constraint is its
column's `PK` or `FK` marker, which is selectable as that constraint and takes
its status. Every other key (a composite primary key, a unique, an index, a
check) is a row of its table's card, under the columns and ruled off from them:
its kind (`PK`, `FK`, `UK`, `IX`, `CK`), the columns it covers, and its own name
when it isn't just its kind and columns (`loan_member_due`, `IX_Users_Email`). A
column in a composite primary key that is also a foreign key is marked `FK`; the
composite key has its own row. Only keys of no table, and kinds the renderer
doesn't know, are tags: centered, in balanced lines.

A column shows the most specific type it states: its native database type
(`databaseType`, such as `varchar(200)`) when the extractor knows it, otherwise
`type`, with `?` when nullable; the declared type behind a native one (Django's
`CharField`) is in its tooltip. Types are identifiers, in the theme's monospace
font. So a change like `varchar(120)` to `varchar(200)` reads as a type change,
and a changed column's status word for assistive technology and its tooltip add
it (`Modified, type varchar(120) to varchar(200)`).

Foreign keys are `foreign-key` or `relation` relationships, either column to
column, or table to table with `data.columns` and `data.principalColumns`
(column labels). A key column with `data.primaryKey: true` is also a primary
key. A `many-to-many` relationship between two tables (Prisma's implicit
relations) links their headers with no arrowhead, since neither table depends on
the other. Columns order primary keys first, then foreign keys, then by name.

Every name, type, key and value is data and shows whole; nothing in the renderer
ellipsizes it. Text is measured in the fonts it is drawn with (a canvas reads
the computed font of each kind of text), and cards are as wide as their widest
header (name, kind label and the room for the status words that card can show;
none when the comparison doesn't change it) and row on one line, up to 440px,
where the frame has room. Where it doesn't, text wraps: first after
`_ . / - , :` or a space, then at case and digit changes, then between
characters; a row's second part (a column's type, a key's name) goes under the
first, a header's kind and status go under its name, and the row or header grows
to fit. The view draws exactly the lines the layout counted.

Tables rank from referenced (principal) tables on the left to dependent tables
on the right, and each foreign key links its dependent row to the principal row,
routed around any card it would cross. When the ranks don't fit the frame's
width, cards stack in one column and links run in lanes along the left gutter.
The schema, with its keys and indexes, opens fitted to the frame (scaled down to
fit both dimensions) and centred, unless that draws its text below the kit's 8
px opening floor: then it opens at the floor, at its top left, and scrolls. Zoom
in enlarges it and Fit to view returns to all of it.

## Comparisons

Changes follow the comparison's steps. The state before the first step and after
each step is laid out with one shared card width and layout mode, so the frame
never zooms. Columns are ranked once over every stage, and each stage keeps the
cards the next one shows in that one's order, so cards keep their relative
columns and order from Before to After: an added card inserts without reordering
the others. Within a step, leaving cards, rows (columns, keys and enum values
alike), links and tags fade as the layout closes their gap, and arrivals fade in
as it opens room, inside their own card. A row that changes order (for example a
column that becomes a foreign key) fades out, lets its neighbours close and open
the gap, and fades in at its new place rather than sliding through them. Links
never outlast their cards or rows. A column's label and type switch halfway
through its own step.

Change status is text in reserved space, never color alone, reserved at all
times so nothing moves when it appears: each table header ends in a status cell
with the word (`+ Added`, `− Removed`, `~ Modified`, `→ Renamed`); each column,
key and value row ends in a two-character glyph cell (`+ − ~ →`), with the word
for assistive technology and as its tooltip, so types keep nearly all their room
(a column whose own marker constraint changed shows that change); and each free
tag has a status tab under it. Rows of a wholly added or removed table share
their table's status (screen readers still hear each row's). Leaving links are
dashed while emphasized. Status text, link colors and tag tints use only the
host's change highlighting, so nothing looks changed at either endpoint or for a
single extraction.

## Diff mode

The renderer declares all four comparison modes; `diff` draws one static schema
holding both revisions. Every card, row, key, enum value, link and tag of either
revision is laid out once with the same ERD layout (survivors in their After
version, removed ones in their Before version where they were; an enum card
holds the values of both), so nothing overlaps. Changes are marked in place with
the kit's change marks: added cards and rows are green, removed ones red with
their names struck through (a removed card and its links dashed), and changed
cards amber-edged. A changed column or key takes a row slot under it per change,
in words from its data: `Type changed` (its old type struck through under the
new one), `Made required` or `Made optional` (its `nullable` going from `true`
to `false` or back), `Renamed` (its old name struck through), `Columns changed`,
or the names of its other changed fields. Rows keep their status glyph, with the
word for assistive technology.

The host's summary bar, along the bottom of every view, counts the schema in its
own words: tables, columns, primary keys, foreign keys (`foreign-key` and
`relation` relationships alike), indexes, constraints and enums, each with its
changes in a comparison (`5 tables +1 · 24 columns +8 ~2`). The relationships
that only attach a row to its table, or a key to the table it references, are
structure, not figures. Then what the counts can't say, each filtering to its
rows: columns of tables in both revisions whose type changed or that were made
required or optional, tables, views, enums, columns, keys and other entities
renamed, and the enums' values, which are data rather than entities
(`2 column types changed · 5 enum values +2`; the values in one revision too).
The view draws no summary line. Every tint follows the host's highlighting, so
with highlighting off the diff draws plainly in the same boxes.

## Options and accessibility

- The host-drawn zoom actions (the kit's `zoomControls`): Zoom in enlarges the
  fitted schema, Fit to view returns to it, and Zoom out stops there;
  Ctrl/⌘-wheel and pinch zoom too, and a zoomed schema scrolls. Zoom scales the
  laid-out schema, so it never reflows it.
- The host-drawn `showRelationships` toggle ("Relationships", on by default)
  hides foreign-key links and reclaims the stacked gutter.
- Tables, enums, columns, keys, key markers and tags report selection; the
  host's selection is shown and scrolled into view; Escape clears it. Key roles
  carry text for assistive technology, not only color.

## Fixtures

`fixtures/prisma-shop-{before,after}.json` and
`fixtures/django-library-{before,after}.json` are real extractions by
`prisma-schema` and `django-schema` of the small projects in
`fixtures/prisma-shop/` and `fixtures/django-library/`, regenerated with
`node packages/renderers/database/fixtures/make-schemas.mjs --python <python with Django>`.
`fixtures/invoicing-*.json` are EF Core–shaped synthetic extractions.
