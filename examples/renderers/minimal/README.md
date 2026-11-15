---
description: "Template renderer: a dependency-free outline of an extraction or comparison, built with the renderer SDK"
---

# Minimal renderer (template)

A dependency-free TypeScript renderer for Projections. Copy this package to
start your own renderer. It shows:

- **Extraction mode:** an outline of entities (label and kind), then the
  relationships between them.
- **Comparison mode:** the comparator's steps in order, each listing its changes
  (status, before → after IDs and summary). Steps the host's progress has not
  reached yet are dimmed. Changed items are tinted in proportion to the host's
  `highlighting`, which is 0 at both endpoints.

It draws no header: the host shows the projection's title, schema and counts, so
the content starts at the top of the frame (`data-projections-content`).
Clicking an item selects it in the host, and clicking it again or the background
clears the selection; the host's selection is outlined.

## How a renderer works

A renderer is a static web bundle. The host loads its `index.html` into
`<iframe sandbox="allow-scripts">` with a content security policy that forbids
all network access (`connect-src 'none'`). The renderer and host talk only
through `postMessage`, using the renderer SDK
(`@githubnext/projections/renderer`, from the one npm package
[`@githubnext/projections`](../../../packages/sdk/README.md)).

## Walkthrough of `src/main.ts`

1. **Connect.** `connectRenderer(handlers, {capabilities})` reads the channel
   and host origin from the frame URL fragment, listens for host messages and
   posts `ready`. Declare `changeHighlighting: 'supported'` only if you use the
   `highlighting` value. Outside a host frame it throws
   `RendererConnectionError`; show the message instead of a blank page.
2. **Apply the environment.** Call `applyEnvironment(payload)` on `init` and on
   `environment`. It sets the host theme tokens as `--projections-<token>` CSS
   custom properties and sets `color-scheme`, `data-color-mode` and
   `data-reduced-motion` on `<html>`. See `src/styles.css`: every token has a
   fallback, and dark-mode fallbacks key on `data-color-mode`.
3. **Build once on `init`.** `init` carries the projection (`id`, `title`) and
   either `extraction` or `before`, `after` and `comparison`. Build the DOM
   once. Set extraction text with `textContent`, never as HTML: extraction data
   is untrusted.
4. **Declare steps.** In comparison mode, call `client.steps(ends)` with one end
   per step, `[1/n, 2/n, …, 1]`, so the host can hold at step boundaries during
   playback. Each end must be inside a still interval: step _i_ (from 0) counts
   as reached halfway through its slot, when `progress >= (i + 0.5) / n`, so
   seeking to an end never lands on a change.
5. **Update on `progress` and `select`.** `progress` carries `progress` (0 =
   before, 1 = after), `highlighting` (change-emphasis strength, exactly 0 at
   both endpoints) and `direction`. Update attributes and CSS variables only.
   Rebuilding the DOM would lose focus.
6. **Acknowledge paints.** After each update, call
   `afterPaint(() => client.rendered(progress))`. The host uses `rendered` to
   pace playback. Cancel a pending acknowledgement when a newer update arrives.
7. **Report selection.** On click, call `client.select(id)` with the entity or
   change ID; clicking the selected item again, or the background, calls
   `client.select(null)` (the `selection` check verifies both). The host may
   send its own `select`, which always wins.
8. **Report height.** `client.observeHeight(document.body)` sends `height`
   whenever the content resizes, so the host can size the frame without
   scrollbars. Keep `body` margins at 0.
9. **Report failures.** Call `client.error(message)` when rendering fails. The
   host shows the message and keeps its own views available.

Give the root element `data-renderer="<name>"` and give selectable items
`data-entity-id`. This template uses
`<main data-renderer="minimal" data-mode="…" data-progress="…">`.

## Build

```sh
npm run build --workspace @githubnext/projections-example-renderer-minimal
```

`vite.config.ts` uses `rendererConfig` from `@githubnext/projections/vite`. It
writes `dist/index.html`, one self-contained document with the script and styles
inline and the renderer content security policy, and the `renderer.json`
manifest:

```json
{"format": "projections.renderer", "version": 0, "name": "minimal", "title": "Minimal outline", "handles": []}
```

`handles` lists the definition renderer names (for example `graph`) that this
bundle can present. It is empty here because the template is chosen explicitly.
`"projections": {"renderer": "dist"}` in `package.json` tells tooling where the
bundle is.

## Develop and test it

`scenarios.json` describes fixture scenarios. Open them in the fixtures
workbench, which reloads whenever you rebuild: in VS Code, **Projections: Open
Renderer Scenarios…** on this folder, or in a browser:

```sh
npm run build --workspace @githubnext/projections-example-renderer-minimal
PROJECTIONS_CLI=packages/cli/dist/projections node packages/sdk/dist/workbench.js \
  --fixtures examples/renderers/minimal --renderer examples/renderers/minimal   # prints its URL
```

In this repository the workbench runs from the SDK's build and the CLI's. In
your own renderer, with `@githubnext/projections` installed and `projections` on
`PATH`, it's `npx projections-renderer-workbench --fixtures . --renderer .`.

`browser/renderer.spec.ts` runs the built-in renderer checks on every scenario
with `@githubnext/projections/testing`, plus one assertion of its own at exact
painted frames:

```sh
npm run test:browser --workspace @githubnext/projections-example-renderer-minimal
```

`playwright.config.ts` points `PROJECTIONS_CLI` at this repository's build;
elsewhere, put `projections` on `PATH`. `.github/workflows/renderer.yml` is a
workflow template that runs the same tests in CI. See
[Develop a renderer](../../../docs/guides/develop-a-renderer.md).

## Making it your own

- Rename the package and change `name`, `title` and `handles` in
  `vite.config.ts`.
- Import what you use from `@githubnext/projections/renderer`; a bundler leaves
  out the rest, so the bundle stays small (this one is about 46 kB, 16 kB
  gzipped): the client, protocol types, comparison helpers such as
  `presentComparison` and `createFrame` (for React, the `useRenderer` hook is in
  `@githubnext/projections/renderer/react`). For most renderers, start from
  `projections init <id> --renderer custom` instead: the kit meets the host's
  checks already. Its framework-free half (`@githubnext/projections/kit`, with
  `/kit/base.css`) works here too: the comparison model, timeline, layout, diff
  mode, change status and colors, without React.
- Style only with the theme's tokens (`var(--projections-…)`, as
  `src/styles.css` does): the renderer checks fail on a color, font size,
  spacing or radius that isn't one, in light or dark mode, and the build's style
  lint flags a token name that doesn't exist.
- Do not fetch anything. The content security policy blocks network access, so
  bundle every asset.
