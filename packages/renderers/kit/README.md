---
description: The shared kit renderers are built from, with and without React
---

# Renderer kit

The renderer kit is the shared kit for the built-in Projections renderers, and
the default way to write a custom one: renderer authors import it from
[`@githubnext/projections`](../../sdk/README.md) (`/kit`, `/kit/react`,
`/kit/base.css` and `/kit/react.css`). This directory is the internal workspace
it is bundled from, `@githubnext/projections-renderer-kit`, with the same
entries. It adds presentation machinery on top of the
[renderer SDK](../sdk/README.md); renderers built with it are ordinary sandboxed
bundles. It has no design-system, GitHub or network dependency.

## Entry points

<!-- prettier-ignore -->
| Import | What it is |
|---|---|
| `@githubnext/projections/kit` (`.`, `src/index.ts`) | Framework-free: the comparison model, step timeline and staged motion, ELK graph layout and arrow routing, diff mode, card text metrics, change status, palettes and presentation helpers |
| `@githubnext/projections/kit/react` (`./react`, `src/react.ts`) | React: `mountRenderer` and `RendererProps`, the graph canvas, presentation and layout components, and the hooks (`useStageZoom`, `useFitScale`, `useLegend`, …). React and react-dom are optional peers |
| `@githubnext/projections/kit/base.css` (`./base.css`) | Plain CSS, the shared look for any renderer: the `.pk` root's aliases of the host's theme tokens (with the icon tokens), change regions, content buttons, badges, status lines and text |
| `@githubnext/projections/kit/react.css` (`./react.css`) | `base.css`, then the React components' rules: generated fields, the graph canvas, diff mode and the layout components |
| `browser/` (this workspace) | Playwright helpers for graph-family renderers' browser suites, and the badge icons' pixel suite |

**The main entry never imports React.** Only `src/react.ts` and the modules
under `src/react/` may import React (or the SDK's `react` module), and nothing
outside them imports them. `test/framework-free.test.mjs` enforces it three
ways: over the sources, over the built entry's declarations and the SDK's they
name, and by loading `dist/index.js` with a resolve hook that records any React
import. A module with both a pure helper and a hook is split: the helper stays
outside (`zoom.ts`, `fit.ts`, `legend.ts`), the hook goes under `src/react/`
with the same name. Stylesheets follow the same line: a rule for markup any
renderer can write belongs in a `base.css` partial, one for a React component's
markup in a `react.css` one.

## Documentation

- [Renderer kit guide](../../../docs/guides/renderer-kit.md): the renderer
  shell, comparison model, timeline, staged motion, graph canvas, diff mode,
  filling the frame, colors, presentation helpers, item rings, layout components
  and styles.
- [Renderer kit API](../../../docs/reference/renderer-kit.md): every export,
  with its signature and documentation.
- [Develop a renderer](../../../docs/guides/develop-a-renderer.md) and the
  [renderer SDK](../sdk/README.md) it builds on.

## Browser suites

`browser/` holds Playwright helpers for graph-family renderers on the shared
[harness](../harness/README.md): `fixtures.ts` (before/after pairs per
renderer), `invariants/` (`measureFrame`, run inside the renderer document,
`scrubFailures`, and `arrowContacts`/`contactIssues`: every head's painted tip,
stroke included, against its target's painted border, within half a CSS pixel)
and `suite.ts` (`scrubSuite`: 1% steps there and back plus 0.25% steps through
the first step, with arrowhead contact at every frame; `selectionSuite`). The
harness's `arrowheads.spec.ts` checks contact for every graph, DI and database
scenario, animated and in diff mode, at device pixel ratios 1 and 2. Each
renderer's `browser/*.spec.ts` uses them.

The kit's own `browser/badges.spec.ts`, which the harness runs, measures every
badge icon (`badgeIconNames`) in pixels as `Icon` (a CSS mask) and `SvgIcon` (an
SVG mask) draw it, from `badge-page.ts` bundled with Vite, in Chromium and
WebKit at 1x and 2x and at 14px and 16px: each glyph's cut-out ink is where its
geometry puts it, its bounding box's centre within a quarter of a CSS pixel of
the geometry's (the disc's centre for every glyph but `redeploy`, whose ring is
concentric with the disc instead), and every glyph is cut at the same stroke,
the stroke matching its cut's area against its own geometry drawn at a range of
widths. `npm run typecheck` checks both files (`tsconfig.browser.json`).
