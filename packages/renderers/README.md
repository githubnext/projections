---
description: The built-in renderers and the kit they are built from
icon: palette
---

# Renderers

A renderer presents an extraction, or a comparison of two extractions, to a
person. Every renderer, built-in or custom, is a static web bundle that the host
runs in a sandboxed frame and talks to over the
[renderer frame protocol](../../docs/guides/renderer-sdk.md#protocol). The host
always offers its own table and text views beside the renderer and labels which
one is active.

Renderer authors outside this repository install one package,
[`@githubnext/projections`](../sdk/README.md), which bundles the SDK, kit,
testing and schemas workspaces below into `/renderer`, `/vite`, `/kit` (and
`/kit/react`), `/testing` and `/schemas`
([Packages](../../docs/contracts/packages.md)). Every workspace here is private.

- `sdk/`, `@githubnext/projections-renderer-sdk` (published as
  `@githubnext/projections/renderer` and `/vite`): Protocol, renderer client,
  React binding, Vite build helper, presentation helpers.
- `kit/`, `@githubnext/projections-renderer-kit` (published as
  `@githubnext/projections/kit`, `/kit/react`, `/kit/base.css` and
  `/kit/react.css`): Shared kit for built-in and custom renderers: a
  framework-free entry (comparison model, step timeline, staged graph motion,
  ELK graph layout, diff mode), a React entry (shell, graph canvas, components,
  hooks) and plain CSS.
- `graph/`, `@githubnext/projections-renderer-graph`: Staged graphs in one
  bundle (one copy of the ELK layout engine) for `graph`, `graph-horizontal`,
  `dag` (a pipeline caption), `architecture` (module boundaries and a kind
  legend), `infrastructure` (resource graphs with planned actions) and
  `dependencies` (a package dependency graph with collapsed transitive
  packages), chosen from `init.projection.renderer`. It replaces the former
  `-dag`, `-architecture` and `-dependencies` packages.
- `file-packing/`, `@githubnext/projections-renderer-file-packing`: Files as
  circles sized by their bytes, packed in their folders (`repository-map`), and
  weighted hierarchies (`treemap`); inspired by Repo Visualization (GitHub Next,
  2021).
- `testing/`, `@githubnext/projections-renderer-testing` (published as
  `@githubnext/projections/testing`): The built-in renderer checks and
  Playwright helpers that test a bundle and its `scenarios.json` in the real
  host frame.
- `harness/` (private): Runs the built-in renderers' browser suites
  (`<name>/browser/`) and the gallery on the Inspector's fixtures mode.
- `<name>/`, `@githubnext/projections-renderer-<name>`: One package per further
  built-in renderer.
- [`../../examples/renderers/minimal`](../../examples/renderers/minimal)
  (private): Dependency-free template to copy for a new renderer.

Renderers depend only on `packages/renderers/sdk` (and `schemas` for types);
built-in renderers may also use `packages/renderers/kit`, which itself depends
only on the SDK. The host depends on the protocol, never on a specific renderer.

## Package layout

```
packages/renderers/<name>/
  package.json        "projections": {"renderer": "dist"}; build script runs vite build
  vite.config.ts      export default defineConfig(rendererConfig({entry, name, title, handles}))
  tsconfig.json
  src/main.ts(x)      mounts with the kit's mountRenderer (or connects with connectRenderer or useRenderer) into #root
  scenarios.json      fixture scenarios: the gallery, fixtures mode and the browser checks
  browser/*.spec.ts   Playwright suites, run by packages/renderers/harness
  README.md
  dist/               build output, the bundle
    index.html        the whole renderer: <meta> CSP, inline <style>, <div id="root">, inline <script>
    renderer.json     {"format":"projections.renderer","version":0,"name","title","handles":[...]}
```

- `name` is the bundle directory name hosts serve it under
  (`packages/renderers/<name>/`): a lowercase identifier.
- `handles` lists the definition renderer names (`"renderer": "dag"`) this
  bundle presents. A host matches a definition's renderer string to a bundle
  whose `name` equals it first, then to the first bundle whose `handles`
  includes it. The standard schema families `graph`, `dag`, `architecture` (all
  three in the `graph` bundle, which also presents `infrastructure`), `api` and
  `database` have a built-in renderer of the same name, and `treemap` is
  presented by `file-packing`; `metrics` data is presented by the
  `code-statistics` renderer when a definition names it. Anything else falls
  back to the host's own table and text views.
- A bundle is one self-contained document. `rendererConfig` inlines the script,
  styles and every imported asset (images, fonts, Wasm) as data URLs. The
  renderer policy grants no source at all, not even `'self'`, so a renderer
  can't fetch, load or prefetch anything; the document load is the only request
  it causes.
- Build with Vite: `npm run build -w <package>`. Node is needed only to build;
  the bundle runs in any browser host and in the native CLI, which embeds
  built-in bundles as static assets.
- A custom renderer gives `rendererConfig` its view module
  (`view: 'src/view.tsx'`) and writes no entry: the build generates one that
  mounts the view with the kit (see the SDK's [Build](sdk/README.md#build)).
  Built-in renderers keep an `entry` of their own, `src/main.tsx`: it holds
  their stylesheet imports and the mount, which the Node unit tests can't load
  (`tsconfig.test.json` compiles every other source), and mounts with the kit
  workspace, `@githubnext/projections-renderer-kit`.

## Serving bundles

A bundle's `index.html` must be served with the renderer content security policy
(`rendererContentSecurityPolicy` in `sdk/src/protocol/frame.ts`, also
`rendererResponseHeaders(path)` in `@githubnext/projections-host/build`), which
forbids network access and includes `sandbox allow-scripts`. Hosts load the
entry into `<iframe sandbox="allow-scripts">`, never with `allow-same-origin`.
The bundle's own `<meta>` policy keeps static hosting without header control
safe for first-party bundles, but hosts must not rely on it for custom ones.

`collectRenderers` (`@githubnext/projections-host/build`) copies built bundles
into an application's static output as `packages/renderers/<name>/` and writes
`renderers/index.json`
(`{"format":"projections.renderers","version":0,"renderers":[manifest, …]}`).
The Inspector and the Storybook use it, as can any other application that serves
renderers.

## Writing a renderer

1. Start with `projections init <id> --renderer custom`: a kit renderer that
   depends on `@githubnext/projections` and runs the built-in checks with
   `npm test`. Build on the kit; it meets the checks already. For a renderer
   without React, copy
   [`examples/renderers/minimal`](../../examples/renderers/minimal), rename the
   package and set `name`, `title` and `handles` in `vite.config.ts`; it can
   still use the framework-free kit (`@githubnext/projections/kit` and
   `/kit/base.css`). The steps below are what the kit's React shell does for
   you, and what such a renderer does itself.
2. Connect once on load and declare capabilities. Without React:

   ```ts
   import {afterPaint, applyEnvironment, connectRenderer} from '@githubnext/projections/renderer'

   const client = connectRenderer({
     init(init) {          // documents arrive once (again if they change)
       applyEnvironment(init)
       build(init)         // init.mode === 'extraction' | 'comparison'
     },
     progress(position) {  // {progress 0..1, highlighting 0..1, direction}
       update(position)
       afterPaint(() => client.rendered(position.progress))
     },
     select({id}) { highlight(id) },
     environment(environment) { applyEnvironment(environment) },
   }, {capabilities: {changeHighlighting: 'supported'}})
   client.observeHeight(document.body)
   ```

   With React, `useRenderer({capabilities})` from
   `@githubnext/projections/renderer` returns
   `{init, progress, selection, options, viewport, environment, client}` and
   acknowledges every painted progress automatically.

3. Present every change the comparison lists, in its step order (or its
   `reverseSteps` when `order.reverse` is `explicit` and progress falls from 1),
   and use the host's `highlighting` for change emphasis, scoped to each
   change's own step (it rises when the step begins; the SDK's `emphasisRise`
   and the kit's `stepEmphasis`): it is exactly 0 at both endpoints, where
   nothing may look changed. Comparisons never carry positions, colors or
   timing; those are yours. Host playback is continuous, so let shapes settle
   between steps while progress keeps moving: the kit's timeline
   (`scheduleSteps`) gives every step a motion window with holds around it.
4. Report user selection with `client.select(id)`, source navigation requests
   with `client.open(path, line)` (the host decides), optional step boundaries
   with `client.steps(ends)`, and failures with `client.error(message)`.
5. Respect `reducedMotion`, the theme tokens (`--projections-color-fg` and the
   rest of `themeTokenNames`; `token` in TSX) and keyboard access. Every painted
   color, font size, spacing, radius and border width is a token: the `palette`,
   `type-scale` and `spacing` checks fail on anything else, and the build's
   style lint flags it in CSS. Keep everything focusable inside your document;
   the host handles focus entering and leaving the frame.
6. Never insert document text as HTML. Extractions describe untrusted code.
7. Put `data-entity-id="<selection ID>"` on every element that presents an
   entity or relationship, and call `connectInteractions(client, root)` from
   `@githubnext/projections/renderer` (React: `useInteractions`) with
   `interactionCapabilities` declared, so side-by-side and swipe comparisons can
   sync hover, draw connectors between panes and mirror scrolling, and so the
   host's filter and annotations work. Name main scroll containers with
   `data-projections-scroll="<name>"` and style `[data-projections-hovered]`,
   `[data-projections-filtered]` and, optionally,
   `[data-projections-annotated]`. Make relationships selectable and focusable
   like entities wherever they are drawn. The controller draws the host's
   annotation badges (for example comment counts) itself, in an overlay outside
   your root, and reports `select` and `annotation` when one is activated. Kit
   renderers get the controller automatically from `mountRenderer`; pass your
   select handler to `useInteractions` as `select` so a badge also updates your
   own selection.
8. Build a diff mode, first (`comparisonModes` starting with `'diff'`): a
   comparison opens in it, and it is where people review changes. Then add side
   by side or animated from the same view if time allows. Diff is one static
   frame of the union of both revisions, laid out once in your renderer's own
   form, with every change marked in place (added in the added hue, removed kept
   where it was, dashed or struck through, modified with its old value struck
   through beside the new one). The kit's
   [diff mode](../../docs/guides/renderer-kit.md#diff-mode) gives you the union
   (`diffModel`), the standard `data-change` marks and their styles, and the
   value-change and +/− pill components; the built-in graph, DAG, architecture,
   infrastructure, dependency graph, database, dependency injection, code
   statistics, file packing, API, runtime policy and text diff renderers all
   have one.
9. Draw no summary line: the host's summary bar, along the bottom of every view,
   counts each kind and its changes in your words (`nouns`) and states what the
   counts can't say as facts (`facts`: `2 breaking changes`, `1 newly enforced`,
   `39,882 lines of code +2,056`), the same in every mode and host. See the
   kit's summary bar under
   [Presentation helpers and components](../../docs/guides/renderer-kit-components.md#presentation-helpers-and-components).
10. Open spatial content fitted. A graph, diagram or schema opens with all of it
    in view, scaled down to the frame (never cropped, never magnified), in every
    comparison mode and for one revision, unless that draws its smallest text
    below the 8 px opening floor (`openingFloorPx`): then it opens at the scale
    where that text is 8 px, at the content's top left (or the top centre of a
    centred layout), and the reader scrolls and pans; a diff opens on its
    changes instead (and any mode on the focus a host sends, `RendererFocus`),
    fitted to them when they fit; Fit to view still shows all of it. A
    transition's endpoints share one framing and one floor. Declare zoom
    controls so a reader can enlarge it. The kit's `useFitScale`,
    `useOpeningFloor`, `useStageZoom` and `zoomControls` do this, and the
    `opens-fitted` check verifies it. Document-style content (lists, tables,
    text) keeps its natural size and scrolls. Among the built-ins, `graph`,
    `graph-horizontal`, `dag`, `architecture`, `infrastructure`, `dependencies`,
    `dependency-injection` and `database` are zoomable; `file-packing` lays out
    at the frame's size, so all of it is always in view; `api`,
    `code-statistics`, `runtime-policy`, `agentic-workflows` and `text-diff` are
    document-style. Opening fitted replaced an 11 px readable floor on
    2026-11-10, and the 8 px opening floor was added the same day (see the kit
    guide's
    [filling the frame](../../docs/guides/renderer-kit.md#filling-the-frame)).
