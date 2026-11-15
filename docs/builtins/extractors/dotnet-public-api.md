# .NET public API

The effective public API of a .NET project: every public and protected type and
member its assembly exports, as the project's own C# compiler (Roslyn) sees it
after its source generators run. Compared across a pull request, it answers
"what did this change add, remove or change in the assembly's API, and does it
break code compiled against it?"

<!-- generated: facts -->

- ID: `dotnet-public-api`
- Extraction schema: [`api/v0`](../../reference/schemas/api.md)
- Drawn by default with: [`api`](../renderers/api.md)
- Needs `--trust`: When it runs ecosystem tools or repository code
  (`when-executing-tools`)
- Suggested when the repository has: `**/*.csproj`

<!-- end generated: facts -->

## When to use it

Use it for class libraries and NuGet packages, to review API changes as
declarations instead of a source diff: a removed overload, a parameter whose
type or name changed, a class that became sealed, an interface that gained a
member. Because it compiles the project the way its build does, members added by
source generators are part of the API too. With the
[`api-compatibility`](#classify-changes-as-breaking) comparator file, each
change is classified by the rules of the .NET SDK's ApiCompat, telling binary
breaks from source breaks.

It needs `--trust` and the project's .NET SDK (see
[What it reads](#what-it-reads)). It supports C# projects. For TypeScript use
[`typescript-public-api`](typescript-public-api.md), for Rust
[`rust-public-api`](rust-public-api.md), for Go
[`go-public-api`](go-public-api.md).

## What it reads

The project at `project` (required), for one `framework` of a multi-targeted
project and the `configuration` (default `Release`):

- **The project's own build.** It runs `dotnet build` into a scratch directory,
  and the build reports its exact compiler arguments: sources, references,
  defines, language version, nullable context, `.editorconfig` severities and
  source generators.
- **The project's own compiler.** A small helper that ships prebuilt with
  Projections (first-party code only) replays those arguments with the Roslyn of
  the SDK that ran the build, the one `global.json` selects. It needs the .NET
  SDK 8.0.100 or newer, as `dotnet` on `PATH` or the `dotnet` input.
- **`--trust`**, because MSBuild targets and source generators are code from the
  repository.
- **NuGet packages** restore as your own build restores them: the project's
  `nuget.config` decides the feeds, and your global packages folder is reused
  when the definition grants `HOME` (or `NUGET_PACKAGES`) in
  `execution.environment`; with neither, and no packages folder set by the
  project, the restore starts from an empty folder.
- **Or a file.** `snapshot` imports an extraction exported earlier; nothing
  runs, and no trust or SDK is needed.

It always compiles `project`; unlike the dependency-injection and EF Core
extractors that share its helper, it takes no prebuilt `assembly`.

The assembly is an `assembly` entity; each exported type a `type`, and each
public or protected member a `method`, `property`, `field` or `event`. Private
and internal members, method bodies and private setters are left out. IDs are
documentation IDs with the assembly's name
(`api:Http:M:Http.Client.Send(Http.Request)`), so each overload is its own
declaration, a changed parameter type is one member removed and one added, and
renaming a type is a removal and an addition. Every declaration carries its
contract (visibility, `virtual` and `sealed`, the full base-type chain,
parameter names and `ref` kinds, accessors, generic constraints, constant
values, attributes), the facts ApiCompat's rules read. A failed build, generator
or compilation fails the extraction.

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

The [`api`](../renderers/api.md) renderer lists every declaration with its
signature, side by side or as one diff:

- **Declarations** added, removed or modified, each with its signature diff.
- **Renames** only when the definition's `correspondence` declares them.

The summary bar counts declarations: `36 declarations +10 −1 ~6`.

### Classify changes as breaking

The default comparator says _that_ a declaration changed. The
`api-compatibility` comparator file, which ships with Projections, says how it
breaks consumers. It is a comparator file, not the default comparator: copy
[`api-compatibility.comparator.yaml`](../../../packages/comparators/api-compatibility/api-compatibility.comparator.yaml)
into your repository and name it in the definition:

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

Each change is then `breaking`, `additive`, `compatible` or `unknown`, with a
reason and the rule that decided it: ApiCompat's diagnostic ID in its default
mode, with its two opt-in rules for parameter names and attributes enabled. A
breaking change says whether it breaks code already compiled against the old
assembly (`binary`), code being compiled (`source`), or both
(`Breaking (binary, source): Return type changed from Receipt to Task<Receipt>.`):

- **Breaking**: a type or member removed or retyped (`CP0001`, `CP0002`), an
  abstract member added to an unsealed type (`CP0005`), an interface member
  added without a default implementation (`CP0006`), a base class or interface
  removed, a type becoming sealed (`CP0009`), an enum value changed, `virtual`
  removed, an attribute removed or changed, a parameter renamed (`CP0017`: it
  breaks named arguments), visibility reduced (`CP0019`), a constant's value
  changed (compiled consumers keep the old one), a parameter's `ref`, `out` or
  `in` changed, a default value or `params` removed.
- **Additive**: new types and members, an accessor added, a parameter gaining a
  default value.
- **Compatible**: `virtual` or an attribute added, visibility expanded, only
  nullable annotations or formatting changed.

The summary bar then counts each level, breaking first
(`2 breaking changes · 5 additive changes · 1 compatible change`), each
filtering to its changes, with the rules
(`ApiCompat (default mode), reproduced`) as its tooltip; the diff lists breaking
changes first with each reason, and the renderer's **Breaking only** control
(`breakingOnly` in `presentation.rendererOptions`) hides the rest. A workflow
can fail a pull request on `metadata.compatibility.counts.breaking`.
[API compatibility](../../models/api-compatibility.md#net-apicompats-default-mode-reproduced)
lists every rule.

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

- One project, one target framework and one configuration per projection; only
  the project's own assembly is read, not the assemblies it references.
- The rules are ApiCompat's, reproduced, not ApiCompat run on your package:
  assembly identity and package-level checks aren't compared, a member moved to
  a base class is reported as removed, and target frameworks aren't compared
  with each other.
- Analyzers and diagnostic suppressors don't run. SDKs before 8.0.300 report
  compiler arguments on stdout, which limits a project to roughly 5,000 source
  files and references.
- Each revision is built, so extraction takes as long as a build, and custom
  MSBuild targets can still have side effects.

## Related

- [`api`](../renderers/api.md), the renderer that draws it.
- The
  [`api-compatibility`](../../../packages/comparators/api-compatibility/README.md)
  comparator file, and [the default comparator](../comparators/default.md) it
  builds on.
- [`typescript-public-api`](typescript-public-api.md),
  [`rust-public-api`](rust-public-api.md) and
  [`go-public-api`](go-public-api.md): the same model for other languages.
- [`dotnet-di`](dotnet-di.md), [`efcore-schema`](efcore-schema.md) and
  [`nuget-dependencies`](nuget-dependencies.md), more of a .NET application.

## How it works

The [package README](../../../packages/extractors/dotnet-public-api/README.md)
summarizes what it records, and
[.NET support](../../../packages/extractors/dotnet-support/README.md) details
the build replay, NuGet handling and the helper.

## Build your own

Write your own extractor when the compiled C# API isn't the surface you need to
review:

- **Another surface**: an ASP.NET Core application's HTTP endpoints, a gRPC
  contract, the messages a service publishes, or a library written in F# or
  Visual Basic.
- **Facts Roslyn doesn't have**: which APIs are marked preview in your release
  notes, `PublicAPI.Shipped.txt` baselines, owners, or usage counts from your
  telemetry.
- **Another grain**: one entity per namespace or per package in a solution.

Try the lighter options first: `framework` and `configuration` choose what is
compiled, and `snapshot` imports an API your build already exported. To change
what counts as breaking (to ignore parameter renames, say), copy
`api-compatibility.comparator.yaml` and edit its rules; to draw the API
differently, keep this extractor and write a renderer.

**In VS Code**, choose **+ New Projection…** in the Projections view, then
**Write a custom extractor, renderer or comparator** › **Custom extractor** (or
**Custom extractor and renderer**), and pick its language: the repository's
toolchain, Node.js, Python or Go. It writes the definition and a starter
extractor under `.github/projections/<id>/`, drawn by the built-in graph
renderer. Or choose **Ask an agent to write it** and describe what the
projection should show.

**With the CLI**, keep the `api` renderer:

```sh
projections init <id> --language node --renderer api
```

An extractor that writes `api/v0` declarations with a `data.signature` is drawn
by the `api` renderer. Run it with `projections show -p <id> --trust` as you
change it; an open projection tab uses your uncommitted edits ("Your edits") and
says when its results are out of date, and the Testing view runs the
projection's checks.
[Write your first extractor](../../guides/first-extractor.md) walks through one,
and [Extraction schema](../../guides/schemas.md#extraction-schema) describes
what it prints.
