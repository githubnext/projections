# Support and compatibility

Projections is pre-1.0, not a long-term-support line. Package names and versions
in source do not imply registry availability or compatibility commitments:
everything releases together at one version
([releasing](../maintainers/releasing.md)), and maintenance commitments are
stated with each release.

## Runtime and platform scope

- Source builds require Node >=26.12.1, npm and the checked-in Rustup toolchain.
  The semantic implementation builds natively and to Wasm from the same source.
- The native CI matrix is Linux and macOS, plus the Rust suites on Windows.
  Release executables are built and proved natively for macOS (arm64, x64),
  Linux (x64, arm64; statically linked with musl, so no glibc floor) and Windows
  (x64, arm64). Chromium and WebKit desktop/mobile profiles cover browser
  behavior; a macOS job without browser checks is not browser acceptance.
  Consult the actual revision's results rather than inferring a pass from
  configured jobs or another platform.
- A packed native Engine executable belongs to its build host OS/architecture.
  An incompatible host is rejected. Build on that host or explicitly supply a
  compatible executable; these packages do not claim a universal multi-platform
  native binary.
- The CLI is a self-contained native executable, installed from GitHub releases
  (directly, with the release's shell or PowerShell installer, or as a local
  `gh extension install` of the downloaded file); it is not published to npm or
  Homebrew. It runs without Node and embeds its browser client, comparators and
  extractor helpers, which it unpacks into a verified per-user cache. Optional
  ecosystem extractors still require their selected language tools; TypeScript
  compiler-backed collection explicitly requires Node and the repository's own
  compiler, not a Node CLI or server fallback. There are no automatic update
  checks; `gh extension install githubnext/gh-projections` and
  `gh extension upgrade` will work once the release-only companion repository
  mirrors the assets.
- On Windows, extractor process trees are supervised with Job Objects and
  symlinks in examined revisions are skipped as special entries. Docker evidence
  does not establish Podman support. Untested browser/toolchain combinations
  remain unverified.

Extractors have optional ecosystem dependencies; installing the browser viewer
or Engine does not install every language toolchain. Refer to
[runner coverage](../maintainers/runner-coverage.md) and each extractor's
documentation for explicit native test inputs, pinned fixture versions and
limitations. A tested fixture version is evidence, not a promise of third-party
security maintenance. Projects remain responsible for supplying compatible,
maintained tools.

## Contracts and failures

The official wire formats are versioned independently from package releases. The
[v0 contracts](../contracts.md) specify supported schemas, identity, hashing,
limits and diagnostics. Unsupported versions, malformed data, unavailable
artifacts and failed collection must remain explicit errors; do not silently
interpret unknown formats or replace failed input with successful empty data.

Changes to a wire contract require an explicit compatibility/version decision
and native/browser conformance coverage. Changes to implementation details do
not justify weakening recorded artifact claims or authorization checks.

GitHub-backed artifact retention is governed by each repository's Actions
settings, not by Projections.

Use [the contributor guide](../../CONTRIBUTING.md) for source changes and
[the security policy](../../SECURITY.md) for sensitive reports.
