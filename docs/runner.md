# Local runner and CLI

The Projections CLI is a single, self-contained native executable for each
platform. Under the hood, it combines Clap, native Git and process
orchestration, the shared Rust Engine library, and an in-process Inspector
service that communicates with the VS Code extension over standard input and
output without opening a network port. Running the CLI does not require Node,
and there is no TypeScript embedding API, JavaScript semantic fallback, or
implicit install—other tools either invoke the CLI directly or read the
documents it produces.

Everything the CLI needs is embedded in the binary itself: the Inspector client
and built-in renderer bundles, the default comparator and rules interpreter, the
extractor helpers, its license, and full third-party notices. Nothing extra is
installed alongside it. The CLI never checks for updates and only makes network
requests when a command explicitly needs them (such as `pr` acquisition).
Commands like `init`, `list`, `doctor`, and `extractor` never run extractors at
all, and data-only extraction, Git capture, comparisons, batches, and Inspector
startup require only Git. Optional language toolchains stay explicit extractor
dependencies rather than CLI or server fallbacks. See
[Install the CLI](setup/install.md) for platform release assets, verification
steps, and instructions for running it as `gh projections`.

## Pages

Each page below covers one part of the runner:

- [Commands](runner/commands.md) covers every subcommand, error handling, output
  formats, and image rendering.
- [Definitions and execution](runner/execution.md) explains where definitions
  live, where each revision is extracted, how comparators run, and how scopes
  work.
- [Environments, workspaces and isolation](runner/environments.md) describes how
  toolchain extractors manage environments, workspaces, and optional container
  isolation.
- [Batch runs and saved documents](runner/batches.md) covers `--all` runs, saved
  scenarios, and saved extraction and comparison documents.
- [Untrusted pull request review](runner/pull-requests.md) explains how to
  review a pull request with `pr` without executing its code.
- [Caches and stores](runner/caches.md) documents the helper cache, extraction
  cache, generation store, and CI artifacts.
- [Building the CLI](runner/building.md) walks through building from source,
  release builds, and the source-built GitHub CLI extension.
- [Stdio backend](runner/stdio-backend.md) details `serve --stdio`, the
  Inspector's backend for editor extensions, along with its requests, fixtures
  mode, and comparator tests.
- [Agent tools](runner/agent-tools.md) covers `mcp`, the tools coding agents
  call, and the local viewer.
