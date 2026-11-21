# Releasing

This guide covers how Projections is versioned, how to bump versions across the
monorepo, and how to cut and verify a release.

## One version

Everything under `packages/` ships together under a single **release version**.
Because the repository [layout](../../CONTRIBUTING.md#layout) places everything
that ships (and everything a shipped artifact depends on) inside `packages/`,
the rule is automatic and needs no manual allowlist:

- The Cargo workspace's `[workspace.package] version` in `Cargo.toml`, inherited
  by every crate in `packages/` via `version.workspace = true`. This is the
  version `projections --version` prints and the version dist releases.
- The `version` field of every npm workspace in `packages/` —
  `@githubnext/projections` (`packages/sdk`), the renderers along with their
  harness and testing workspaces, the host, the Inspector, the schemas, the
  JavaScript packages for the Engine and comparator runtime, the CLI wrapper,
  the VS Code extension (whose `.vsix` is named
  `projections-vscode-<version>-<target>.vsix` and bundles the matching CLI),
  and the GitHub Action's scripts.
- Every internal dependency between those packages. Workspaces pin each other to
  the exact release version (`"@githubnext/projections-schemas": "0.1.0"`), as
  do versioned Cargo path dependencies.
- `Cargo.lock` and `package-lock.json`, which reflect those versions.

Workspaces and crates outside `packages/` (`tools/`, `examples/`) never ship:
they stay `private` (`publish = false` for Rust crates) at `0.0.0`, while
depending on `packages/` at the release version. The repository root's
`package.json` isn't a published package and stays at `0.0.0` too. The GitHub
Action has no separate version — `uses: githubnext/projections@v0.1.0` (or
`@v0`) _is_ its version, and it installs the matching CLI release.

Note that the release version is separate from the protocol and schema versions.
Those are [contracts](../contracts.md#versioning-and-publishing) with their own
major version (`v0` in `$id`s, `protocolVersion: 0`) that normal releases do not
bump.

## Bumping the version

A single command updates the release version across all manifests and both
lockfiles, matching what `cargo update --workspace` and
`npm install --package-lock-only` produce:

```sh
npm run tools -- version 0.2.0
npm ci && cargo check --workspace --locked   # confirm both lockfiles
```

It prints every file it touched. Commit those files on their own (for example,
"Release 0.2.0") and merge through the normal PR flow. For a prerelease, use a
tag like `0.2.0-beta.1`.

## Checking the version

```sh
npm run tools -- version                 # every shipped manifest agrees
npm run tools -- version --tag v0.2.0    # ... and is the tag's version
```

This check only reads files, so it finishes almost instantly with no build or
network calls. If any shipped manifest, inter-package dependency, or lockfile is
out of sync — or if anything outside `packages/` isn't private at `0.0.0` — it
fails and prints the exact file and line.

`npm run check` runs this automatically via `npm run check:versions` (the
`versions` gate of `tools check`), so CI catches partial bumps right away. The
release workflow also runs it against the release tag before building (in the
release inputs job), before packing `@githubnext/projections` (in the release
proof), and before publishing to npm (`publish-npm.yml`). dist itself rejects
any tag that doesn't match the CLI's version.

## Release notes

Each release pulls its notes from its section in
[`CHANGELOG.md`](../../CHANGELOG.md), headed by its tag (`## v0.2.0`). When dist
plans the release, it uses that heading as the GitHub release title and places
the section body above its auto-generated install instructions. A prerelease
without its own section falls back to its base version's section
(`v0.2.0-beta.1` uses `## v0.2.0`, titled `v0.2.0-beta.1`), so release
candidates and the final release share one set of notes. If no section exists,
the release shows only dist's install instructions.

Add entries to the changelog as changes merge (in the same PR or right after)
and lead with **Behaviour changes** — anything that might make a previously
passing check, command, or workflow fail or behave differently, along with what
users need to adjust. Keep each paragraph and list item on a single line
(`.oxfmtrc.json` leaves this file unwrapped) because GitHub can treat hard line
breaks as visible line breaks. dist also bundles `CHANGELOG.md` into every CLI
archive next to the README and license.

To preview the title and body before tagging, run the dist version pinned in
`dist-workspace.toml` (its default output only lists artifacts):

```sh
dist plan --tag v0.2.0 --allow-dirty --output-format=json \
  | jq -r '.announcement_title, .announcement_github_body'
```

Unlike release assets, notes can still be edited after publishing. Because the
body includes dist's install instructions alongside your notes, fetch and edit
the full body rather than overwriting it from scratch:

```sh
gh release view v0.2.0 --json body --jq .body > body.md   # edit body.md
gh release edit v0.2.0 --notes-file body.md
```

## Repository settings

A repository administrator needs to configure these settings once before the
first release:

- **`release` environment:** add required reviewers (a maintainers team or named
  maintainers) and restrict deployments to selected tags with the single rule
  `v*.*.*`. Every release pauses here for human approval. Because GitHub
  silently creates an unprotected environment if a workflow references one that
  doesn't exist, the release workflow fails closed: its first approval job
  verifies the environment exists, requires a reviewer, and allows only `v*.*.*`
  tags before publishing anything.
- **Tag rulesets:** create one ruleset so only maintainers can create `v*.*.*`
  tags and nobody can move or delete them. Create a second ruleset targeting
  `v*` excluding `v*.*` (for major-version tags like `v0`) that blocks creation,
  updates, and deletion except via a deploy key — GitHub doesn't allow the
  Actions app as a bypass actor here, so the workflow token can't move major
  tags on its own.
- **Deploy key:** add a write-enabled deploy key (for instance, "Release: move
  major version tag") as the bypass for the major-tag ruleset. Store its private
  key as the `MAJOR_TAG_DEPLOY_KEY` secret in the **`major-tag` environment**,
  restricted to `v*.*.*` tags with no required reviewers (the release itself was
  already approved).
- **Immutable releases:** enable immutable releases so published tags and assets
  can't be modified after the fact.

## Cutting a release

1. Merge the version bump (above) with the release's
   [release notes](#release-notes) already on `main`. The release is cut from
   that commit.
2. Create and push the tag. Tag rulesets restrict `v*.*.*` creation to
   maintainers and prevent moving or deleting tags afterward:

   ```sh
   git tag v0.2.0 <commit>
   git push origin v0.2.0
   ```

3. The **Release** workflow (`.github/workflows/release.yml`, generated by
   `dist generate` from `dist-workspace.toml`) plans the release, verifies the
   version matches the tag, builds the CLI for every target, verifies each
   binary on its native platform, packages the VS Code extension, and packs
   `@githubnext/projections`. Once all checks pass, it pauses at **Release
   approval / Approve and attest** (`release-approval.yml`, a dist publish job)
   until a `release` environment reviewer approves it. Only after approval does
   it attest the assets and create the `v0.2.0` GitHub release containing:

   | Asset                                                           | What                                                                      |
   | --------------------------------------------------------------- | ------------------------------------------------------------------------- |
   | `projections-cli-<target>.tar.xz`, `.zip` on Windows            | dist's archives; the installers download them                             |
   | `projections-cli-installer.sh`, `projections-cli-installer.ps1` | the installers                                                            |
   | `gh-projections-<os>-<arch>`, `.exe` on Windows                 | the executable as a `gh` precompiled extension, which the Action installs |
   | `projections-vscode-<version>-<vsce target>.vsix`               | the VS Code extension with that platform's executable inside              |
   | `githubnext-projections-<version>.tgz`                          | `@githubnext/projections`, which renderers install by URL                 |

   Every asset receives an attestation in the approved job, and dist also
   attests its archives as they are built. Every asset except the installers
   also gets a `.sha256` file (dist generates the installers in a separate job
   without checksums, and each installer embeds its archives' SHA-256 hashes to
   verify downloads). Notice that the CLI archive and `gh` asset names omit the
   version number so installers, `gh extension install`, and the Action can
   locate them reliably in any release; the release tag carries the version.

   `githubnext-projections-<version>.tgz` bundles both the renderer SDK and all
   three renderer kit entry points (`/kit`, framework-free; `/kit/react`;
   `/kit/base.css` and `/kit/react.css`), so the kit doesn't need its own
   release asset. Before attaching it, the release proof validates the tarball
   with `node packages/sdk/scripts/check-pack.mjs --tarball` — checking its
   contents, every entry point and its types, a framework-free renderer built
   with Vite alone (confirming React isn't bundled), and a renderer scaffolded
   by the release CLI against the release URL.

4. After the announcement, post-announce jobs publish the JSON Schemas
   ([schema publishing](schema-publishing.md)), publish
   `@githubnext/projections` to npm once approved
   ([npm publishing](npm-publishing.md)), and — for stable releases — advance
   the major-version tag (`v0`) that `uses: githubnext/projections@v0` tracks.
   That last step runs in `move-major-tag.yml` inside the `major-tag`
   environment, pushing over SSH with the deploy key. It never moves the tag
   backward or onto a prerelease, and creates it if it doesn't exist yet. If you
   ever need to re-run it for a release, invoke:
   `gh workflow run move-major-tag.yml --ref v0.2.0 -f tag=v0.2.0`.

Prerelease tags like `v0.2.0-beta.1` publish as GitHub prereleases under npm's
`next` tag and leave `v0` untouched.

## Trying a release locally

You can dry-run the release pipeline locally without pushing a tag or publishing
anything, using the dist version pinned in `dist-workspace.toml`
(`cargo-dist-version`):

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

Passing `--allow-dirty` stops dist from comparing
`.github/workflows/release.yml` against what it would freshly generate, which is
handy while editing `dist-workspace.toml` or working inside a nested repository.
Run `node tools/scripts/dist.mjs --check` to verify the generated workflow
matches. The `.vsix` script installs the built extension with VS Code's own CLI
and confirms that both the extension and its bundled CLI report the expected
version.
