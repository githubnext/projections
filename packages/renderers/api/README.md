---
description: "Built-in API renderer: exported declarations"
---

# API renderer

`@githubnext/projections-renderer-api` presents exported declarations: one row
per declaration with its label beside its signature (stacked in narrow frames)
and, in a comparison, a change footer across the row. It handles the `api`
definition renderer name.

## Extraction shape

`api/v0` entities, one per declaration. Declaration kinds (`function`, `class`,
`interface`, `method`, …) carry a string `data.signature`; any other entity
shows its kind instead. Relationships are ignored. Rows are listed in ID order;
at most 500 rows are shown, with a notice. A declaration's ID is shown under its
label only when it differs from the label.

Labels, IDs and signatures are code identifiers, drawn in the theme's monospace
font; status words stay in the text font. A long or renamed label ends in an
ellipsis (the full label is its tooltip) only when its column can't fit it.

The host's summary bar counts every declaration, whatever its kind, as one
figure (`36 declarations +10 −1 ~6`); the view draws no summary line.

## Comparison modes

The renderer declares `diff` (the default) and `side-by-side`. It has no
`animated` or `swipe` mode: between two listings, a scrubbed frame would only
pop rows in and out.

- **Diff**: one list of every declaration of both revisions, in ID order, each
  once. A changed declaration states its change as text in its footer
  (`+ Added`, `− Removed`, `~ Modified`, `→ Renamed`) and shows its signature
  diff:
  - an added or removed declaration's signature is one `+` or `−` line;
  - a changed signature that mostly survives is one line with its removed and
    added runs in place; a rewritten one is a removed line above an added line;
  - a relabelled declaration shows its previous label struck out before its
    current one, and a changed ID shows `old → new`.

  Unchanged declarations are drawn exactly as in an unchanged comparison, with
  an empty footer. Every row of a comparison reserves its footer, so status
  appearing or fading never moves a row. With highlighting off the content stays
  (markers, removed and added runs) without change colors or status words.
  Removed runs are always struck out and added runs underlined, so they never
  rest on color alone.

- **Side by side**: each pane lists one revision's declarations; with
  highlighting off, exactly as its extraction alone. While the host highlights,
  each pane marks its side of the changes: footer status, a `−` (before) or `+`
  (after) line for a changed signature, with the runs the other revision lacks
  marked when most of it survives.

## Compatibility

When the comparison was made by the
[`api-compatibility` comparator](../../comparators/api-compatibility), its
`metadata.compatibility` classifies each change; without it nothing below is
drawn and rows are unchanged.

- The host's summary bar counts each level with its glyph and words, breaking
  first (`! 2 breaking changes · ⊕ 5 additive changes · = 1 compatible change`),
  each filtering to its changes, with the name of the rules that classified them
  as its tooltip (`Rules: ApiCompat (default mode), reproduced`). The
  classification's notices stay above the declarations: they qualify every
  level.
- Each changed row's reserved footer states the level after its change status,
  in a column (`~ Modified  ! Breaking`, `+ Added  ⊕ Additive`, `= Compatible`,
  `? Unknown`), fading with the change's emphasis like the status. The reason is
  its tooltip; in the diff it is also a line under the signature
  (`Binary and source: Return type changed from …`), reserved on every
  classified row and hidden with highlighting off, so nothing moves. Side by
  side, the reason is read to assistive technology instead.
- In the diff, breaking changes are listed first, then every other declaration
  in ID order. Side-by-side panes keep each revision's own order.
- The **Breaking only** control (offered only for a classified comparison) lists
  only breaking changes, in both modes.

A breaking level is drawn in the foreground color and bold, its glyph a badge (a
crack cut through a disc) like the change status beside it; the others are muted
outline glyphs. Change colors stay reserved for change status, and every level
is a glyph and a word.

The Compatibility scenarios are real extractions of the projects in each
extractor's `tests/fixtures/compatibility`, regenerated with
`node scripts/fixtures.mjs <ecosystem>…` (see the script for requirements).

## Accessibility

Labels are buttons with `aria-pressed` reflecting the selection. A changed
signature in the diff is read as one sentence naming both revisions; its visual
runs are hidden from assistive technology. Markers are decorative; status words
and labels carry the meaning. Text is never inserted as HTML.
