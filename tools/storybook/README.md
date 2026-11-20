---
description: "One Storybook for the host's default and VS Code UIs"
---

# Storybook

One Storybook for the host's UIs: the default UI
(`@githubnext/projections-host/ui`, shadcn-based) and the VS Code UI
(`@githubnext/projections-host-vscode`), plus the headless core. Every story
presents real extractions from the renderer packages' `scenarios.json` files
through the real renderer bundles, compared in the browser with the Wasm engine
and each scenario's comparator.

```sh
npm run build                                          # once: the engine, renderer bundles, host packages
npm run storybook                                      # http://localhost:6006
npm run build -w @githubnext/projections-storybook     # static build in storybook-static/
npm run test:browser -w @githubnext/projections-storybook
npm run screenshots -w @githubnext/projections-storybook -- <directory> [name filter]
```

The stories import the host packages' built output and stylesheets, as an
embedder does, so rebuild a package
(`npm run build -w @githubnext/projections-host`) to see its changes. Scenario
files reload live.

## Contents

<!-- prettier-ignore -->
| Section | What it shows |
|---|---|
| Default UI / Comparison explorer, Projection view | The prebuilt views in every comparison mode and view, one extraction, a custom comparator file, renderer controls, annotations with the detail card and its consumer slot, an unavailable renderer, notices and the phone viewport |
| Default UI / Renderers | Every renderer bundle on its scenarios; the `scenario` control offers the package's others |
| Default UI / Building blocks, Components | `TableView`, `TextView`, `DetailCard` (in the custom toolbar composition), `ComparisonModeControl`, `RendererControls`, and the scoped shadcn components |
| Default UI / Icons, VS Code UI / Icons | Every SDK icon by meaning, badges then the others, drawn by the renderer kit at 14 to 64px, in a card's status and the summary bar, in the host's real themes; **In the renderers** shows them beside the renderers' own words |
| Core / Projection stage | `useProjection` and `ProjectionStage` with a host's own plain controls |
| Core / Custom host | A whole custom UI on the core alone, with plain elements and no UI package: the view model (`useViewChoice`, `viewControls`, `scopeChoice`), playback (`playButton`, the Space shortcut), roving choice, a table of `visibleRows` and the summary's filter toggles |
| Harness / … | The pages the host's browser suites drive, on synthetic data with known IDs and query parameters (see their READMEs) |

The toolbar's **Theme** (light or dark) applies to the UI and its renderer
frames; **Viewport** offers a phone, tablet and desktop size, and the `Mobile`
stories open at the phone size.

## Adding stories

- A new prebuilt view or building block gets a story in the matching
  `stories/<ui>/` file, in every UI that has it. Building blocks take a live
  controller from `WithProjection` (`src/controller.tsx`) on a scenario.
- Use a scenario key (`<renderer package>/<scenario id>`) rather than inline
  data; add a scenario to a renderer's `scenarios.json` when none shows what you
  need. `src/fixtures.ts` turns it into saved extractions or a view subject.
- Name stories in the story object (`name: '…'`), where Storybook's indexer
  reads them.
- The icon stories show whatever the SDK's `iconNames` and `badgeIconNames`
  hold; an icon its categories in `src/icon-vocabulary.ts` don't list appears in
  a last group, so file a new icon under its meaning there. "In the renderers"
  reads the renderers' own word tables (`stories/icon-uses.ts`); add a
  renderer's there when it draws icons with words of its own.
  `browser/icons.spec.ts` checks every icon draws from its token, a badge as its
  disc with the glyph cut out. The kit's stylesheet is in the page only while an
  icon story is shown (`src/icon-styles.tsx`); the suite checks a story shown
  after one renders as before.
- `browser/smoke.spec.ts` renders every story in Chromium (light, dark and a
  phone) and WebKit and fails on any console error, page error, comparison
  failure or renderer failure.

## How it is served

`scripts/assets.mjs` copies the renderer bundles (`collectRenderers`), the
comparator Worker, scenario comparator files and the test renderers into
`static/`, served at the Storybook root, on every start and build.
`scripts/serve.mjs` serves the static build as a production host would: a strict
page policy (Storybook's inline scripts are allowed by hash), the renderer
policy on renderer bundles and a probe log of requests a sandboxed renderer must
never make. The browser suites use it.

## Building another Storybook on this one

Another UI on the host's headless core can build its Storybook on these
scenarios, helpers and assets. The package's `exports` are that surface, and
nothing else is supported: `./stories` (arguments, loaders and consumer
content), `./controller` (`WithProjection`), `./fixtures`, `./runtime`,
`./theme`, `./env` (the `scenarios` virtual module's types), `./frame.css`,
`./fill.css`, `./page-styles`, and the Node scripts `./scripts/assets`
(`prepareStatic`), `./scripts/scenarios` (`scenariosPlugin`) and
`./scripts/serve` (`startStorybookServer`). Changing one of them changes that
contract.

## License

MIT. Storybook is MIT-licensed by Storybook contributors.
