# .NET public API

This extractor captures the effective public API of a .NET project—every public
and protected type and member its assembly exports, exactly as the project's own
C# compiler (Roslyn) sees it after source generators run. Compared across a pull
request, it shows what was added, removed, or altered in the assembly's surface,
and whether those changes break downstream callers.

<!-- generated: facts -->

- ID: `dotnet-public-api`
- Extraction schema: [`api/v0`](../../reference/schemas/api.md)
- Drawn by default with: [`api`](../renderers/api.md)
- Needs `--trust`: When it runs ecosystem tools or repository code
  (`when-executing-tools`)
- Suggested when the repository has: `**/*.csproj`

<!-- end generated: facts -->

## When to use it

Use this extractor for class libraries and NuGet packages when you want to
review API changes as clean declarations rather than scanning a source diff. It
surfaces removed overloads, parameter type or name changes, newly sealed
classes, and new interface members right away. Because it compiles the project
the same way your build does, members emitted by source generators are included
automatically. Pairing it with the
[`api-compatibility`](#classify-changes-as-breaking) comparator file classifies
every change using the .NET SDK's ApiCompat rules, distinguishing binary breaks
from source breaks.

Extraction requires `--trust` and the project's .NET SDK (see
[What it reads](#what-it-reads)), and currently supports C# projects. For
TypeScript use [`typescript-public-api`](typescript-public-api.md), for Rust use
[`rust-public-api`](rust-public-api.md), and for Go use
[`go-public-api`](go-public-api.md).

## What it reads

You point it at a required `project`, optionally choosing one `framework` in a
multi-targeted project and a `configuration` (default `Release`):

- **The project's own build.** It runs `dotnet build` into a scratch directory
  to capture the exact compiler arguments—sources, references, preprocessor
  defines, language version, nullable context, `.editorconfig` severities, and
  source generators.
- **The project's own compiler.** A small prebuilt helper shipped with
  Projections (first-party code only) replays those compiler arguments using the
  Roslyn instance from the SDK that ran the build (selected by `global.json`).
  This requires .NET SDK 8.0.100 or newer, either as `dotnet` on `PATH` or via
  the `dotnet` input.
- **`--trust`** is required because MSBuild targets and source generators run
  repository code.
- **NuGet packages** restore just as they do in your normal build. Your
  `nuget.config` selects the feeds, and your global packages cache is reused if
  the definition grants `HOME` (or `NUGET_PACKAGES`) in `execution.environment`;
  without either (and with no project-level packages folder), restore starts
  from an empty cache.
- **Or a file.** Pass `snapshot` to import a previously exported
  extraction—nothing runs, and neither `--trust` nor the SDK is needed.

Unlike the dependency-injection and EF Core extractors that share the same
helper, this extractor always compiles `project` and does not accept a prebuilt
`assembly`.

The assembly becomes an `assembly` entity, each exported type becomes a `type`,
and each public or protected member becomes a `method`, `property`, `field`, or
`event`. Private and internal members, method bodies, and private setters are
excluded. Entity IDs use XML documentation IDs prefixed with the assembly name
(`api:Http:M:Http.Client.Send(Http.Request)`), so each overload is its own
declaration, changing a parameter type appears as a removal plus an addition,
and renaming a type appears as a removal plus an addition. Every declaration
records its full contract—visibility, `virtual` and `sealed` modifiers, the
complete base-type chain, parameter names and `ref` kinds, accessors, generic
constraints, constant values, and attributes—providing the facts ApiCompat's
rules inspect. Any build, generator, or compilation error fails the extraction.

## Options

<!-- generated: inputs -->

| Input           | Meaning                                                                  |
| --------------- | ------------------------------------------------------------------------ |
| `configuration` | Build configuration; default Release.                                    |
| `dotnet`        | The dotnet executable path, not a shell command; default dotnet on PATH. |
| `framework`     | Target framework.                                                        |
| `project`       | Project path to compile.                                                 |
| `snapshot`      | Pre-exported graph-backed API state.                                     |

<!-- end generated: inputs -->

## What a comparison shows

The [`api`](../renderers/api.md) renderer displays every declaration with its
signature, either side by side or in a unified diff:

- **Added, removed, or modified declarations** appear with inline signature
  diffs.
- **Renames** are tracked when declared in `correspondence` in your definition.

The summary bar tallies declarations and deltas (for example,
`36 declarations +10 −1 ~6`).

### Classify changes as breaking

By default, the comparator only reports _that_ a declaration changed. To see
whether a change breaks consumers, use the `api-compatibility` comparator file
shipped with Projections. Copy
[`api-compatibility.comparator.yaml`](../../../packages/comparators/api-compatibility/api-compatibility.comparator.yaml)
into your repository and reference it in your definition:

```json
{
  "id": "api",
  "title": "Public API",
  "extractor": "dotnet-public-api",
  "renderer": "api",
  "inputs": {"project": "src/Http/Http.csproj"},
  "comparator": ".github/projections/api-compatibility.comparator.yaml",
  "execution": {"timeoutMs": 300000, "environment": ["HOME"]}
}
```

With that comparator enabled, each change is classified as `breaking`,
`additive`, `compatible`, or `unknown`, paired with a reason and the ApiCompat
diagnostic ID that triggered it (matching ApiCompat's default mode plus its two
opt-in rules for parameter names and attributes). Breaking changes specify
whether they break already-compiled callers (`binary`), code being recompiled
(`source`), or both—for example,
`Breaking (binary, source): Return type changed from Receipt to Task<Receipt>.`:

- **Breaking** covers removed or retyped types and members (`CP0001`, `CP0002`),
  adding an abstract member to an unsealed type (`CP0005`), adding an interface
  member without a default implementation (`CP0006`), removing a base class or
  interface, sealing a type (`CP0009`), changing an enum value, removing
  `virtual`, removing or altering an attribute, renaming a parameter (`CP0017`,
  which breaks named arguments), narrowing visibility (`CP0019`), changing a
  constant's value (since compiled callers inline the old value), changing a
  parameter's `ref`, `out`, or `in` modifier, or removing a default value or
  `params`.
- **Additive** covers new types and members, newly added accessors, and
  parameters that gain a default value.
- **Compatible** covers adding `virtual` or an attribute, widening visibility,
  and changes limited to nullable annotations or formatting.

The summary bar groups counts by severity, listing breaking changes first
(`2 breaking changes · 5 additive changes · 1 compatible change`), with each
count acting as a filter and a tooltip noting the rule set
(`ApiCompat (default mode), reproduced`). Breaking changes also appear at the
top of the diff with their explanations, and the **Breaking only** toggle
(`breakingOnly` in `presentation.rendererOptions`) hides everything else. CI
workflows can fail a pull request based on
`metadata.compatibility.counts.breaking`. See
[API compatibility](../../models/api-compatibility.md#net-apicompats-default-mode-reproduced)
for the complete rule list.

## Start from this definition

<!-- generated: definition -->

```json
{
  "extractor": "dotnet-public-api",
  "id": "dotnet-public-api",
  "inputs": {
    "project": "src/App/App.csproj"
  },
  "renderer": "api",
  "title": ".NET public API"
}
```

<!-- end generated: definition -->

## Limitations

- Each projection targets a single project, target framework, and configuration,
  and inspects only that project's own assembly—not referenced assemblies.
- Compatibility checks reproduce ApiCompat's rules rather than running ApiCompat
  directly on your NuGet package. Assembly identity and package-level checks are
  not evaluated, moving a member up to a base class shows as a removal, and
  different target frameworks are not cross-compared.
- Roslyn analyzers and diagnostic suppressors do not run. On SDKs older than
  8.0.300, compiler arguments are passed via stdout, which caps a project at
  roughly 5,000 source files and references.
- Because each revision is compiled, extraction takes about as long as a normal
  build, and custom MSBuild targets can still execute side effects.

## Related

- [`api`](../renderers/api.md) is the renderer that displays these declarations.
- The
  [`api-compatibility`](../../../packages/comparators/api-compatibility/README.md)
  comparator file extends [the default comparator](../comparators/default.md)
  with breaking-change rules.
- [`typescript-public-api`](typescript-public-api.md),
  [`rust-public-api`](rust-public-api.md), and
  [`go-public-api`](go-public-api.md) offer the same model for other languages.
- [`dotnet-di`](dotnet-di.md), [`efcore-schema`](efcore-schema.md), and
  [`nuget-dependencies`](nuget-dependencies.md) cover other parts of a .NET
  codebase.

## How it works

See the
[package README](../../../packages/extractors/dotnet-public-api/README.md) for
what gets recorded, and
[.NET support](../../../packages/extractors/dotnet-support/README.md) for build
replay, NuGet restore behavior, and helper details.

## Build your own

Consider writing a custom extractor when the compiled C# API is not the surface
you need to review:

- **Another surface**, such as ASP.NET Core HTTP endpoints, a gRPC contract,
  messages published by a service, or a library written in F# or Visual Basic.
- **Facts Roslyn does not know**, like preview markers from release notes,
  `PublicAPI.Shipped.txt` baselines, team ownership, or usage telemetry.
- **A different level of detail**, such as one entity per namespace or per
  package in a solution.

Check the built-in options first: `framework` and `configuration` select what
gets built, and `snapshot` imports an API your CI build already exported. If you
want to customize what counts as breaking (for example, ignoring parameter
renames), copy `api-compatibility.comparator.yaml` and adjust its rules. To
change the visual presentation, keep this extractor and write a custom renderer.

**In VS Code**, open the Projections view, choose **+ New Projection…**, and
select **Write a custom extractor, renderer or comparator** › **Custom
extractor** (or **Custom extractor and renderer**). Pick a language (your
repository's toolchain, Node.js, Python, or Go) to scaffold the definition and a
starter extractor under `.github/projections/<id>/`, paired with the built-in
graph renderer. You can also choose **Ask an agent to write it** and describe
what you want to see.

**With the CLI**, scaffold a new extractor while keeping the `api` renderer:

```sh
projections init <id> --language node --renderer api
```

Any extractor that emits `api/v0` declarations with a `data.signature` works
with the `api` renderer. Run `projections show -p <id> --trust` while you
iterate—an open projection tab picks up your uncommitted edits ("Your edits")
and flags stale results, and the Testing view runs your projection's checks.
Walk through [Write your first extractor](../../guides/first-extractor.md) to
get started, and check
[Extraction schema](../../guides/schemas.md#extraction-schema) for the output
format.
