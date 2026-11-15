# Local runner and CLI

The native CLI uses Clap, native Git/process orchestration, an in-process
Inspector service (served to the VS Code extension over standard input and
output; there is no listener) and the shared Rust Engine library directly.
Running it does not require Node. There is no TypeScript embedding API: the
native CLI is the only orchestration implementation, and other programs invoke
it or consume its documents. There is no JavaScript semantic fallback or
implicit install.

The CLI is one self-contained executable per platform. It embeds the Inspector
client with the built-in renderer bundles, the default comparator and the
comparator rules interpreter, the extractor helpers, its license and complete
third-party notices; nothing else is installed beside it. The CLI makes no
network request unless a command needs one (`pr` acquisition), and never checks
for updates. `init`, `list`, `doctor` and `extractor` do not execute extractors.
Data-only extraction, Git capture, comparisons, batches and Inspector startup
need only Git. Optional language toolchains remain explicit extractor
dependencies, never a CLI/server fallback. [Install the CLI](setup/install.md)
lists every platform's release asset, how to verify it and how to use it as
`gh projections`.

## Pages

Each page covers one part of the runner:

- [Commands](runner/commands.md): every command, its errors, output and images.
- [Definitions and execution](runner/execution.md): where definitions live,
  where each revision is extracted, comparators and scopes.
- [Environments, workspaces and isolation](runner/environments.md): toolchain
  extractors' environments, workspaces and optional container isolation.
- [Batch runs and saved documents](runner/batches.md): `--all` runs, saved
  scenarios and saved documents.
- [Untrusted pull request review](runner/pull-requests.md): reviewing a pull
  request with `pr`, without running its code.
- [Caches and stores](runner/caches.md): the helper and extraction caches, the
  generation store and CI artifacts.
- [Building the CLI](runner/building.md): building from source, release builds
  and the source-built GitHub CLI extension.
- [Stdio backend](runner/stdio-backend.md): `serve --stdio`, the Inspector's
  backend for editor extensions, with its requests, fixtures mode and comparator
  tests.
- [Agent tools](runner/agent-tools.md): `mcp`, the tools coding agents call, and
  the viewer.
