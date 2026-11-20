# Code statistics

This renderer shows how much code a repository has in each language, either as
bars, a share donut, or a sortable table. You can break down code, comment, and
blank lines, total lines, or file counts—across the whole repository or for
tests alone. Across a pull request, it answers a simple question: "how much code
did this change add or remove, and in which languages?"

<!-- generated: facts -->

- Name: `code-statistics`
- Draws: [`metrics/v0`](../../reference/schemas/metrics.md)
- Comparison modes: Diff, Side by side, Animated, Swipe; a comparison opens in
  Diff
- Package: `@githubnext/projections-renderer-code-statistics`

<!-- end generated: facts -->

## When to use it

Use this renderer to gauge the size and language mix of a change at a glance—for
example, a migration from JavaScript to TypeScript, a new service in another
language, or whether tests are keeping pace with production code. It only counts
lines and files; it doesn't show what the code does or where it lives in the
tree. For file locations, use [`file-packing`](file-packing.md), which shares
the same language colors.

Built-in extractors that use it by default:

<!-- generated: extractors -->

| Built-in extractor                                    | Its default `renderer` |
| ----------------------------------------------------- | ---------------------- |
| [`code-statistics`](../extractors/code-statistics.md) | `code-statistics`      |

<!-- end generated: extractors -->

## What it draws

Each entity in a `metrics/v0` extraction (one per language when using the
`code-statistics` extractor) gets a row, ordered largest first:

- **Bars** draw each language's count as an inline-labeled bar in its language
  color, all on a shared scale.
- **Share** draws a donut chart of each language's share with counts and deltas
  listed beside it, while the host renders a single color key alongside the
  view.
- **Table** puts one language per row and one count per column (files, code,
  comments, blank, and all lines), sorted by largest code count by default.
  Click a column heading or use **Sort by** in settings to sort either way, and
  toggle **Changes first** to float changed languages to the top. In a
  comparison, each language keeps its row position throughout the transition and
  changed counts appear as was/now pills. The language column stays pinned when
  scrolling horizontally, and **Measure** and **By language** do not apply here.
- **Composition** (when **By language** is off) collapses the view into three
  rows for code, comment, and blank lines instead of breaking them down by
  language.

Languages use their standard GitHub colors (such as TypeScript blue), matching
`file-packing`. Languages without an official GitHub color (like JSON, YAML, or
Markdown) draw from the theme's categorical palette, and every language keeps
the same color from Before to After. At most 24 rows are rendered (with a notice
if more exist), and numbers follow your locale.

**Generic measurements.** If a `metrics/v0` extraction doesn't include line or
file counts (no entity has `data.code`, `lines`, or `files`), the renderer
switches to plain measurements: one bar per entity using `data.value` and
labeled with `data.unit` (for example, `projects:read 17 methods`), colored with
distinct categorical hues. Only the **Chart** control is shown. The summary bar
totals the rows when they share a unit (`46 methods +3`) and omits a total when
units differ. Because bars start at zero, this works well for any nonnegative
count—methods per access scope, endpoints per service, or open issues per team.

## Options

The host provides these controls; you can set their starting values in
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

There is no zoom. All four comparison modes are supported—Side by side,
Animated, Swipe, and Diff—and `presentation.mode` sets which one opens by
default.

## What a comparison shows

- **Side by side and Swipe** render each revision in its own pane on a shared
  scale.
- **Animated** updates one language per step in the comparison's order. Added
  languages open a row and grow in, removed languages shrink to zero and close,
  and resized bars ease smoothly between counts. While a change is highlighted,
  added lines appear hatched inside the bar and removed lines appear as a
  dashed, hatched ghost at the end.
- **Diff** combines both revisions into one static frame. Each bar row lists the
  Before count struck through, the After count, and the signed delta in fixed
  columns along with its status in words. Rows are marked green when added, red
  (with a struck-through name) when removed, and amber when modified; inside the
  bar, gained lines are hatched in the added color and lost lines show as a
  dashed ghost in the removed color. In Share view, the donut becomes two
  concentric rings—After on the outside and Before on the inside—so removed
  languages keep their inner slice.

Every row reserves fixed-width columns for counts and its status cell
(`+ Added`, `− Removed`, `~ Modified`), so toggling change marks never shifts
the layout. All marks follow the host's highlighting toggle.

The **summary bar** shows the language count with its changes, followed by the
After total worded according to **Measure** and **Files** along with its delta:
`11 languages +2 −1 ~8 · 39,882 lines of code +2,056`, or with **Files** set to
Tests, `770 lines of code in tests +290`. In composition view, the total counts
every line (`52,104 lines`).

Selecting a row or donut slice highlights that language across every pane and in
the host's table.

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

- It only counts lines and files per language; it doesn't show where they sit in
  the tree, who changed them, or how complex the code is.
- At most 24 rows are drawn; check the host's table for the full list of
  languages.
- The **Files** filter requires an extraction that counts test files separately
  (`testCode`, `testFiles`, and similar fields), as `code-statistics` does.

## Related

- [`code-statistics`](../extractors/code-statistics.md) — the default extractor,
  which determines which files count as tests.
- [`file-packing`](file-packing.md) — shares the same language colors.
- The [`metrics/v0` schema](../../reference/schemas/metrics.md).
- [The default comparator](../comparators/default.md) — controls which language
  moves first; setting `order.by: data.code` puts the largest first.

## How it works

See the [package README](../../../packages/renderers/code-statistics/README.md)
for details on the animation timeline, colors, and diff view.

## Build your own

Code statistics compares languages by size. Build a custom renderer when you
want to read those numbers differently:

- **A different grouping** — by package, service, or owning team instead of
  language, or test code paired directly beside the code it tests.
- **Trends over time** — line counts across many revisions, or a burn-down chart
  tracking a migration, rather than a two-revision comparison.
- **Custom thresholds or callouts** — a target test-to-production ratio, a
  retiring language called out explicitly, or limits that flag a change in red.

Check the lighter options first. **Files**, **Measure**, **By language**, and
**Chart** (via `presentation.rendererOptions`) already cover several views of
the same data, and `presentation.mode` sets the opening comparison mode. Because
this renderer accepts any `metrics/v0` extraction, an extractor that emits one
row per package with the same counts gets per-package bars out of the box—and
one emitting `data.value` and `data.unit` gets bars for any measurement. To
control which row animates first, set `order.by` on the default comparator.

**In VS Code**, select **+ New Projection…** in the Projections view, choose
**Write a custom extractor, renderer or comparator** › **Custom renderer**, and
pick the built-in extractor it draws. VS Code scaffolds the definition
(`.github/projections/<id>.json`) and a TypeScript, Vite, and React renderer
package built on the renderer kit (`.github/projections/<id>/renderer`), then
opens both the definition and the projection tab. You can also choose **Ask an
agent to write it** and describe what you want shown.

**With the CLI**:

```sh
projections init <id> --extractor code-statistics --renderer custom
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
[renderer kit API](../../reference/renderer-kit.md)—including the
code-statistics controls and language palette this renderer uses.
