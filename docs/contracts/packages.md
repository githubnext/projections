# Packages

The first open-source release is the CLI, the VS Code extension and the GitHub
Action. One npm package is prepared: **`@githubnext/projections`**, for people
who write renderers.

> [!NOTE]
> **Decided: a release asset, not npm, at first.** npm publishing awaits
> security approval, so the npm publishing workflow stays inert
> ([npm publishing](../maintainers/npm-publishing.md)). Instead, every GitHub
> release attaches the packed package, `githubnext-projections-<version>.tgz`,
> beside the CLI's executables, with a `.sha256` and a build provenance
> attestation, and renderers depend on it by URL
> (`https://github.com/githubnext/projections/releases/download/v<version>/githubnext-projections-<version>.tgz`),
> which `projections init --renderer custom` writes. People who can't download
> release assets add this repository as a Git submodule and build and pack the
> package from it.
> [Install @githubnext/projections](../guides/develop-a-renderer.md#install-githubnextprojections)
> describes both.

Its entries:

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

- **Why one package.** Authors, mostly of custom renderers, install one
  dependency at one version, and `projections init --renderer custom` scaffolds
  a renderer that depends on it with its checks already wired into `npm test`.
  The kit is the default path, so a renderer starts out meeting the checks every
  built-in renderer is held to. Inside this repository the code stays in
  separate workspaces (`packages/renderers/sdk`, `packages/renderers/kit`,
  `packages/renderers/testing`, `schemas`); `packages/sdk/` bundles them with
  [tsdown](https://tsdown.dev), JavaScript and declarations alike, so nothing
  published names an internal workspace.
- **Dependencies.** React and react-dom are optional peer dependencies, never
  bundled: `/kit/react` and `/renderer/react` need them, and a renderer without
  React (`/kit`, `/kit/base.css` and `/renderer`) installs and builds without
  them. Vite is a peer of `/vite`; Playwright is an optional peer, loaded only
  by `/testing`. Third-party libraries the kit and SDK use (ELK, Lucide, TypeBox
  and others) stay ordinary dependencies, so a renderer's own build attributes
  them in its `THIRD_PARTY_NOTICES.txt`. GitHub Linguist's language data ships
  as a file of its own, `vendor/linguist/`, with its license.
- **Version.** The package and the CLI release together at one version: install
  the package version that matches `projections --version`. `projections doctor`
  and `projections check` warn when a renderer's package is another version.
  Every release attaches it, and once npm publishing is approved and configured,
  also publishes it to npm with provenance
  ([npm publishing](../maintainers/npm-publishing.md)).
- **Not published.** Every other workspace is private: the hosts (`host`,
  `host-vscode`), the engine, the comparator runtime, the Action's scripts, the
  built-in renderers (built into the CLI, which serves them), and the internal
  SDK, kit, testing and schemas workspaces the package is made from. They are
  implementation, free to change between releases. The CLI is a native
  executable, released through installers and GitHub Releases, never npm, and no
  Rust crate is published (`publish = false`). The JSON Schemas are published to
  their own host, as above.

CI checks the package as it would be published
(`npm run check:pack --workspace packages/sdk`): the tarball's contents, every
entry and its types under `moduleResolution` `bundler` and `node16`, a renderer
without React that installs the tarball with Vite alone and builds on `/kit`,
`/kit/base.css` and `/renderer` with no React in its bundle, and a renderer
scaffolded by `projections init --renderer custom` that installs the tarball,
builds and passes its checks. The release proves the tarball it attaches the
same way, with the release's own Linux executable, which must scaffold the
renderer on the tarball's release URL
(`node packages/sdk/scripts/check-pack.mjs --tarball FILE`).
