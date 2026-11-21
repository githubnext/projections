# Packages

The first open-source release ships the CLI, the VS Code extension, and the
GitHub Action, along with a single npm package—**`@githubnext/projections`**—for
developers building custom renderers.

> [!NOTE]
> **Decided: a release asset, not npm, at first.** Because npm publishing is
> still awaiting security approval, the npm publishing workflow remains inert
> (see [npm publishing](../maintainers/npm-publishing.md)). In the meantime,
> every GitHub release attaches the packed tarball,
> `githubnext-projections-<version>.tgz`, alongside the CLI executables with a
> `.sha256` checksum and a build provenance attestation. Renderers depend on it
> by URL
> (`https://github.com/githubnext/projections/releases/download/v<version>/githubnext-projections-<version>.tgz`),
> which `projections init --renderer custom` writes automatically. If your
> environment cannot download release assets, you can add this repository as a
> Git submodule and build and pack the tarball locally.
> [Install @githubnext/projections](../guides/develop-a-renderer.md#install-githubnextprojections)
> walks through both approaches.

Here is what each entry point in `@githubnext/projections` exports:

<!-- prettier-ignore -->
| Entry | Contents |
|---|---|
| `@githubnext/projections/kit` | The renderer kit's framework-free half: the comparison model, step timeline and staged motion, graph layout, diff mode, change status, colors and presentation helpers. Neither it nor anything it loads imports React |
| `@githubnext/projections/kit/react` | The renderer kit's React half, the default way to write a renderer: the shell (`mountRenderer`), graph canvas, components and hooks |
| `@githubnext/projections/kit/base.css` and `/kit/react.css` | The kit's plain CSS: `base.css`, the shared look for any renderer, and `react.css`, `base.css` plus the React components' rules |
| `@githubnext/projections/renderer` and `/renderer/icons.css` | The renderer SDK: the [frame protocol](renderer-frames.md) client, presentation and interpolation helpers, interactions, rings and languages, and the icon tokens. It imports no React |
| `@githubnext/projections/renderer/react` | The renderer SDK's React hooks (`useRenderer`, `useInteractions`) |
| `@githubnext/projections/vite` | The renderer build (Node) |
| `@githubnext/projections/testing` | The built-in renderer checks and Playwright fixtures (Node; loads Playwright) |
| `@githubnext/projections/schemas` | The document types |

- **Why one package.** Authors—mostly of custom renderers—only need to install a
  single dependency at a single version. Running
  `projections init --renderer custom` scaffolds a renderer wired up to it, with
  the built-in checks already hooked into `npm test`. Because the kit is the
  default starting point, new renderers begin compliant with the same checks
  every built-in renderer passes. Inside this repository, the code remains split
  across internal workspaces (`packages/renderers/sdk`,
  `packages/renderers/kit`, `packages/renderers/testing`, `schemas`), and
  `packages/sdk/` bundles both their JavaScript and type declarations with
  [tsdown](https://tsdown.dev) so nothing in the published package references an
  internal workspace.
- **Dependencies.** React and react-dom are optional peer dependencies and are
  never bundled. `/kit/react` and `/renderer/react` require them, while a
  framework-free renderer using `/kit`, `/kit/base.css`, and `/renderer`
  installs and builds without React at all. Vite is a peer dependency of
  `/vite`, and Playwright is an optional peer loaded only by `/testing`.
  Third-party libraries used by the kit and SDK (ELK, Lucide, TypeBox, and
  others) remain regular dependencies so a renderer's own build attributes them
  in `THIRD_PARTY_NOTICES.txt`. GitHub Linguist's language data ships as its own
  file under `vendor/linguist/` with its license.
- **Version.** The package and the CLI always release together at the same
  version, so install the package version that matches `projections --version`.
  Both `projections doctor` and `projections check` warn if a renderer's package
  version drifts. Every release attaches the tarball, and once npm publishing is
  approved and configured, releases will also publish it to npm with provenance
  (see [npm publishing](../maintainers/npm-publishing.md)).
- **Not published.** Every other workspace in this repository stays private: the
  hosts (`host`, `host-vscode`), the engine, the comparator runtime, the
  Action's scripts, the built-in renderers (which are embedded in and served by
  the CLI), and the internal SDK, kit, testing, and schemas workspaces that feed
  the published package. Those are implementation details and may change freely
  between releases. The CLI itself ships as a native executable through
  installers and GitHub Releases—never npm—and no Rust crate is published
  (`publish = false`). JSON Schemas are published separately on their own host,
  as described in the contracts overview.

CI verifies the package in the exact form it will be shipped by running
`npm run check:pack --workspace packages/sdk`. That check inspects the tarball's
contents, validates every entry point and its types under both
`moduleResolution` `bundler` and `node16`, builds a React-free renderer with
Vite alone on `/kit`, `/kit/base.css`, and `/renderer` to confirm no React leaks
into the bundle, and scaffolds a renderer with
`projections init --renderer custom` that installs the tarball, builds, and
passes all checks. The release workflow runs the same verification against the
attached tarball using the release's own Linux executable, ensuring the
scaffolded renderer works against the tarball's release URL
(`node packages/sdk/scripts/check-pack.mjs --tarball FILE`).
