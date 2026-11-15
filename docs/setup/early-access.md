# Early access (from source)

Before a release reaches you (new npm versions and Marketplace extensions can be
held in quarantine for days), install from a clone. You need Node 26.12.1 or
later and Rustup; `npm run tools -- doctor` checks the machine.

```sh
git clone https://github.com/githubnext/projections.git
cd projections
npm ci
npm run tools -- install
```

`tools install` builds the checkout (a release build of the CLI) and then:

- links `projections` into `~/.local/bin` (`--bin-dir` for elsewhere) and warns
  if that directory isn't on your `PATH`;
- packages the VS Code extension with that CLI inside, at a new version for each
  build (`<version>-dev.<commit>`), and installs it with
  `code --install-extension` (`--editor code-insiders`, or `--editor none` to
  only write `dist/dogfood/projections-vscode.vsix`). Reload VS Code afterwards;
- packs `@githubnext/projections`, the package custom renderers depend on, to
  `dist/dogfood/githubnext-projections.tgz`, a path that never changes.

`--only cli,vscode,npm` installs just those parts and `--dry-run` prints the
plan. To update, pull and run it again:

```sh
git pull && npm ci && npm run tools -- install
```

## Renderer projects

`projections init <id> --renderer custom`, run with this development build,
already makes the renderer depend on the packed tarball with a `file:`
reference. For an existing renderer package (one directory with a
`package.json`), point it at the tarball and install it there, with that
project's own npm configuration:

```sh
npm run tools -- install --only npm --project ../my-repo/.github/projections/flags/renderer
```

This sets
`"@githubnext/projections": "file:…/dist/dogfood/githubnext-projections.tgz"`
(relative when the project sits beside your clone) and removes a conflicting
`overrides` entry. Run the same command after each update: every pack has a new
version, so npm reinstalls it. Use the tarball, not `npm link` or a `file:`
reference to the `package` directory: those resolve React and the other peer
dependencies from the clone's `node_modules`, so a renderer gets two copies.

## Uninstall

`rm ~/.local/bin/projections`,
`code --uninstall-extension githubnext.projections-vscode`, and in a renderer
project, `npm install @githubnext/projections@<version>` once the package is on
npm.
