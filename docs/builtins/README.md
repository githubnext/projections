# Built-in extractors, renderers and comparator

Every projection has three parts: an **extractor** reads the repository, a
**comparator** decides what changed between two revisions, and a **renderer**
draws the result. Projections ships built-ins for each, and any part can be your
own. Each page here says what one built-in shows, what it reads, its options,
what a comparison reports, and when to build your own instead. The VS Code
extension opens these pages when you select a built-in part.

## Extractors

<!-- generated: extractors -->
<!-- prettier-ignore -->
| Extractor | What it reads | Schema | Drawn with |
|---|---|---|---|
| [`workspace-dependencies`](extractors/workspace-dependencies.md) | Node workspace packages, declared dependency ranges and lockfile resolutions for npm, pnpm and Yarn. | `graph/v0` | [`dependencies`](renderers/graph.md) |
| [`repository-map`](extractors/repository-map.md) | Tracked and untracked nonignored file hierarchy. | `graph/v0` | [`file-packing`](renderers/file-packing.md) |
| [`typescript-public-api`](extractors/typescript-public-api.md) | TypeScript compiler public export model. | `api/v0` | [`api`](renderers/api.md) |
| [`rust-public-api`](extractors/rust-public-api.md) | rustdoc JSON public items. | `api/v0` | [`api`](renderers/api.md) |
| [`go-public-api`](extractors/go-public-api.md) | go/types exported declarations, method sets and fields. | `api/v0` | [`api`](renderers/api.md) |
| [`cargo-dependencies`](extractors/cargo-dependencies.md) | Resolved Cargo metadata. | `graph/v0` | [`dependencies`](renderers/graph.md) |
| [`nuget-dependencies`](extractors/nuget-dependencies.md) | Resolved NuGet project.assets.json graph. | `graph/v0` | [`dependencies`](renderers/graph.md) |
| [`terraform-infrastructure`](extractors/terraform-infrastructure.md) | Terraform resources, modules and references, with each resource's planned action. | `architecture/v0` | [`infrastructure`](renderers/graph.md) |
| [`azure-what-if`](extractors/azure-what-if.md) | Azure resources, containment and references, with each resource's what-if change. | `architecture/v0` | [`infrastructure`](renderers/graph.md) |
| [`github-actions-jobs`](extractors/github-actions-jobs.md) | Jobs and needs declared by a GitHub Actions workflow. | `dag/v0` | [`dag`](renderers/graph.md) |
| [`github-agentic-workflows`](extractors/github-agentic-workflows.md) | GitHub Agentic Workflows: what starts each one, its engine, tools and their scope, network, permissions, safe outputs, budgets and imports, and whether its lock file is current. | `architecture/v0` | [`agentic-workflows`](renderers/agentic-workflows.md) |
| [`tetragon-policies`](extractors/tetragon-policies.md) | Kernel and user-space hooks that Tetragon tracing policies observe or enforce, with their conditions and the workloads they apply to. | `architecture/v0` | [`runtime-policy`](renderers/runtime-policy.md) |
| [`dotnet-public-api`](extractors/dotnet-public-api.md) | Roslyn/.NET effective public API. | `api/v0` | [`api`](renderers/api.md) |
| [`dotnet-di`](extractors/dotnet-di.md) | Executed .NET service registrations and the constructor graph they compose. | `architecture/v0` | [`dependency-injection`](renderers/dependency-injection.md) |
| [`nestjs-di`](extractors/nestjs-di.md) | NestJS modules, providers and the dependency graph the application's own container resolves. | `architecture/v0` | [`dependency-injection`](renderers/dependency-injection.md) |
| [`spring-di`](extractors/spring-di.md) | Spring Boot beans and the dependencies the application's own bean factory resolves. | `architecture/v0` | [`dependency-injection`](renderers/dependency-injection.md) |
| [`efcore-schema`](extractors/efcore-schema.md) | Effective EF Core model. | `database/v0` | [`database`](renderers/database.md) |
| [`django-schema`](extractors/django-schema.md) | Initialized Django application model registry. | `database/v0` | [`database`](renderers/database.md) |
| [`code-statistics`](extractors/code-statistics.md) | Counted files, code, comment and blank lines by language, split into test and other files. | `metrics/v0` | [`code-statistics`](renderers/code-statistics.md) |
| [`prisma-schema`](extractors/prisma-schema.md) | Prisma data model: tables, columns, keys, indexes, relations and enums. | `database/v0` | [`database`](renderers/database.md) |
| [`rails-schema`](extractors/rails-schema.md) | Rails db/schema.rb: tables, columns, keys, indexes, foreign keys and enums. | `database/v0` | [`database`](renderers/database.md) |
| [`rails-routes`](extractors/rails-routes.md) | Rails config/routes.rb: each route's verb, path, controller action and name. | `api/v0` | [`api`](renderers/api.md) |
| [`renderer-scenarios`](extractors/renderer-scenarios.md) | Renderer fixture scenarios (projections.scenarios documents) with their synthetic extractions and comparisons. | `graph/v0` | `gallery` |
| [`scip-file-references`](extractors/scip-file-references.md) | Cross-file definition references from a SCIP index produced by the project's own indexer. | `graph/v0` | [`graph`](renderers/graph.md) |
| [`command-output`](extractors/command-output.md) | Captured stdout from named CLI commands. | `graph/v0` | [`text-diff`](renderers/text-diff.md) |

<!-- end generated: extractors -->

## Comparator

The [default comparator](comparators/default.md) matches items by ID and
declared renames, decides each change's status and orders the steps. A
comparator file layers your own rules over it.

## Renderers

<!-- generated: renderers -->
<!-- prettier-ignore -->
| Renderer | What it draws | Also answers to |
|---|---|---|
| [Agentic workflows](renderers/agentic-workflows.md) | Each workflow's triggers, scope, outputs and budgets, and the direction each change moves them. | — |
| [API](renderers/api.md) | Exported declarations with before and after signatures. | — |
| [Code statistics](renderers/code-statistics.md) | Per-language counts as bars or share, staged by the comparison's steps. | — |
| [Database](renderers/database.md) | Relationship-aware ERD cards with staged schema transitions. | `schema` |
| [Dependency injection](renderers/dependency-injection.md) | Composed registrations with their lifetime marks, staged by the comparison's steps. | — |
| [File packing](renderers/file-packing.md) | Files as circles sized by their bytes, packed inside their folders. | `treemap` |
| [Graph](renderers/graph.md) | Staged, identity-stable graph transitions (graph, graph-horizontal, dag, architecture, infrastructure and dependencies). | `graph-horizontal`, `dag`, `architecture`, `infrastructure`, `dependencies` |
| [Runtime security policies](renderers/runtime-policy.md) | Hooks, the rules that act there, their effect and who they apply to. | — |
| [Text diff](renderers/text-diff.md) | Captured text outputs compared line by line. | — |

<!-- end generated: renderers -->

## Writing a page

Each built-in has one page, named after its ID (`extractors/<id>.md`,
`renderers/<name>.md`, `comparators/default.md`). `npm run docs:check` fails
when one is missing, and when a page names no built-in. The pages are for people
using the built-in, not for the people maintaining it: internals (ABIs, build
steps, test suites) stay in the package README, linked from the **How it works**
section.

Regions between `<!-- generated: NAME -->` and `<!-- end generated: NAME -->`
come from the CLI's extractor catalog, the renderer manifests and the schemas.
`npm run docs:generate` rewrites them; write everything else by hand. A page has
these sections, in this order, leaving out any that don't apply:

1. The title (the built-in's title) and one paragraph: what it shows and the
   question it answers.
2. The generated `facts`.
3. **When to use it**: the repositories and changes it suits, and what it
   doesn't cover.
4. **What it reads** (extractors), **What it draws** (renderers) or **How it
   decides** (the comparator).
5. **Options**: an extractor's generated `inputs`; a renderer's controls and
   their `presentation.rendererOptions` IDs; the comparator's generated
   `options`.
6. **What a comparison shows**: change kinds, interpretations and summary-bar
   facts.
7. **Start from this definition**: the generated `definition`.
8. A screenshot, when there is one.
9. **Limitations**.
10. **Related**: other built-ins, linked.
11. **How it works**: one line linking the package README.
12. **Build your own**: reasons specific to this part, lighter alternatives
    first, then how to start in VS Code and with the CLI, and the development
    loop.

Write human text in sentence case and data verbatim; put identifiers, paths, IDs
and commands in code spans.
