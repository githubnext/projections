# Early access (from source)

If you want to try Projections before a release reaches you—new npm versions and
Marketplace extensions can sit in quarantine for days—you can build and install
it straight from a clone. You'll need Node 26.12.1 or later and Rustup; run
`npm run tools -- doctor` to check whether your machine is ready.

```sh
git clone https://github.com/githubnext/projections.git
cd projections
npm ci
npm run tools -- install
```

Running `tools install` builds the checkout (including a release build of the
CLI) and sets up three things:

- It links `projections` into `~/.local/bin` (use `--bin-dir` to pick another
  folder) and warns you if that directory isn't on your `PATH`.
- It packages the VS Code extension with that CLI bundled inside, stamped with a
  fresh version for each build (`<version>-dev.<commit>`), and installs it via
  `code --install-extension`. Pass `--editor code-insiders` for Insiders, or
  `--editor none` to only write `dist/dogfood/projections-vscode.vsix`. Reload
  VS Code afterward to pick up the new build.
- It packs `@githubnext/projections`, the package custom renderers depend on,
  into a stable path at `dist/dogfood/githubnext-projections.tgz`.

You can limit what gets installed with `--only cli,vscode,npm`, or pass
`--dry-run` to preview the plan without making changes. When you want to update,
pull the latest commits and run the install again:

```sh
git pull && npm ci && npm run tools -- install
```

## Renderer projects

When you run `projections init <id> --renderer custom` with this development
build, the scaffolded renderer is already wired to the packed tarball via a
`file:` reference. If you have an existing renderer package (a directory with a
`package.json`), point it at the tarball and install it using that project's own
npm configuration:

```sh
npm run tools -- install --only npm --project ../my-repo/.github/projections/flags/renderer
```

That command sets
`"@githubnext/projections": "file:…/dist/dogfood/githubnext-projections.tgz"`
(using a relative path when the project lives beside your clone) and clears out
any conflicting `overrides` entry. Re-run it after every update—each pack bumps
the version so npm reinstalls cleanly. Always use the tarball rather than
`npm link` or a `file:` reference to the `package` directory, because those
resolve React and other peer dependencies from the clone's `node_modules` and
leave the renderer with duplicate copies.

## Uninstall

To remove the source install, delete the binary with
`rm ~/.local/bin/projections`, uninstall the extension with
`code --uninstall-extension githubnext.projections-vscode`, and in any renderer
project switch back with `npm install @githubnext/projections@<version>` once
the package is published on npm.
