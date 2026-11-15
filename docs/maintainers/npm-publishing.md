# npm publishing

How `@githubnext/projections` reaches npm, and what to set up before the first
release publishes it. [Packages](../contracts/packages.md) describes what the
package contains and why it is the only one published.

> [!IMPORTANT]
> **npm publishing awaits security approval.** Until it is approved, leave the
> workflow unconfigured (no `npm` environment and no `NPM_PUBLISHING` variable),
> so it stays inert. Meanwhile every release attaches the package tarball,
> `githubnext-projections-<version>.tgz`, which renderers depend on by URL: the
> release proof job packs it (`node packages/sdk/scripts/release-asset.mjs`),
> proves it in a renderer the release's CLI scaffolds and uploads it with a
> `.sha256`; it's attested with every asset once the release is approved
> ([Install @githubnext/projections](../guides/develop-a-renderer.md#install-githubnextprojections)).
> Once npm is configured, `projections init` should depend on the npm version
> again (`packages/cli/templates/renderer/package.json`).

## How a release publishes

`.github/workflows/publish-npm.yml` runs as a dist post-announce job
(`post-announce-jobs` in `dist-workspace.toml`), after the release workflow
announces a release, so the package never appears on npm before the CLI's
release exists. You can also run it by hand from the Actions tab: choose the
release tag under **Use workflow from**, and enter it as `tag`. It:

1. checks that the tag is a release tag (`v0.2.0`, `v0.3.0-beta.1`) and that
   every shipped manifest, the package's (`packages/sdk/package.json`) and the
   CLI's (`Cargo.toml`) included, is its version
   (`npm run tools -- version --tag <tag>`). They release together:
   `npm run tools -- version <version>` bumps them all in the release commit
   ([releasing](releasing.md));
2. builds the package and checks its tarball
   (`node packages/sdk/scripts/check-pack.mjs --contents`): only the built
   entries, declarations, styles, vendored data and licenses, and no file that
   names an internal workspace. CI runs the full check on every change,
   including a renderer scaffolded by `projections init --renderer custom` that
   installs the tarball, builds and passes its checks;
3. publishes it to `https://registry.npmjs.org/` with
   [provenance](https://docs.npmjs.com/generating-provenance-statements), under
   the `latest` tag for a stable release and `next` for a prerelease. A version
   already on npm is left as it is: running the job again is safe. Before
   publishing, it rewrites `packages/sdk/package.json` without its
   devDependencies (the internal workspaces the package is built from;
   `node packages/sdk/scripts/manifest.mjs strip`), because npm uploads the
   manifest as the version's registry metadata as well as in the tarball.

Until it is configured, the job only adds a notice to the run.

## Set up

1. **The package name.** Publish needs the `@githubnext` scope on npm, with an
   npm account (or team) allowed to publish `@githubnext/projections`. The first
   publish creates the package; with trusted publishing, create it first by hand
   from a release checkout, by someone with publish rights (`npm run build`,
   then `node packages/sdk/scripts/manifest.mjs strip` and
   `npm publish --workspace packages/sdk --access public`, then
   `git checkout packages/sdk/package.json`), or ask an owner of the scope to,
   then configure it below.
2. **A GitHub environment named `npm`** in this repository (Settings →
   Environments). Restrict it to release tags (deployment branches and tags:
   `v*`) and, if you like, add required reviewers so a person approves each
   publish.
3. **Credentials**, one of:
   - **Trusted publishing (recommended).** On npmjs.com, open the package's
     **Settings → Trusted publishing**, and add two GitHub Actions publishers (a
     package can have up to 10), each with this repository's owner and name and
     the environment `npm`: one with the workflow file name `release.yml`, which
     runs the publish job after a release, and one with `publish-npm.yml`, for
     manual runs. npm matches the workflow that started the run, and doesn't
     validate the names when you save them, so check the spelling. `repository`
     in `packages/sdk/package.json` must name this repository. Then set the
     repository variable `NPM_PUBLISHING` to `trusted` (Settings → Secrets and
     variables → Actions → Variables). No token is stored. Once a publish works,
     set the package's publishing access to require two-factor authentication
     and disallow tokens.
   - **A token.** Create a granular access token on npmjs.com that can read and
     write `@githubnext/projections` only, save it as the secret `NPM_TOKEN` in
     the `npm` environment, and set the repository variable `NPM_PUBLISHING` to
     `token`. (The variable turns publishing on: the job that decides can't read
     the environment's secrets.) Rotate the token before it expires.

Provenance links each published version to this repository, the release workflow
run and the commit it built, and npm shows it on the package page. It requires a
public repository.

## Check before the first release

- `npm run build && npm run check:pack --workspace packages/sdk` passes locally
  (it prints the tarball's files and size).
- The `package` CI job passes on the release commit.
- `npm view @githubnext/projections` shows the scope is reachable, and after
  setup, a manual run of **Publish npm package** for an existing release tag
  either publishes or reports that the version is already on npm.
