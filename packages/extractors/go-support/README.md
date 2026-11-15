---
description: "Shared support for the Go extractors: their helper module"
---

# Go support

`projections-extractor-go-support` is shared by the Go extractors; it registers
no extractor itself. It runs the `helper/` Go module against the examined
project's packages with the project's own Go toolchain and returns the helper's
JSON output.

```rust
let patterns = projections_extractor_go_support::patterns(definition)?;
let output = projections_extractor_go_support::run_helper(cx, "<mode>", patterns)?;
```

## Inputs

| Key            | Meaning                                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `patterns`     | Go package pattern array, default `["./..."]`, interpreted from the repository root. Flags are rejected.                  |
| `goPath`       | Go executable, default `go`. An absolute override also adds its directory to the helper's PATH for the `go list` it runs. |
| `goHelperPath` | Optional already-built helper executable, bypassing `go run`.                                                             |

Running the helper requires `--trust`.

## Requirements

- The project's own Go toolchain, Go 1.24 or newer, on PATH or `goPath`
  (verified with Go 1.24.0 and 1.27.1; CI uses 1.25.7). Missing or older
  toolchains fail with an explicit requirement message; nothing is installed.
- Nothing else. The `helper/` module uses only the Go standard library (no
  `go.sum`, no vendored modules), and Projections ships its source with the
  executable (`helpers/go`). It runs
  `go run -mod=mod . <mode> -dir <repository> <patterns...>` from the helper
  module, so building the helper needs no network access or module cache.

Go uses **your existing caches**: the `GOMODCACHE` and `GOCACHE` granted through
`execution.environment`, otherwise those `go env GOMODCACHE` and
`go env GOCACHE` report for your own Go configuration, so dependencies you
already downloaded are not fetched again and packages you already built are not
rebuilt. Like every extractor, a Go extractor sees only the variables the
definition grants, so grant the ones your configuration lives in, typically
`HOME` (or `USERPROFILE`, `LOCALAPPDATA` and `APPDATA` on Windows), and any of
`XDG_CONFIG_HOME`, `XDG_CACHE_HOME`, `GOPATH` and `GOENV` you set. They are used
only to ask Go where the caches are, never passed to the build. When Go reports
no build cache (`GOCACHE=off`), a private one is used. It runs with a private
`GOPATH` and `GOTOOLCHAIN=local` (Go never downloads another toolchain). The
project's own module dependencies are the project's concern: `go list` resolves
them as the repository's Go would. To use the CI's module cache or vendoring, or
to allow toolchain switching, grant any of `GOMODCACHE`, `GOCACHE`, `GOPATH`,
`GOFLAGS`, `GOPROXY`, `GOTOOLCHAIN` (or other Go variables) through
`execution.environment`; granted `GOFLAGS` never change how the helper is built.
Without network access, the project's own dependencies must already be vendored
or present in the module cache. When the module cache can't be determined (for
example, with neither `HOME` nor `GOPATH` granted), the helper fails and asks
for `GOMODCACHE`.

## Helper

`helper/load.go` loads the program once for every mode. It resolves packages
with `go list -export -compiled -deps`, which also builds export data for their
dependencies, then type-checks the matched packages (and any dependency that
imports one) from source with `go/types`, importing everything else from that
export data, so each package has one type identity. Build tags, GOOS, GOARCH and
toolchain selection affect the effective program. Load and type errors fail
rather than producing a partial program.

`helper/main.go` dispatches on the first argument, a mode, which turns the
loaded program into one JSON document on stdout. Add a mode by adding an entry
to `modes`. The `packages` mode reports the matched packages and their
package-scope names; it proves loading and type checking. The `api` mode
(`api.go`, with `api_types.go` and `api_facts.go`) writes the
[Go public API](../go-public-api/README.md) as `api/v0`.

The helper must keep using only the standard library; its `go` directive is the
oldest Go release Projections supports. Build a portable helper with
`cd helper && go build -o <destination> .` and pass `goHelperPath` when a
production installation should not run `go run`.

## Tests

Unit tests cover toolchain detection, cache resolution and argument handling
with a fake host.
`PROJECTIONS_NATIVE_ECOSYSTEMS=1 cargo test -p projections-cli --test native_tools native_go`
runs the helper with the installed Go over `tests/fixtures/go` and the
multi-package `tests/fixtures/go-packages`.
