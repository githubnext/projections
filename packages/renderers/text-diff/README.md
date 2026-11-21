---
description: "Built-in text diff renderer: outputs line by line"
---

# Text diff renderer

`@githubnext/projections-renderer-text-diff` presents captured text outputs,
such as the `command-output` extractor captures, and compares them line by line.
It handles the `text-diff` definition renderer name.

## Extraction shape

`graph/v0` with entities of kind `output` and no relationships:

<!-- prettier-ignore -->
| Field | Meaning |
|---|---|
| `label` | Shown in the output's header, for example the command: in the monospace font for `formatted` output, in the text font (as a title) for `prose` |
| `data.text` | The captured text (required string) |
| `data.presentation` | `formatted` (default: monospace) or `prose` (the text font, at a readable measure); both wrap long lines |

Anything else (another kind, a non-string `text`, an unknown presentation, a
relationship, another schema) is reported as an error. Outputs keep extraction
order; a removed output stays where it was.

## Comparison modes

The renderer declares one comparison mode, `diff`: a host presents a comparison
as one static line diff, never as an animation, side by side or a swipe. A text
output changes line by line, and the classic diff shows that better than any
interpolation between the two texts, or two unaligned columns of plain text.

## Controls

For a comparison with output, the renderer declares one control the host draws,
`textDiffLayout` ("Layout": `split` "Two columns", the default, or `unified`
"One column"); it draws no layout buttons itself. In a frame narrower than
640px, two columns read as one.

## Comparisons

Each output is a titled panel (the kit's `Group`): its label in a header band
inside the panel's edge, then its lines. An extraction shows each output as
plain numbered lines. A comparison shows every output of both revisions in
extraction order. Its header states its status as text (`+ Added`, `− Removed`,
`~ Modified`) in a fixed-width cell at the header's end that every output
reserves, so status never moves the label (a long label ends in an ellipsis,
with the full label as its tooltip), and a removed output's label is struck
through; an output whose text didn't change leaves that cell empty and shows as
plain numbered lines, exactly as in the extraction alone.

- **Two columns**: before on the left, after on the right, each with its own
  line numbers. A changed line sits beside its replacement; a line on one side
  only faces a blank filler row, so unchanged lines stay aligned. Lines wrap
  within their column and the two cells of a row share its height. An added or
  removed output fills one column and leaves the other blank.
- **One column**: a unified diff with old and new line numbers; within each
  change, removed lines come before added ones. Long lines wrap, as in two
  columns, with their markers and line numbers at their first line.

Removed lines are tinted and marked `−`, added lines tinted and marked `+`. When
a removed line pairs with an added one, the words they don't share are tinted
more strongly. Runs of unchanged lines longer than six fold into a "N unchanged
lines" row, keeping three lines of context around each change; activating it
shows them.

Lines are compared with a Myers line diff (`src/diff.ts`, the algorithm in
`src/myers.ts`) after trimming the common prefix and suffix in linear time; a
line's terminator is part of it, so line-ending and final-newline changes show,
annotated. Beyond a work budget the changed middle is shown as wholly replaced,
with a notice. At most 2,000 rows are shown per output.

The host's summary bar, along the bottom of the view, counts the outputs and
then their lines: every line in After, with the lines the diff inserts and
deletes across all outputs, as it marks them
(`4 outputs +1 −1 ~2 · 21 lines +11 −9`; one revision, `21 lines`). The view
draws no summary of its own.

Tints, coloured line numbers, the underline on changed words and the header
status follow the host's `highlighting`: with highlighting off, the diff keeps
its rows, fillers, `−`/`+` markers and layout but loses its tint and status
words.

## Accessibility

Output labels are headings that label their sections, and selection buttons with
`aria-pressed`. Changed lines carry visually hidden "Removed:"/"Added:" text;
markers and line numbers are decorative. Text is never inserted as HTML.
