---
description: The one npm package for renderer authors
icon: package
---

# @githubnext/projections

Write [Projections](https://github.com/githubnext/projections) renderers: the
renderer side of the frame protocol, the renderer kit, the Vite build, the
built-in renderer checks and the document types, in one package.

A renderer presents a projection's extraction, or a comparison of two, inside a
sandboxed frame that a Projections host (the Inspector, a pull request page, an
editor) gives it. Start one with the CLI, which scaffolds a package that depends
on this one, with its checks wired in:

```sh
projections init service-map --renderer custom
cd .github/projections/service-map/renderer
npm install
npm run dev          # a development server with hot updates
npm run workbench    # its scenarios in the fixtures workbench, in a browser
npx playwright install chromium
npm test             # builds, then runs the renderer checks on every scenario
```

<!-- prettier-ignore -->
| Entry | Contents |
|---|---|
| `@githubnext/projections/kit` | The renderer kit, framework-free: the comparison model, step timeline and staged motion, graph layout, diff mode, change status, palettes and presentation helpers. It imports no React |
| `@githubnext/projections/kit/react` | The kit's React half, the default path: `mountRenderer`, React components for cards, names, identifiers, change marks and the diff view, the graph canvas, layout components and hooks |
| `@githubnext/projections/kit/base.css` | The kit's base styles, plain CSS for any renderer under a `.pk` root (they include the icon tokens) |
| `@githubnext/projections/kit/react.css` | The base styles and the kit's React components' styles |
| `@githubnext/projections/renderer` | The frame protocol client (`connectRenderer`, `applyEnvironment`, `afterPaint`), presentation and interpolation helpers, interactions and rings, and GitHub Linguist languages. It imports no React |
| `@githubnext/projections/renderer/react` | The React hooks (`useRenderer`, `useInteractions`) |
| `@githubnext/projections/renderer/icons.css` | Icon tokens, for a renderer that doesn't use the kit's styles |
| `@githubnext/projections/vite` | `rendererConfig` and `rendererBundlePlugin`: from your view module (`view: 'src/view.tsx'`), generate the entry that mounts it and build one self-contained `index.html`, `renderer.json` and `THIRD_PARTY_NOTICES.txt` (Node, build time) |
| `@githubnext/projections/testing` | Playwright fixtures and the built-in renderer checks in the real host frame (`expectScenarioToPass`, `checkScenario`, `openStage`), driving the fixtures workbench, `projections serve --stdio --fixtures` behind a loopback page (Node, test time) |
| `@githubnext/projections/schemas` | Types of every Projections document (`Extraction`, `Comparison`, `Definition`, …) and the constants and helpers that go with them |
| `@githubnext/projections/extractor` | For extractors (Node): `readRequest`; `result` writes the extraction, protocol fields filled in and items sorted (`extraction` builds it); for [generated values](../../docs/design/generated-values.md), `basis`, `basisDigest` and `generations` |

React and react-dom are optional peer dependencies, for `/kit/react` and
`/renderer/react`: a renderer without React installs the package with Vite alone
and uses `/kit`, `/kit/base.css` and `/renderer`. Vite is a peer of `/vite`, and
Playwright (`@playwright/test`) an optional peer that only `/testing` loads.
`/testing` and the `projections-renderer-workbench` command (the fixtures
workbench in a browser: the scenarios in every comparison mode, the renderer
checks, live reload and hot updates from `npm run dev`) run the `projections`
CLI: put it on `PATH` or set `PROJECTIONS_CLI`.

The package is released with the CLI and has the same version. Install the
version that matches your `projections --version`. It isn't on npm yet: each
[GitHub release](https://github.com/githubnext/projections/releases) attaches it
as `githubnext-projections-<version>.tgz`, and a renderer depends on that URL,
as `projections init` writes it. If you can't download release assets, build it
from a Git submodule; see
[Install @githubnext/projections](https://github.com/githubnext/projections/blob/main/docs/guides/develop-a-renderer.md#install-githubnextprojections).

Documentation, from guide to API:
[develop a renderer](https://github.com/githubnext/projections/blob/main/docs/guides/develop-a-renderer.md)
and the
[renderer kit guide](https://github.com/githubnext/projections/blob/main/docs/guides/renderer-kit.md);
then the
[kit API](https://github.com/githubnext/projections/blob/main/docs/reference/renderer-kit.md),
the
[SDK API](https://github.com/githubnext/projections/blob/main/docs/reference/renderer-sdk.md)
and the
[contracts](https://github.com/githubnext/projections/blob/main/docs/contracts.md).

## License

MIT. `vendor/linguist` is GitHub Linguist's language data, under its own MIT
license beside it; renderer builds attribute it in their notices.
