---
description: "The browser host: sandboxed renderers and playback"
---

# Projections host

The browser host presents one extraction, or a comparison of two, through
renderer bundles in sandboxed frames. It comes in three layers:

<!-- prettier-ignore -->
| Layer | Package | What it is |
|---|---|---|
| Headless core | `@githubnext/projections-host` | State, actions and renderer frames. It owns everything that must be correct and secure, and renders no controls. |
| Default UI | `@githubnext/projections-host/ui` | `ProjectionView` and `ComparisonExplorer` built on the core with shadcn/ui, scoped so embedding pages and the UI don't affect each other. Used by the Inspector and third-party embedders. |

Hosts choose which features to expose. A host can offer side by side only and no
play button, or draw every control with its own design system.

## Entry points

<!-- prettier-ignore -->
| Import | What it is |
|---|---|
| `@githubnext/projections-host` | The headless core: `useProjection`, `ProjectionStage`, `RendererFrame`, renderer catalogs (`loadRendererCatalog`, `resolveRenderer`), targets and annotations, settings, `rendererContentSecurityPolicy`, and theming: `hostTheme`, the contrast-keeping color helpers and `copilotCanvasThemeTokens` (the GitHub Copilot app's canvas theme as renderer tokens) |
| `@githubnext/projections-host/ui` | The default UI: `ProjectionView`, `ComparisonExplorer` and the layer-2 blocks |
| `@githubnext/projections-host/ui/components` | The default UI's components, for hosts that compose their own |
| `@githubnext/projections-host/ui.css` | The default UI's styles (also exported as `/styles.css`) |
| `@githubnext/projections-host/build` | Serving renderer bundles: `collectRenderers`, `rendererResponseHeaders`, `rendererNotices` (Node, build time) |
| `@githubnext/projections-host/build/ui-notices` | `hostUiNotices`: the default UI's third-party notices (Node, build time) |

## Documentation

- [Projections host guide](../../../docs/guides/host.md): the headless core
  (state, actions, targets and annotations, settings), the default UI and its
  blocks, renderer frames and their security, serving renderer bundles, and the
  contracts with the native CLI.
- [Embedding Projections in your own app](../../../docs/guides/embedding.md#embedding-projections-in-your-own-app)
  and the [security architecture](../../../docs/guides/security.md).
- The [renderer frame protocol](../../../docs/guides/renderer-sdk.md#protocol)
  the host implements, and the [contracts](../../../docs/contracts.md).

## Development

```sh
npm run build -w @githubnext/projections-host
npm test -w @githubnext/projections-host           # policy, rows, renderer resolution, comparison rules
npm run storybook                                  # the default UI in Storybook (../../../tools/storybook), on http://localhost:6006
npm run test:browser -w @githubnext/projections-host
```

The default UI's prebuilt views, building blocks and components are shown in the
workspace's [Storybook](../../../tools/storybook/README.md), on the renderers'
own scenarios. The browser suite drives that Storybook's static build: its
harness stories (`tools/storybook/harness/`) are the pages under test. The
`Harness/Default UI` stories are the default UI explorer, a host built on the
core alone (side by side only, with its own controls and no playback) and the
default UI embedded in a page with hostile global styles.

The [browser suite's README](browser/README.md) describes the explorer harness,
its query parameters and what the suite checks.
