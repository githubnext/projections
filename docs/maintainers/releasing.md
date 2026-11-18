# Releasing

How the product is versioned, how to bump the version, and how to cut a release.

## One version

Everything in `packages/` releases together at one version, the **release
version**. [Layout](../../CONTRIBUTING.md#layout) puts there everything that
ships or that something shipped depends on, so the rule needs no list:

- the Cargo workspace's `[workspace.package] version` in `Cargo.toml`, which
  every crate in `packages/` inherits (`version.workspace = true`). It is the
  CLI's version (`projections --version`) and the version dist releases;
- the `version` of every npm workspace in `packages/`: `@githubnext/projections`
  (`packages/sdk`), the renderers and their harness and testing workspaces, the
  host, the Inspector, the schemas, the Engine's and the comparator runtime's
  JavaScript, the CLI wrapper, the VS Code extension (the `.vsix` is
  `projections-vscode-<version>-<target>.vsix`, and the CLI it bundles must be
  that version) and the GitHub Action's scripts;
- every dependency between them. Workspaces depend on each other at their exact
  version (`"@githubnext/projections-schemas": "0.1.0"`), and so do path
  dependencies between crates that name a version;
- `Cargo.lock` and `package-lock.json`, which record them.

Workspaces and crates outside `packages/` (`tools/`, `examples/`) are never
released: they stay `private` (`publish = false` for crates) at `0.0.0`, and
depend on the packages at the release version. The repository root's
`package.json` is not a package and stays `0.0.0`. The Action has no version of
its own: `uses: githubnext/projections@v0.1.0` (or `@v0`) is its version, and it
installs that release's CLI.

The release version is not the protocol's or the schemas' version. Those are
[contracts](../contracts.md#versioning-and-publishing) with their own major
version (`v0` in `$id`s, `protocolVersion: 0`), which a release does not change.

## Bumping the version

One command sets the release version everywhere listed above, both lockfiles
included, exactly as `cargo update --workspace` and
`npm install --package-lock-only` would record it:

```sh
npm run tools -- version 0.2.0
npm ci && cargo check --workspace --locked   # confirm both lockfiles
```

It prints the files it changed. Commit them, and nothing else, as one change
("Release 0.2.0") and merge it like any other. A prerelease is `0.2.0-beta.1`.

## Checking the version

```sh
npm run tools -- version                 # every shipped manifest agrees
npm run tools -- version --tag v0.2.0    # ... and is the tag's version
```

It only reads files, so it takes a moment and needs no build or network. It
fails, naming each file and line, when a shipped manifest, a dependency between
them or a lockfile disagrees, or when anything outside `packages/` is not
private at `0.0.0`. `npm run check` runs it (`npm run check:versions`, the
`versions` gate of `tools check`), so CI fails on a partial bump. The release
workflow runs it with the release tag before it builds anything (the release
inputs job), again before packing `@githubnext/projections` (the release proof),
and before publishing to npm (`publish-npm.yml`). dist itself refuses a tag that
is not the CLI's version.

## Release notes

A release's notes are its section of [`CHANGELOG.md`](../../CHANGELOG.md),
headed with its tag (`## v0.2.0`). dist reads the section when it plans the
release, titles the GitHub release with its heading and puts the notes above the
install instructions it writes. A prerelease without a section of its own uses
its version's (`v0.2.0-beta.1` uses `## v0.2.0`, titled `v0.2.0-beta.1`), so a
release candidate and the release share one set of notes. A version with no
section gets dist's install instructions alone.

Write the section as changes merge, in the same pull request or soon after, and
lead with **Behaviour changes**: anything that can make a passing check, command
or workflow fail or act differently, and what to change. Keep each paragraph and
list item on one line (`.oxfmtrc.json` doesn't wrap this file): GitHub can
render a single line break as a break, as it does in comments. `dist plan`
(below) prints the release's title and body, so check them before tagging. Notes
stay editable after publishing, unlike assets:
`gh release edit v0.2.0 --notes-file`.

## Repository settings

A release depends on these settings of the repository, which a repository
administrator makes once, before the first release:

- **`release` environment**: required reviewers (a maintainers' team or named
  maintainers), and deployment limited to selected tags, with the one tag rule
  `v*.*.*`. Every release waits for one of them to approve it. GitHub creates an
  environment a job names that doesn't exist, without protection, so the release
  fails closed instead: its first approval job checks the environment exists,
  requires a reviewer and lets only `v*.*.*` tags deploy, and publishes nothing
  otherwise.
- **Tag rulesets**: one lets only maintainers create `v*.*.*` tags, and nobody
  update or delete them. A second targets `v*` but not `v*.*` (the major version
  tags, `v0`), blocks their creation, update and deletion, and lets only a
  deploy key bypass it. GitHub doesn't accept the Actions app as a bypass actor
  there, so the workflow's own token can't move them.
- **Deploy key** with write access (titled, for example, "Release: move major
  version tag"), the major tag ruleset's bypass. Its private key is the
  `MAJOR_TAG_DEPLOY_KEY` secret of the **`major-tag` environment**, whose
  deployment is limited to `v*.*.*` tags, with no reviewers: the release was
  already approved.
- **Immutable releases**, so a published release's assets and tag can't change.

## Cutting a release

1. Bump the version (above) and merge it, with the version's
   [release notes](#release-notes) already on `main`. The release is cut from
   that commit on `main`.
2. Tag it and push the tag. Tag rulesets let only maintainers create `v*.*.*`
   tags, and nobody move or delete them:

   ```sh
   git tag v0.2.0 <commit>
   git push origin v0.2.0
   ```

3. The **Release** workflow (`.github/workflows/release.yml`, which
   `dist generate` writes from `dist-workspace.toml`) plans the release, checks
   the version against the tag, builds the CLI for every target, proves each
   executable on its own platform, packages the VS Code extension and packs
   `@githubnext/projections`. When every proof passes, it waits for a reviewer
   of the `release` environment to approve the run's **Release approval /
   Approve and attest** job (`release-approval.yml`, a dist publish job). Only
   then does it attest the assets and create the GitHub release `v0.2.0`, with:

   | Asset                                                           | What                                                                      |
   | --------------------------------------------------------------- | ------------------------------------------------------------------------- |
   | `projections-cli-<target>.tar.xz`, `.zip` on Windows            | dist's archives; the installers download them                             |
   | `projections-cli-installer.sh`, `projections-cli-installer.ps1` | the installers                                                            |
   | `gh-projections-<os>-<arch>`, `.exe` on Windows                 | the executable as a `gh` precompiled extension, which the Action installs |
   | `projections-vscode-<version>-<vsce target>.vsix`               | the VS Code extension with that platform's executable inside              |
   | `githubnext-projections-<version>.tgz`                          | `@githubnext/projections`, which renderers install by URL                 |

   Each has an attestation, made in the approved job; dist also attests its
   archives as it builds them. Each but the installers has a `.sha256`: dist
   builds the installers in its own job, which doesn't checksum them; each
   installer holds its archives' SHA-256s and checks a download against them.
   The CLI's archive and `gh` asset names carry no version, so installers,
   `gh extension install` and the Action find them in any release; the release's
   tag is their version.

   `githubnext-projections-<version>.tgz` carries the renderer SDK and the
   renderer kit in all three of the kit's entries (`/kit`, framework-free;
   `/kit/react`; `/kit/base.css` and `/kit/react.css`), so the kit has no asset
   of its own. Before it is attached, the release proof checks the tarball with
   `node packages/sdk/scripts/check-pack.mjs --tarball`: its contents, every
   entry and its types, a renderer without React that installs it with Vite
   alone and bundles no React, and a renderer the release's CLI scaffolds on its
   release URL.

4. After the announcement, the post-announce jobs publish the JSON Schemas
   ([schema publishing](schema-publishing.md)), publish
   `@githubnext/projections` to npm once that is approved
   ([npm publishing](npm-publishing.md)), and for a stable release move the
   major version tag (`v0`) that `uses: githubnext/projections@v0` follows
   (`move-major-tag.yml`, in the `major-tag` environment, pushes it over SSH
   with the deploy key, the major tag ruleset's only bypass). It never moves the
   tag backwards or to a prerelease, and creates it if missing. To move it for a
   release again, run it on that release's tag:
   `gh workflow run move-major-tag.yml --ref v0.2.0 -f tag=v0.2.0`.

A tag with a prerelease (`v0.2.0-beta.1`) makes a prerelease: npm's `next` tag,
and `v0` doesn't move.

## Trying a release locally

Without pushing a tag or publishing anything, with the dist version
`dist-workspace.toml` pins (`cargo-dist-version`):

```sh
npm run tools -- version --tag v0.2.0
dist plan --tag v0.2.0 --allow-dirty         # what the release would contain
npm run build                                # the inputs the executable embeds, and the extension
dist build --tag v0.2.0 --allow-dirty --artifacts=local --target aarch64-apple-darwin
node packages/cli/scripts/release-asset.mjs target/distrib aarch64-apple-darwin gh-projections-darwin-arm64 dist/release
dist/release/gh-projections-darwin-arm64 --version
node packages/integrations/vscode/scripts/release-asset.mjs --target darwin-arm64 --binary dist/release/gh-projections-darwin-arm64 --out dist/release
node packages/sdk/scripts/release-asset.mjs dist/release
```

`--allow-dirty` stops dist comparing `.github/workflows/release.yml` with the
one it would generate, so these work while you edit `dist-workspace.toml`, or
when this workspace is nested in another repository;
`node tools/scripts/dist.mjs --check` checks the workflow. The `.vsix` script
installs the package with VS Code's own CLI and checks the installed extension
and its bundled CLI are the version.
