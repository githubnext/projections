# npm publishing

This guide explains how `@githubnext/projections` is published to npm and what
needs to be configured before the first release goes out. See
[Packages](../contracts/packages.md) for what the package includes and why it is
the only one we publish.

> [!IMPORTANT]
> **npm publishing awaits security approval.** Until approval comes through,
> leave the workflow unconfigured (no `npm` environment and no `NPM_PUBLISHING`
> variable) so it stays inactive. In the meantime, every GitHub release attaches
> the package tarball (`githubnext-projections-<version>.tgz`) so renderers can
> install it by URL. The release proof job packs it with
> `node packages/sdk/scripts/release-asset.mjs`, verifies it inside a renderer
> scaffolded by the release CLI, and uploads it alongside a `.sha256` checksum;
> it is attested with the other assets once the release is approved (see
> [Install @githubnext/projections](../guides/develop-a-renderer.md#install-githubnextprojections)).
> Once npm publishing is turned on, update
> `packages/cli/templates/renderer/package.json` so `projections init` points
> back to the npm version.

## How a release publishes

`.github/workflows/publish-npm.yml` runs as a dist post-announce job (listed
under `post-announce-jobs` in `dist-workspace.toml`), meaning it only fires
after the release workflow announces a release — the npm package never goes live
before the CLI release exists. You can also trigger it manually from the Actions
tab by picking the release tag under **Use workflow from** and passing that same
tag as `tag`.

The workflow runs three steps:

1. **Verify versions.** It checks that the tag is a valid release tag (like
   `v0.2.0` or `v0.3.0-beta.1`) and that every shipped manifest — including
   `packages/sdk/package.json` and `Cargo.toml` — matches it via
   `npm run tools -- version --tag <tag>`. Everything ships at one version,
   bumped together with `npm run tools -- version <version>` in the release
   commit (see [releasing](releasing.md)).
2. **Build and inspect the tarball.** It builds the package and runs
   `node packages/sdk/scripts/check-pack.mjs --contents` to confirm the tarball
   contains only built entries, declarations, styles, vendored data, and
   licenses, with no references to internal workspaces. CI runs the fuller check
   on every change, scaffolding a renderer with
   `projections init --renderer custom`, installing the tarball, and verifying
   its build and checks pass.
3. **Publish with provenance.** It publishes to `https://registry.npmjs.org/`
   with [provenance](https://docs.npmjs.com/generating-provenance-statements),
   using the `latest` dist-tag for stable releases and `next` for prereleases.
   If that version is already on npm, the job leaves it alone, so rerunning is
   safe. Right before publishing, `node packages/sdk/scripts/manifest.mjs strip`
   strips devDependencies (the internal workspaces used to build the package)
   from `packages/sdk/package.json`, since npm stores that manifest as registry
   metadata as well as inside the tarball.

Until publishing is configured, the job simply logs a notice and exits cleanly.

## Set up

1. **Reserve the package name.** Publishing requires access to the `@githubnext`
   scope on npm with an account or team permitted to publish
   `@githubnext/projections`. The first publish creates the package. If you plan
   to use trusted publishing, someone with publish rights (or a scope owner)
   must publish the initial version manually from a release checkout first: run
   `npm run build`, then `node packages/sdk/scripts/manifest.mjs strip`, then
   `npm publish --workspace packages/sdk --access public`, and restore the file
   with `git checkout packages/sdk/package.json`. After that, configure the
   steps below.
2. **Create a GitHub environment named `npm`** under Settings → Environments.
   Limit deployments to release tags (deployment branches and tags: `v*`), and
   optionally add required reviewers if you want manual sign-off before each
   publish.
3. **Configure credentials** using one of two methods:
   - **Trusted publishing (recommended).** On npmjs.com, go to the package's
     **Settings → Trusted publishing** and add two GitHub Actions publishers (up
     to 10 are allowed), both pointing to this repository's owner, name, and the
     `npm` environment: one for `release.yml` (automated post-release runs) and
     one for `publish-npm.yml` (manual runs). Because npm matches whichever
     workflow started the run and doesn't validate filenames on save, double
     check the spelling. Make sure `repository` in `packages/sdk/package.json`
     names this repository, then set the repository variable `NPM_PUBLISHING` to
     `trusted` (Settings → Secrets and variables → Actions → Variables). No
     token is stored. Once a publish succeeds, lock down the package's
     publishing access to require two-factor authentication and disallow tokens.
   - **Granular access token.** Create a token on npmjs.com scoped to read and
     write `@githubnext/projections` only, store it as the `NPM_TOKEN` secret in
     the `npm` environment, and set the repository variable `NPM_PUBLISHING` to
     `token` (the variable is needed because the gating job can't read
     environment secrets). Remember to rotate the token before it expires.

Provenance ties every published version back to this repository, the exact
release workflow run, and the commit it was built from, and displays a badge on
the npm package page. Note that provenance requires a public repository.

## Check before the first release

- Run `npm run build && npm run check:pack --workspace packages/sdk` locally and
  verify it passes (it prints the tarball's file list and size).
- Confirm the `package` CI job passes on the release commit.
- Run `npm view @githubnext/projections` to verify the scope is reachable. Once
  setup is complete, a manual run of **Publish npm package** against an existing
  release tag should either publish or report that the version is already live.
