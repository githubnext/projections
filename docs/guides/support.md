# Support and compatibility

Projections is currently pre-1.0 and does not offer a long-term-support line.
Package names and versions in the source tree don't imply registry availability
or long-term compatibility guarantees—everything ships together under a single
version ([releasing](../maintainers/releasing.md)), and maintenance commitments
are stated with each release.

## Runtime and platform scope

- **Building from source** requires Node >=26.12.1, npm, and the checked-in
  Rustup toolchain. The semantic implementation compiles both natively and to
  Wasm from the same source.
- **CI and release platforms:** Native CI runs on Linux and macOS, alongside the
  Rust test suites on Windows. Release executables are built and verified
  natively for macOS (arm64, x64), Linux (x64, arm64, statically linked with
  musl so there is no glibc floor), and Windows (x64, arm64). Browser behavior
  is verified against Chromium and WebKit desktop and mobile profiles; a macOS
  job without browser checks does not count as browser acceptance. Always check
  the actual revision's test results rather than inferring a pass from
  configured jobs or another platform.
- **Native Engine binaries:** A packed native Engine executable is tied to the
  OS and architecture it was built on, and incompatible hosts are rejected.
  Build on the target platform or supply a matching executable—these packages do
  not ship a universal multi-platform native binary.
- **The CLI** is a self-contained native executable distributed through GitHub
  releases (downloaded directly, via the release's shell or PowerShell
  installer, or installed locally with `gh extension install` on the downloaded
  file); it is not published to npm or Homebrew. It runs without Node and
  bundles its browser client, comparators, and extractor helpers, unpacking them
  into a verified per-user cache. Optional ecosystem extractors still need their
  own language tools—for instance, TypeScript compiler-backed collection
  requires Node and the repository's own compiler rather than a Node CLI or
  server fallback. There are no automatic update checks;
  `gh extension install githubnext/gh-projections` and `gh extension upgrade`
  will work once the release-only companion repository mirrors the assets.
- **Platform caveats:** On Windows, extractor process trees are supervised with
  Job Objects, and symlinks inside examined revisions are skipped as special
  entries. Passing Docker checks does not establish Podman support, and untested
  browser or toolchain combinations remain unverified.

Because extractors have optional ecosystem dependencies, installing the browser
viewer or Engine does not install language toolchains for you. Check
[runner coverage](../maintainers/runner-coverage.md) and each extractor's
documentation for native test inputs, pinned fixture versions, and known
limitations. A tested fixture version is evidence that it worked, not a promise
of third-party security maintenance—projects remain responsible for supplying
compatible, maintained tools.

## Contracts and failures

Wire formats are versioned independently of package releases. The
[v0 contracts](../contracts.md) define the supported schemas, identity rules,
hashing, limits, and diagnostics. Unsupported versions, malformed data,
unavailable artifacts, and failed collections always surface as explicit errors;
Projections never silently guesses at unknown formats or turns failed input into
empty success data.

Any change to a wire contract requires an explicit compatibility and version
decision along with native and browser conformance tests. Internal
implementation changes are never a reason to weaken recorded artifact claims or
authorization checks.

GitHub-backed artifact retention is controlled by each repository's Actions
settings, not by Projections.

For source contributions, see [the contributor guide](../../CONTRIBUTING.md). To
report a security issue, follow [the security policy](../../SECURITY.md).
