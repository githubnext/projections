---
description: "Built-in code-statistics renderer: per-language counts"
---

# Code-statistics renderer

`@githubnext/projections-renderer-code-statistics` presents per-language line
counts (`metrics/v0` entities with numeric `data.code`, `comment`, `blank`,
`lines` and `files`), or a comparison of two, as bars or a share donut. It
handles the definition renderer name `code-statistics` and is built with the
[renderer kit](../kit/README.md).

A `metrics/v0` extraction with none of those counts is a set of generic
measurements (`genericMetrics` from the SDK): each row is an entity's
`data.value`, worded in its `data.unit`, in categorical colors chosen to stay
apart (`categoryPalette`'s `distinct`), rather than Linguist colors. Only the
`chart` control is declared; the grouping is the rows' shared kind
(`methods by scope`), and the summary bar's total appears only when every row
shares one unit, as a noun (`46 methods +3`). The `scopes` scenario is an
example.

## Controls

The renderer draws no settings controls of its own. It declares these
(`codeStatisticsControls` from the kit) and the host draws them, sending the
values in `options`; invalid values fall back to the default:

<!-- prettier-ignore -->
| Control | Values | Default |
|---|---|---|
| `measure` | `code`, `comment`, `blank`, `lines`, `files` (by language only) | `code` |
| `chart` | `bars`, `share` | `bars` |
| `scope` ("Files", offered when the extraction counts tests) | `all`, `tests` (`testFiles`, `testCode`, …) or `other` (the total minus tests) | `all` |
| `byLanguage` (toggle) | `true` for one row per language, `false` for the code/comment/blank composition | `true` |

## Legend

In the share chart, the host draws the colour key once beside every pane
(`Languages`, or `Line kinds` for the composition): one item per row, with the
same color the slice paints (a language's color, or a `chart-n` token) and the
latest revision's label. Beside the donut the frame lists each row's count and
delta as content, not a legend, so it has no swatches. The bars are labelled
inline and send no legend. The key follows the controls (measure, files,
grouping) and never changes while scrubbing.

## Timeline

The comparison decides the order: each language changes in its own step on the
kit's schedule (with the kit's holds between steps), and the renderer reports
the step ends to the host. Inside its step an arriving language opens its slot,
fades in empty, then grows; a departing one shrinks to empty, fades, then closes
its slot; a resized one eases between its counts. Every phase follows the kit's
shared `ease` (the quintic curve graph layouts move on): bar widths, hatched
gains and losses, donut slices, counts and percentages (eased, then rounded) and
slot heights all start and stop softly. A custom comparator's order (for example
the `priority-order` example) changes which language moves first, and an
explicit reverse order is followed backward.

Every language either revision has keeps its row for the whole transition: a
leaving row shrinks its own slot so the rows below glide up, and order and
colour depend only on the larger of the two counts.

Languages take their GitHub Linguist colors through the kit's `categoryPalette`,
the same as file packing: TypeScript is Linguist's blue in both. Rows Linguist
gives no color (data and prose such as JSON, YAML and Markdown, or names it
doesn't know) take categorical colors, ranked over both revisions so a row keeps
one color through the whole transition; the composition's parts are `chart-1` …
`chart-3`. A comparison's endpoints can therefore color such a row differently
from that revision rendered alone. Bars and slices carry
`data-projections-category` (the language's ID), so the built-in
`neutral-endpoints` check reads them as categories and checks that each keeps
one colour, rather than comparing with a single revision's ranking. The share
chart's centre and the composition view add up each language's own count, so
they follow the steps too. The total itself is in the host's summary bar, along
the bottom of every view, beside the languages: the measure's total in After,
worded by the Measure and Files controls, with its change in a comparison
(`11 languages +2 −1 ~8 · 39,882 lines of code +2,056`,
`770 lines of code in tests +290`). The view draws no header or summary line.
Each bar row and legend entry ends in a fixed-width status cell (`~ Modified`,
`+ Added`…), and counts and deltas keep fixed columns, so nothing moves when
status or a delta appears; slices name their status in their accessible name.

Each bar is one continuous shape in its language's colour, rounded only at its
outer ends. While its change is emphasized, the lines gained so far are the same
colour under a light hatch inside the bar, and the lines lost so far are a
neutral hatched ghost with a dashed edge, flush with the bar's end; the bar
grows or shrinks through them. In the share chart the end of a changed slice is
hatched the same way, with no separate rim. Hatches, status and signed deltas
use the host's `highlighting`, so both endpoints are plain. Bars share one
zero-anchored scale across both revisions. At most 24 rows are drawn; numbers
use the host's locale.

## Diff mode

The renderer declares every comparison mode (`side-by-side`, `animated`, `swipe`
and `diff`). In diff mode it draws one static frame of both revisions in the
same form the controls choose:

- The host's summary bar, not the frame, states the total and the languages
  added, removed and modified
  (`5 languages +1 −1 ~2 · 2,700 lines of code +460`).
- Bars: every language of either revision keeps one row, ordered as in the
  transition. Each shows the Before count struck through, the After count and
  the signed change in fixed columns, and its status in words. The row is marked
  with the kit's `pk-region` in its change's hue: added green, removed red (with
  its name struck through, in place), modified amber. Inside the bar, the lines
  gained are hatched and edged in the added hue, and the lines lost are a dashed
  ghost in the removed hue where the Before bar ended.
- Share: paired rings, After outside and Before inside, so a removed language
  keeps its slice in the inner ring and an added one has only an outer slice
  (each edged in its change's hue). The marked rows beside them list both counts
  and the change.
- Composition: each line kind with both counts, marked modified when it changed.

Marks follow the host's highlighting (`--emphasis`), so with highlighting off
the frame draws plain while keeping both counts and every row.

## Development

```sh
npm run build -w @githubnext/projections-renderer-code-statistics
npm test -w @githubnext/projections-renderer-code-statistics
# Dense scrubbing in the real host frame (Chromium and WebKit, desktop and mobile)
npm run test:browser -w @githubnext/projections-renderer-harness -- code-statistics/
```

`test/fixtures/` holds synthetic before/after pairs of plain protocol-v0
extractions (`languages`, `gateway`; see `test/fixtures.mjs`), and
`test/invariants.mjs` exports frame checks (`measureRenderedFrame`,
`checkRenderedFrame`, `checkFrameSequence`) shared with browser scrubbing tests.
