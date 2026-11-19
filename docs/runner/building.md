# Building the CLI

## Building from source

From the clean public workspace, use Node >=26.12.1, `npm ci`, then
`npm run build`. Node is source-build tooling for the browser UI, helpers and
packages, not the CLI runtime. The result, `packages/cli/dist/projections`, is
the same self-contained executable as a release for the build host.
`node packages/cli/scripts/build.mjs --target TRIPLE` builds into
`packages/cli/dist/TRIPLE/` when that Rust target and its linker are installed;
releases build each platform natively.

`cargo build --locked --release -p projections-cli` also builds the native CLI
directly. It embeds the browser client only if it was built first, and embeds
helpers only with `PROJECTIONS_EMBED_HELPERS=1` (set by
`packages/cli/scripts/build.mjs`); without them it resolves helpers from this
checkout's extractor crates. `PROJECTIONS_INSPECTOR_ASSETS` and
`PROJECTIONS_COLLECTOR_ASSETS` override the embedded client and helpers for
development. An asset-free build still supports CLI commands and fails
explicitly if Inspector assets are requested.

## Release builds

Releases are built with [dist](https://github.com/axodotdev/cargo-dist),
configured in `dist-workspace.toml`. `.github/workflows/release.yml` is
generated from it and never edited by hand: after changing the configuration or
upgrading dist (whose version the file pins), run `node tools/scripts/dist.mjs`.
CI runs `node tools/scripts/dist.mjs --check`. Pushing a tag such as `v0.1.0`,
matching the workspace version, releases it:

1. `release-inputs.yml` builds the platform-neutral embedded inputs once
   (browser client, default comparator, .NET and TypeScript helpers).
2. dist builds every target natively on a matching GitHub-hosted runner, with
   the inputs and the helpers embedded and required
   (`.github/release-build-setup.yml`), and attests its archives. Linux
   executables are statically linked against musl, so they need no particular
   glibc.
3. `release-proof.yml` extracts each executable on its own platform, runs the
   installed-binary proof (`npm run test:binary`) with Node absent from PATH,
   including every embedded helper and a local `gh extension install`, and
   publishes it under its gh name with its own `.sha256`.
4. When every proof passes, a reviewer of the `release` environment approves the
   release (`release-approval.yml`), which attests every asset. Only then does
   dist create the GitHub release, with the gh-named executables, dist's
   archives and installers, checksums and generated notes. No source tarball is
   published.

A pull request only plans a release. To dry-run the whole pipeline (builds,
proofs and gh-named workflow artifacts, but no release), set
`pr-run-mode = "upload"` temporarily on a pull request.

dist calls these jobs with GitHub's self-repository syntax,
`uses: $/.github/workflows/<job>.yml`: the workflow at the commit that is
running. actionlint 1.7.12 doesn't know that form yet, so
`.github/actionlint.yaml` ignores only that message for `release.yml`, and only
the matching one for the `$/` composite action steps of `ci.yml` and
`engine-quality.yml`.

## Source-built GitHub CLI extension

Released binaries install as a local extension directly; see
[Install the CLI](../setup/install.md). To develop the extension from source
instead, `tools/gh-projections/gh-projections` is a thin POSIX shell launcher
for the **same** `packages/cli/dist/projections`, commands and linked Rust
Engine as the standalone CLI. It preserves caller cwd, argv and exit status; it
never installs dependencies, builds, downloads tools, or makes network calls on
startup, and it executes the native binary directly, with no Node check or
fallback. Individual commands retain their normal explicit behavior, including
acquisition for `pr`. GitHub CLI remains optional for ordinary npm/standalone
CLI use.

Prepare a Git checkout of this repository, then install its
`tools/gh-projections` directory:

```sh
cd /path/to/projections
# Activate the Node version from .node-version (at least 26.12.1).
npm ci
npm run build
cd tools/gh-projections && gh extension install .

cd /path/to/target-repository
gh projections --help
gh projections show HEAD -p services --trust
```

Use an already installed `gh` and POSIX shell/`readlink`. Node and Rustup with
the checked-in Rust toolchain/Wasm target are needed for explicit source
preparation, not invocation. Preparation builds the host-compatible native CLI
with embedded Inspector browser assets. This is **source-built integration**;
released binaries are described in [Install the CLI](../setup/install.md).
Optional extractor toolchains remain prerequisites only when selected. A missing
native CLI build produces an explicit preparation error; the launcher never
repairs it implicitly. GitHub CLI's local install links the prepared source, so
retain that checkout and rebuild it explicitly after source updates. GitHub CLI
names a local extension after its directory, so `tools/gh-projections` is the
extension's `gh-projections` identity and the checkout itself may have any name;
no remote repository rename, publication or GitHub API operation is required.

The opt-in distribution proof requires an actually installed `gh` and a prior
public workspace build:

```sh
npm run test:gh --workspace @githubnext/projections-cli
```

It extends the fresh-cache package proof with a disposable public-root layout,
isolated HOME/XDG/GH_CONFIG_DIR and actual `gh extension install .`. It verifies
help equality, real native-validated collection, trust failure, relative output
in the caller repository and missing-build diagnostics through `gh projections`.
A refusing local proxy plus disabled update checks detects unexpected
API/network access by `gh`; only a fake offline authentication sentinel is used,
never a user's credentials. Temporary registration/config is removed with the
fixture. The explicit npm preparation/production dependency install may use the
npm registry; the launcher and local gh proof do not install anything themselves
or call a live GitHub API.
