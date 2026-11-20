# Building the CLI

## Building from source

To build the CLI from a clean public workspace, make sure you are on Node
`>=26.12.1`, then run `npm ci` followed by `npm run build`. Node is only used to
build the browser UI, helpers, and packages—not to run the CLI itself. The
resulting binary at `packages/cli/dist/projections` is the same self-contained
executable shipped in releases for your platform. If you want to cross-compile
for another target whose Rust target and linker are installed, run
`node packages/cli/scripts/build.mjs --target TRIPLE`, which outputs to
`packages/cli/dist/TRIPLE/`; official releases build each platform natively.

You can also invoke Cargo directly with
`cargo build --locked --release -p projections-cli`. Keep in mind that Cargo
only embeds the browser client if it was already built, and only embeds helpers
when `PROJECTIONS_EMBED_HELPERS=1` is set (which
`packages/cli/scripts/build.mjs` handles for you); otherwise the binary looks up
helpers from this checkout's extractor crates. During development,
`PROJECTIONS_INSPECTOR_ASSETS` and `PROJECTIONS_COLLECTOR_ASSETS` let you
override the embedded client and helpers. An asset-free build still runs normal
CLI commands and fails explicitly if anything requests Inspector assets.

## Release builds

Releases are managed with [dist](https://github.com/axodotdev/cargo-dist) and
configured in `dist-workspace.toml`. Never edit `.github/workflows/release.yml`
by hand—whenever you change the configuration or upgrade dist (whose version is
pinned in that file), regenerate the workflow with
`node tools/scripts/dist.mjs`. CI verifies it stays in sync with
`node tools/scripts/dist.mjs --check`.

Pushing a version tag that matches the workspace version (such as `v0.1.0`) runs
the release pipeline:

1. `release-inputs.yml` builds the platform-neutral embedded assets once: the
   browser client, the default comparator, and the .NET and TypeScript helpers.
2. dist builds every target natively on a matching GitHub-hosted runner,
   embedding and requiring those inputs and helpers
   (`.github/release-build-setup.yml`), and attests its archives. Linux binaries
   are statically linked against musl so they do not depend on a specific glibc
   version.
3. `release-proof.yml` unpacks each binary on its own platform and runs the
   installed-binary proof (`npm run test:binary`) with Node removed from PATH.
   This exercises every embedded helper and a local `gh extension install`, then
   publishes the binary under its gh name alongside its `.sha256` checksum.
4. Once every proof passes, a reviewer for the `release` environment approves
   the release (`release-approval.yml`), attesting every asset. Only then does
   dist create the GitHub release with the gh-named executables, archives,
   installers, checksums, and generated release notes. No source tarball is
   published.

Pull requests only plan a release by default. If you want to dry-run the full
pipeline—builds, proofs, and gh-named workflow artifacts, without publishing a
release—temporarily set `pr-run-mode = "upload"` on the pull request.

Because dist invokes these workflows with GitHub's self-repository syntax
(`uses: $/.github/workflows/<job>.yml`, targeting the workflow at the running
commit) and actionlint 1.7.12 does not recognize that form yet,
`.github/actionlint.yaml` ignores only that specific message for `release.yml`,
along with the matching message for the `$/` composite action steps in `ci.yml`
and `engine-quality.yml`.

## Source-built GitHub CLI extension

Released binaries can be installed directly as a local `gh` extension; see
[Install the CLI](../setup/install.md). If you are developing the extension from
source instead, `tools/gh-projections/gh-projections` provides a thin POSIX
shell launcher that runs the **same** `packages/cli/dist/projections` binary,
commands, and linked Rust Engine as the standalone CLI.

The launcher preserves your working directory, arguments, and exit status, and
invokes the native binary directly with no Node check or fallback. It never
installs dependencies, builds, downloads tools, or makes network requests at
startup—individual commands keep their normal explicit behavior, including
acquisition for `pr`. The GitHub CLI remains optional for ordinary npm or
standalone CLI use.

To set up the source-built extension, prepare a Git checkout of this repository
and install its `tools/gh-projections` directory:

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

Running the extension requires only an installed `gh` and a POSIX shell with
`readlink`. Node and Rustup (with the checked-in Rust toolchain and Wasm target)
are needed only during explicit source preparation, which builds the
host-compatible native CLI with embedded Inspector browser assets. This workflow
is for **source-built integration**; for prebuilt releases, see
[Install the CLI](../setup/install.md).

Optional extractor toolchains remain prerequisites only when you select an
extractor that uses them. If the native CLI binary hasn't been built, the
launcher reports a clear preparation error rather than trying to repair it.
Because `gh` links a local extension straight to the prepared directory, keep
that checkout around and rebuild it after pulling source changes. GitHub CLI
also derives the extension name from the installed directory, so
`tools/gh-projections` gives it the `gh-projections` identity regardless of what
your checkout folder is named—no remote repository rename, publication, or
GitHub API call is required.

To run the opt-in distribution proof (which requires an installed `gh` and a
prior public workspace build):

```sh
npm run test:gh --workspace @githubnext/projections-cli
```

This test extends the fresh-cache package proof with a disposable public-root
layout, isolated HOME/XDG/GH_CONFIG_DIR directories, and a real
`gh extension install .`. Through `gh projections`, it verifies help output
parity, real native-validated collection, trust failures, relative output paths
in the caller's repository, and missing-build diagnostics. A refusing local
proxy combined with disabled update checks catches any unexpected API or network
calls from `gh`, using only a fake offline authentication sentinel rather than
real user credentials, and temporary registration and config are cleaned up with
the fixture. While explicit npm preparation or production dependency installs
may talk to the npm registry, the launcher and local gh proof never install
anything themselves or call a live GitHub API.
