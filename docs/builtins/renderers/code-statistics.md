# Code statistics

How much code a repository has in each language, as bars or as each language's
share: code, comment and blank lines, all lines, or files, for every file or
only tests. Compared across a pull request, it answers "how much code did this
change add or remove, and in which languages?"

<!-- generated: facts -->

- Name: `code-statistics`
- Draws: [`metrics/v0`](../../reference/schemas/metrics.md)
- Comparison modes: Diff, Side by side, Animated, Swipe; a comparison opens in
  Diff
- Package: `@githubnext/projections-renderer-code-statistics`

<!-- end generated: facts -->

## When to use it

Use it to see the size and mix of a codebase change at a glance: a migration
from JavaScript to TypeScript, a new service in another language, tests growing
with the code (or not). It counts lines; it says nothing about what the code
does or where in the tree it lives. For that, use
[`file-packing`](file-packing.md), which colors each language the same way.

Built-in extractors that draw with it by default:

<!-- generated: extractors -->

| Built-in extractor                                    | Its default `renderer` |
| ----------------------------------------------------- | ---------------------- |
| [`code-statistics`](../extractors/code-statistics.md) | `code-statistics`      |

<!-- end generated: extractors -->

## What it draws

One row per entity of the `metrics/v0` extraction (a language, in the
`code-statistics` extractor's), largest first:

- **Bars**: each language's count as a bar in its language's color, labelled
  inline, all on one scale.
- **Share**: a donut of each language's share, with each row's count and change
  listed beside it; the host draws the color key once, beside the view.
- **Table**: a row per language and a column per count (files, code, comments,
  blank and all lines), largest code first. Activate a column's heading, or
  choose **Sort by** in the settings, to sort by it either way; **Changes
  first** puts the languages a comparison changed first. In a comparison each
  language keeps one place for the whole transition, and changed counts show as
  was/now pills. The language column stays in view when the table scrolls
  sideways. **Measure** and **By language** don't apply.
- **Composition** (**By language** off): code, comment and blank lines as three
  rows instead of one per language.

Languages take their GitHub colors (TypeScript blue), the same as in
`file-packing`; languages GitHub gives no color (JSON, YAML, Markdown) take the
theme's categorical colors, and every language keeps one color from Before to
After. At most 24 rows are drawn, with a notice; numbers use your locale.

**Generic measurements.** A `metrics/v0` extraction without line or file counts
(no entity has `data.code`, `lines` or `files`) is drawn as plain measurements:
one bar per entity of its `data.value`, labelled with its `data.unit`
(`projects:read 17 methods`), in categorical colors chosen to stay apart. Only
**Chart** is offered. The summary bar totals the rows when they share a unit
(`46 methods +3`), and states no total when they don't. Bars start at zero, so
use it for counts and other nonnegative measurements: methods per access scope,
endpoints per service, open issues per team.

## Options

The host draws these controls; set their starting values in the definition's
`presentation.rendererOptions`:

<!-- prettier-ignore -->
| Control | ID | Values | Default |
|---|---|---|---|
| Files | `scope` | `all` (All files), `tests` (Tests), `other` (Non-tests); offered when the extraction counts test files | `all` |
| Measure | `measure` | `code` (Code), `comment` (Comments), `blank` (Blank), `lines` (All lines), `files` (Files); what each language row counts | `code` |
| By language | `byLanguage` | `true` (one row per language), `false` (the code, comment and blank composition) | `true` |
| Chart | `chart` | `bars` (Bars), `share` (Share), `table` (Table) | `bars` |
| Sort by | `sort` | `none` (Original order), `<column>:ascending` or `<column>:descending` for `name`, `files`, `code`, `comment`, `blank` and `lines` (`value` and `unit` for generic measurements); offered with the table | `code:descending` (`value:descending`) |
| Changes first | `sortChangesFirst` | `true`, `false`; offered with the table | `false` |

```json
"presentation": {"rendererOptions": {"scope": "tests", "chart": "share"}}
```

It has no zoom. It presents a comparison in every mode: Side by side, Animated,
Swipe and Diff. `presentation.mode` picks the one a comparison opens in.

## What a comparison shows

- **Side by side and Swipe**: each pane draws one revision, on the same scale.
- **Animated**: each language changes in its own step, in the comparison's
  order: an arriving language opens its row, then grows; a departing one shrinks
  to nothing, then closes its row; a resized one eases between its counts. While
  a change is emphasized, the lines gained so far are hatched inside the bar and
  the lines lost are a dashed, hatched ghost at its end.
- **Diff**: one static frame of both revisions. Each bar row shows the Before
  count struck through, the After count and the signed change in fixed columns,
  with its status in words; the row is marked green when added, red (its name
  struck through) when removed and amber when modified, and inside the bar the
  lines gained are hatched in the added color and the lines lost are a dashed
  ghost in the removed color. As a share, the donut is two rings, After outside
  and Before inside, so a removed language keeps its inner slice.

Each row ends in a fixed-width status cell (`+ Added`, `− Removed`,
`~ Modified`), and counts keep fixed columns, so nothing moves when a status or
a change appears. Marks follow the host's highlighting.

The **summary bar** counts the languages, with their changes, then the total of
what the rows count, in After, worded by **Measure** and **Files**, with its
change in a comparison: `11 languages +2 −1 ~8 · 39,882 lines of code +2,056`,
or with **Files** on Tests, `770 lines of code in tests +290`. The composition's
total is every line (`52,104 lines`).

Selecting a row (or a slice) selects its language in every pane and in the
host's table.

## Start from this definition

<!-- generated: definition -->

```json
{
  "extractor": "code-statistics",
  "id": "code-statistics",
  "renderer": "code-statistics",
  "title": "Code statistics"
}
```

<!-- end generated: definition -->

## Limitations

- It counts lines per language: it can't show where in the tree they are, who
  changed them, or their complexity.
- It draws at most 24 rows; the host's table has every language.
- **Files** needs an extraction that counts test files separately (`testCode`,
  `testFiles` and the like), as `code-statistics` does.

## Related

- [`code-statistics`](../extractors/code-statistics.md), the extractor it draws
  by default, which decides which files are tests.
- [`file-packing`](file-packing.md), which shares its language colors.
- The [`metrics/v0` schema](../../reference/schemas/metrics.md).
- [The default comparator](../comparators/default.md), whose order decides which
  language changes first; `order.by: data.code` puts the largest first.

## How it works

The [package README](../../../packages/renderers/code-statistics/README.md)
covers its timeline, colors and diff.

## Build your own

Code statistics compares languages by size. Write your own renderer when the
numbers should be read another way:

- **Another grouping**: by package, service or owning team rather than by
  language, or test code beside the code it tests.
- **Trends**: lines over many revisions, or a burn-down toward a migration's
  end, instead of two revisions side by side.
- **Your own emphasis**: a target ratio of test to production code, a language
  you're retiring highlighted, thresholds that turn a change red.

Try the lighter options first. **Files**, **Measure**, **By language** and
**Chart** (and their `presentation.rendererOptions`) cover many views of the
same counts, and `presentation.mode` sets the mode a comparison opens in. The
renderer draws any `metrics/v0` extraction, so an extractor that writes one row
per package, with the same counts, gets bars per package here as it is, and one
that writes only `data.value` and `data.unit` gets bars of any measurement. To
change which row moves first, set the default comparator's `order.by`.

**In VS Code**, choose **+ New Projection…** in the Projections view, then
**Write a custom extractor, renderer or comparator** › **Custom renderer**, and
pick the built-in extractor it draws. It writes the definition
(`.github/projections/<id>.json`) and a TypeScript, Vite and React renderer
package built on the renderer kit (`.github/projections/<id>/renderer`), and
opens the definition and the projection's tab. Or choose **Ask an agent to write
it** and describe what the projection should show.

**With the CLI**:

```sh
projections init <id> --extractor code-statistics --renderer custom
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
[renderer kit API](../../reference/renderer-kit.md) cover the pieces, including
the code-statistics controls and language palette this renderer uses.
