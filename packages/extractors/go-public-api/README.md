---
description: "Go packages' public API, via go/types (go-public-api)"
---

# Go public API — `go-public-api`

The public API of the matched Go packages, read with `go/types` by the shared
[Go helper](../go-support) (`api` mode, Go standard library only) and the
project's own Go toolchain: every exported package-level declaration of every
importable package, the method sets and selectable fields of its types, and the
contract facts
[apidiff](https://github.com/golang/exp/blob/master/apidiff/README.md)'s rules
inspect. The
[`api-compatibility` comparator](../../comparators/api-compatibility) classifies
changes from them; see
[API compatibility](../../../docs/models/api-compatibility.md#go-apidiffs-rules).

```json
{
  "extractor": "go-public-api",
  "renderer": "api",
  "inputs": {"patterns": ["./..."]},
  "comparator": ".github/projections/api-compatibility.comparator.yaml",
  "execution": {"timeoutMs": 300000, "environment": ["HOME", "GOCACHE", "GOMODCACHE"]}
}
```

Inputs (`patterns`, `goPath`, `goHelperPath`), requirements (Go 1.24 or newer,
`--trust`) and cache handling are those of
[Go support](../go-support/README.md).

## Model

Each declaration's `data.contract` holds the
[language-neutral contract facts](../../../docs/reference/schemas/api.md#contract):
its `declaration` and, as `term`, Go's kind of object (`const`, `var`, `func`,
`type`, `method`, `field`, `package`). The facts only the Go rules read are in
`contract.native`.

<!-- prettier-ignore -->
| Entity kind | Declarations | Contract facts | `native` |
|---|---|---|---|
| `package` | Each importable matched package (`internal` and `main` packages are skipped) | — | — |
| `constant`, `variable`, `function` | Exported package-level objects | `type` (parameter names omitted), `value` (exact) | — |
| `type` | Exported type names: `declaration` `struct`, `interface`, `alias` or `type` | `type` (an alias's aliased type), `underlying`, `typeParameters`, `sealed` (interfaces with unexported methods), `supertypes` (the package's exported interfaces the type or its pointer implements) | `comparable`, `underlying` (the kind), `numeric` (family and size on 32- and 64-bit), `channel` |
| `method` | A type's exported method set, or an interface's methods | `type`, `abstract` (an interface's) | `receiver` (`value`: in both method sets; `pointer`: the pointer's only), `promoted` |
| `field` | Every exported field a selector reaches, including promoted ones | `type` | `embedded`, `promoted` |

IDs use the import path: `go:example.com/ledger.Ledger`, methods and fields
`go:example.com/ledger.Ledger.Len`. Types of other packages are written with
their package name. The extraction declares `metadata.ecosystem: "go"`.

`tests/fixtures/compatibility` holds a before and after module whose every
change the native test classifies:

```sh
PROJECTIONS_NATIVE_GO=1 cargo test -p projections-cli --test native_tools native_go_public_api
```

With `PROJECTIONS_APIDIFF=1` (it downloads apidiff at a pinned version with
`go run`), the test also runs apidiff on the pair and requires its incompatible
changes to be exactly those classified as breaking, and its compatible changes
exactly the rest.
