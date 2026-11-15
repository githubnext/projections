# Projections brand

The Projections mark is a projector seen from the side: a low housing with the
lens raised at the right, and a solid glass center. It is drawn on a 16px grid
as filled, pixel-aligned paths, in the style of GitHub's Octicons, and scales by
whole multiples.

| File                            | Use                                                                                                 |
| ------------------------------- | --------------------------------------------------------------------------------------------------- |
| `projections-mark.svg`          | Single color (`currentColor`): UI chrome, inline with text, tabs.                                   |
| `projections-mark-two-tone.svg` | Graphite body with the coating-cyan glass; follows `prefers-color-scheme`. README headers and docs. |
| `projections-app-icon.svg`      | 64px graphite tile with a white body and cyan glass: app and avatar contexts.                       |
| `favicon.svg`                   | 32px tile for browser tabs.                                                                         |
| `social-preview.png`            | 1280×640 repository social preview (dark); `social-preview-light.png` is the light variant.         |

In React apps use `ProjectionsMark` from
`@githubnext/projections-host/ui/components` (`tone="mono"` or `"two-tone"`),
which renders the same geometry with the theme's `--pj-lens` color for the
glass.

Colors: body `#1a1b1c` light / `#f6f5f2` dark; glass `#007798` light / `#3dbfe2`
dark (oklch 0.52/0.75, 0.12, 220). Keep at least 2px clear space at 16px. Do not
add the beam, a screen, or effects to the mark.

The mark is part of this repository and is licensed with it (MIT), and so is its
glyph in the VS Code icon font (below).

## Part icons

`parts/` holds the icons of a projection's three parts, drawn from one geometry
by `tools/scripts/product-icons.mjs` (`npm run icons`; `npm run check:icons`
fails when an output is out of date). They are Projections' own drawings,
derived from no icon library, and are licensed with this repository (MIT).

<!-- prettier-ignore -->
| File | Part | Drawing |
| --- | --- | --- |
| `parts/extractor.svg` | Extractor | Three strokes converging on a dot at the right: a larger thing abstracted into the extraction. |
| `parts/comparator.svg` | Comparator | Two dots, in the renderer's and the extractor's places, either side of a dashed divider: two extractions related. |
| `parts/renderer.svg` | Renderer | The extractor mirrored: three strokes leaving a dot at the left, the extraction presented. |

The dot is the extraction, so it is the same size in all three, and no stroke
touches it. On the 16px grid, with 1px round-capped strokes in `currentColor`:

- **Dot:** 4px across (radius 2), centred on y = 7.5; its edges on whole pixels
  along the axis (x 10–14 in the extractor, 1–5 in the renderer; the comparator
  has both).
- **Gap:** 1.5px from every stroke's round cap to the dot's edge.
- **Strokes:** radial, aimed at the dot's centre: a 5px middle stroke on y = 7.5
  and two 3.5px strokes at ±35°.
- **Divider:** at x = 7.5, three 2px dashes with 2px gaps (y 2.5–4.5, 6.5–8.5,
  10.5–12.5), the dot's own 2px clearance.

`orientation` in the script turns every icon 90° clockwise, redrawn on the grid
rather than transformed, if a vertical set is ever wanted.

They ship as:

- **VS Code product icons** `projections-extractor`, `projections-comparator`
  and `projections-renderer` (`contributes.icons`): glyphs U+E001–U+E003 of
  `packages/integrations/vscode/media/icons/projections-icons.woff`, a font the
  script writes with plain Node (`tools/scripts/icon-font.mjs`). The same font
  carries the Projections mark at U+E000, the product icon `projections-mark`
  (`$(projections-mark)`: the extension's status bar item, Open Projection),
  read from `projections-mark.svg` as one filled path, so editing the mark and
  running `npm run icons` updates it.
- **Icon tokens** `--projections-icon-extractor`, `-comparator` and `-renderer`:
  the renderer SDK's defaults
  (`packages/renderers/sdk/src/part-icons.generated.ts`, at the default UI's
  icon weight), drawn as masks in `currentColor`; hosts override them (the VS
  Code UI sends these drawings at codicon weight).
