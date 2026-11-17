# Domain model and vocabulary plan

Status: **adopted**. These decisions are implemented by protocol version 0, the
native CLI, the built-in and WebAssembly comparators, the sandboxed renderer
host and the built-in renderers. The [guide](../guides/how-it-works.md) is the
user-facing account;
[mapping from the previous implementation](#mapping-from-the-current-implementation)
records how the earlier vocabulary was replaced, and
[remaining bounded questions](#remaining-bounded-questions) lists open work.

## Goals

The open-source product needs a domain model that is precise enough for external
implementers and plain enough for users who only choose a view on a pull
request. Each term should have one meaning, avoid strong collisions with common
developer tools, and describe a responsibility rather than a particular
presentation. In particular, nothing in the model may assume a visual
presentation: every result must be presentable to people who don't rely on
vision or motion.

## Core decisions

### Showing one revision is a complete use

Viewing a single revision, such as the current state of the default branch, is a
complete and valuable use of Projections. Comparing two revisions is a core
feature built on top of that, not a prerequisite. Documentation, CLI design and
renderer contracts lead with the single-revision case.

```
  revision ──▶ extractor ──▶ extraction ──▶ renderer
```

```
  base revision ──▶ extractor ──▶ extraction ─┐
                                              ├─▶ comparator ──▶ comparison ──▶ renderer
  head revision ──▶ extractor ──▶ extraction ─┘
```

### Vocabulary

<!-- prettier-ignore -->
| Term | Meaning |
|---|---|
| **Projection** | A user-facing, selectable view of one aspect of a codebase, such as *Package dependencies*. It combines an extractor, a comparator and a renderer, along with their configuration. It is partly a product and UI term; users choose projections. A *projection definition* is the file that declares one. |
| **Revision** | The version of a repository an extractor examines: a commit, or a working tree including uncommitted changes. |
| **Extractor** | A program that examines one revision and produces an extraction. Users can write extractors in any language. |
| **Extraction** | A JSON document describing one aspect of the code at one revision. Running an extractor against two commits produces two extractions. |
| **Comparator** | A pure, sandboxed function that relates two extractions from the same projection and produces a comparison: the default comparator, or a custom comparator (a comparator file) layered over it, which a sandboxed interpreter runs wherever comparisons are viewed. |
| **Comparison** | A JSON document describing how one extraction became another: which entities correspond, what happened to each, optional human-readable summaries, and the order in which to present the changes. |
| **Baseline comparison** | The comparison produced by the default comparator. Custom comparators receive it as a starting point. |
| **Renderer** | Presents an extraction, or a comparison, to a person: as an interactive graph, a table, text or anything else. |
| **Runner** | Runs extractors: prepares revisions, enforces limits, validates output and records provenance. |
| **Engine** | The shared Rust core that validates, normalizes, canonicalizes and checks documents in native and Wasm builds. |
| **Inspector** | The tool for developing and debugging extractors, comparators and renderers, hosted by the VS Code extension. |

The program names describe the job; the document names describe the result.
`extractor → extraction` and `comparator → comparison` follow the same pattern.

Schemas are an ordinary technical concept, not a domain concept. The system has
an **extraction schema** and a **comparison schema**, each published as JSON
Schema. An extraction's `schema` field selects the domain schema, such as
`graph/v0` or `api/v0`, whose additional rules apply to its contents.

### Rejected names

<!-- prettier-ignore -->
| Name | Reason |
|---|---|
| Collector | Describes gathering rather than interpreting; not a strong domain term. |
| Snapshot | Implies a test baseline that is either correct or incorrect; neither side of a comparison is correct. Also suggested a separate wrapper concept that users don't need. |
| Report / reporter | Pairs well, but suggests a finished human-facing document or test outcome. |
| Representation | Conceptual and appealing, but suggests the enduring view, which is the projection's role. |
| Generator / generate | Suggests generative AI and code scaffolding; the output is deterministic and evidence-based. |
| State / model / IR | Too generic or too implementation-oriented for a public contract. |
| Visualizer | Assumes visual output. |
| Scheduler | Suggests calendars or job scheduling. |
| Sequencer | Accurate for ordering, but ordering is one responsibility of the comparator rather than a separate component. |
| Differ / diff | "Differ" reads as the verb; "diff" collides with GitHub's code diff in the same pull request. |
| Plan / planner | Collides with Terraform plans, including the Terraform extractor, and implies execution. |
| Migration, changeset | Collide with database migrations and the JavaScript Changesets tool. |
| Reconciler | Collides with React's reconciler, and renderers are React components today. |
| Transition | Strongest alternative for the comparison document, but suggests animation. |

[Extension points](domain-model/extension-points.md) covers what customers can
replace (any of a projection's three components) and the rules every component
follows: first-party components get no privileges, and determinism and
authority.

## Comparisons

### What a comparator decides

Explaining a change has four parts. The first three are shared meaning and
belong to the comparator; the last is presentation and belongs to renderers.

| Concern        | Example                                              | Owner      |
| -------------- | ---------------------------------------------------- | ---------- |
| Correspondence | `billing` was split into `invoicing` and `payments`  | Comparator |
| Interpretation | A signature change is breaking; a column was widened | Comparator |
| Ordering       | Present the most widely used package first           | Comparator |
| Interpolation  | Node movement, edge routing, fades                   | Renderer   |

Every renderer presents the same comparison, so a graph, a table and a text
summary always agree on what changed. A comparison never contains positions,
colors or timing.

The ordering behavior in the prototype's `Sequencer` becomes part of the default
comparator rather than a separate component.

### Relationship to infrastructure planning

Comparisons resemble Terraform plans and ARM what-if results: match resources by
identity, classify changes and order them. The analogy is useful in
documentation, with one important difference. Infrastructure plans are
prescriptive: their order must be correct for execution to succeed. A comparison
is explanatory: it describes a change that has already happened, and its order
exists only for comprehension. A poorly ordered comparison is confusing, never
destructive. This is why comparators can be customer code.

Borrow the concepts: stable addresses, explicit moves (`previousIds`), action
categories and dependency ordering. Don't borrow the vocabulary: "plan" and
"apply" imply execution.

### Comparisons are computed at viewing time

Users choose which two extractions to compare while viewing: the base and the
latest push, only the changes since the push they last reviewed, two commits in
a branch's history, or two saved extractions in the Inspector. The number of
possible pairs grows quadratically, so comparisons can't be precomputed in CI.

**Decision: extractions are produced ahead of time by the runner; comparisons
are computed on demand wherever they are viewed.** Extractors need repository
access and ecosystem toolchains, so they run in CI or locally. A comparator only
needs two JSON documents, so it can run anywhere.

### Comparators are data, interpreted in a sandbox

A comparator is a pure function: two extractions in, one comparison out. A
custom comparator is a **comparator file** (`<name>.comparator.yaml`): YAML
identity passes, classifications, step operations and metadata written in CEL,
layered over the default comparator. Comparator files are data, not programs:
the rules interpreter, `rules.wasm`, a WebAssembly module with no imports, runs
them with no files, network, clock or randomness, under a deterministic cost
budget. The Rust CLI and servers run it in an embedded WebAssembly interpreter
(wasmi); browsers run it in a worker. Neither requires Node.

**Comparator files only.** Declarative comparator files are the only custom
comparators; the JavaScript and WebAssembly comparators were removed once they
landed, because comparators must run in production contexts (client and server)
that show pull requests. A program from a repository can't run there; data an
interpreter checks and bounds can. See
[Custom comparators](../design/declarative-comparators.md#comparator-files-only).

- **The default comparator runs in the same sandbox.** It is the Engine's
  existing comparison compiled to `default-comparator.wasm`, which every host,
  the CLI included, runs in the comparator runtime. A comparator file adjusts
  its result: it pairs what it left unmatched, classifies changes and reorders
  steps.
- **Running a comparator never requires trust.** It can't read files or reach
  the network, so even a comparator defined by an untrusted revision is safe to
  run. Only the question of whose explanation to use remains; see
  [one projection definition, two revisions](#one-projection-definition-two-revisions).
- **Comparisons are verifiable.** Comparators are deterministic, so a viewer can
  rerun the comparator rather than trusting a saved comparison's claims, which
  preserves a property the current artifacts already have.
- **Execution is bounded.** The host limits memory and execution steps in both
  the CLI and the browser, and reports a comparator that exceeds them as a
  failure rather than falling back to another comparison.
- **Authoring.** A custom comparator is one file, with nothing to build or
  install, checked against declared types when it loads, with every problem at
  its line and column. Logic that needs a compiler belongs in the extractor, as
  facts in `data`; a generic operation comparator rules can't express belongs in
  the interpreter's standard library. A custom comparator's digest covers its
  meaning (not its comments or layout) and the interpreter's language.

### Integrity

- The Engine validates every comparison against both extractions: references
  must exist, every change appears in exactly one step, and statuses must be
  consistent with the data.
- A comparison records both extractions and the comparator's digest.
- Extractions compared with each other must come from the same projection
  definition; see below.

### API design work, not blockers

- **Reverse order.** A comparator may supply one order, which the runtime
  reverses when the comparison is played backward. Advanced comparators may
  declare an ordering strategy or supply an explicit reverse order.
- **Splits and merges.** The comparison schema needs many-to-many
  correspondence, beyond today's one-to-one `previousIds`.

## One projection definition, two revisions

A pull request can change a projection's definition, the code of its custom
components, or whether the projection exists at all. If each revision used its
own definition, a comparison would mix changes in the code with changes in the
projection, and the single comparator invocation would have no well-defined
version.

**Decision: a comparison applies one projection definition, with one version of
its component code, to two revisions.** Because users choose pairs
interactively, each extraction records the digest of the definition and
component code that produced it. Projections only compares extractions with
matching digests and explains any mismatch rather than comparing them. The
extractor request already separates the program from the code it examines
(`request.repository.root`), so an extractor from one revision can examine
another.

<!-- prettier-ignore -->
| Definition source | Benefit | Drawback |
|---|---|---|
| **Base (default)** | Already reviewed; a pull request's author can't reshape how their own change is explained | Improvements to a projection aren't visible until merged |
| Head | Shows the projection as changed by the pull request | The author controls the explanation of their own change |
| Each side's own | Simple | Mixes code changes with projection changes |

Using the base matches how GitHub evaluates other review policy, such as
`CODEOWNERS`, branch protection and `pull_request_target`.

Consequences:

- When a pull request changes a projection definition or its component code,
  Projections says so explicitly and offers a head-defined comparison, which
  requires trusting the head.
- Custom components declare their source paths. Projections can't infer which
  files a program imports, and declared paths are needed both to detect changes
  and to record provenance.
- For extractors, trust becomes two questions: is the extractor's code trusted,
  and does running it execute the code being examined? A trusted base extractor
  that only reads `package.json` can safely examine an untrusted fork's pull
  request. An extractor that imports a Django application still executes that
  code. Comparators are sandboxed, so for them only the question of whose
  explanation to use remains.
- A projection added by a pull request has no base definition. Show the head
  extraction alone, or compare using an explicitly trusted head definition.
- Developing an extractor becomes the mirror image of reviewing a pull request:
  keep the revision fixed and compare two versions of the projection definition.

Open: whether the local CLI also defaults to the base definition (recommended,
for one consistent rule) or to the working tree's definition.

## Renderers

Renderers contain substantial, carefully iterated logic: layout, edge routing,
staged motion and responsive behavior. Declarative renderers are not sufficient.

**Decision: custom renderers run as sandboxed frames that communicate with the
host over a narrow message protocol**, similar to Azure DevOps extensions. The
current renderer props are already a narrow interface, so the protocol is
largely those props sent as messages.

<!-- prettier-ignore -->
| Direction | Messages |
|---|---|
| Host to renderer | Extraction, or both extractions and the comparison; progress; change highlighting; selection; theme tokens and color mode; reduced-motion preference; locale; viewport size |
| Renderer to host | Ready; requested height; selection changed; step boundaries; request to open a file or line; acknowledgement of rendered progress; errors |

Stricter than Azure DevOps:

- **No network access by default.** Extractions can describe private code. Use a
  separate origin, `sandbox="allow-scripts"` and a content security policy with
  `connect-src 'none'`.
- **Host-owned alternatives are always available.** A sandboxed renderer can't
  steal data, but it can be wrong or misleading. The built-in table and text
  presentations remain available beside any custom renderer, which also keeps
  every projection accessible. The host labels which renderer is active.
- **Renderer source is policy.** Renderers in the repository just work; a
  renderer that only a pull request's head supplies needs the same explicit
  trust as head extractors. The sandbox stops network access but not a frame
  navigating itself, which could carry data out in a URL. Without trust, the
  host shows the built-in renderer for the schema, or its table and text views,
  with a notice. Installed packages and organization allow-lists remain open.

Consequences:

- Built-in renderers implement the same protocol and nothing else: each is a
  static bundle built with the public renderer SDK (and the public renderer
  kit), served with the same content security policy into the same
  `sandbox="allow-scripts"` frame, receiving the same messages, and held to the
  same checks through the public `@githubnext/projections/testing`. There is no
  in-process adapter. This proves the protocol is sufficient and prevents
  first-party renderers from relying on privileges third-party renderers lack.
  What differs is provenance, not capability: a built-in ships with the host, so
  it needs no trust, can be the fallback for a schema, and is the only kind a
  hosted view shows, since it never runs code from artifacts.
- Rendering becomes asynchronous. Progress messages are small and extractions
  are sent once, so scrubbing stays practical, but tests wait for the renderer's
  acknowledgement of rendered progress.
- Focus and tab order across the frame boundary need deliberate design.

## Runtime requirements

Projections is a single standalone executable. It never requires Node.

**Decision: every built-in extractor requires only the Projections executable
and the toolchain the examined project already uses.** An Entity Framework Core
extractor may require .NET, a Django extractor Python and a Go extractor Go,
because those projects already need them. Node is required only for projects
that are already Node projects, and then only the project's own installation.
Custom extractors follow the same principle naturally, since customers choose
their language.

Helpers that run inside an ecosystem's toolchain ship with the executable as
self-contained files. They are never packages that customers must install
separately, and they don't download dependencies while extracting. They stay
small by using the versions the user already has installed (the SDK's compiler,
the application's own libraries) rather than bundling their own copies, because
those versions are what the project actually builds with.

Extractors are not network or filesystem sandboxed. An extractor, the ecosystem
tools it runs and the repository code those tools execute (build targets, source
generators, application startup) run with the user's privileges. `--trust` is
the control: native extraction runs only when the user explicitly trusts the
repository.

How the built-in extractors meet this:

- Repository map, workspace dependencies, code statistics, an existing SCIP
  index, GitHub Actions jobs, Prisma schemas, Rails schemas and routes,
  pre-exported Cargo/NuGet/Terraform/schema data: The Projections executable
  only. Projections parses Prisma Schema Language itself, a deliberate exception
  because Prisma has no stable public schema API, and reads Rails'
  `db/schema.rb` and routing DSL statically, so history needs no revision's
  gems.
- TypeScript public API: Node and the repository's own `typescript`
  installation, through one self-contained helper script shipped with the
  executable.
- Go interfaces: Go 1.24 or later; the helper uses only the Go standard library,
  so building it needs no network access.
- .NET API, dependency injection and EF Core: The project's .NET SDK 8.0.100+.
  The helper ships prebuilt as about 110 KB of first-party code: it replays the
  project's own compiler invocation with the SDK's Roslyn and reads dependency
  injection and EF Core from the application's build, so nothing is bundled or
  restored for it at extraction time. Application restores follow the
  repository's NuGet configuration and otherwise reuse the user's NuGet global
  packages folder.
- Cargo, Terraform, Django without pre-exported input: Cargo, Terraform or
  Python.
- SCIP file references: The project's own SCIP indexer, such as
  `scip-typescript` or `rust-analyzer`.
- Command output: Whatever the configured commands run.

Renderers are browser code. Built-in renderers are compiled into the
executable's embedded assets; custom renderers are static files. Neither needs
Node at run time.

## CLI

<!-- prettier-ignore -->
| Command | Meaning |
|---|---|
| `projections init [id]` | Scaffold a projection (or add parts to one) and write the agent skill. |
| `projections check [-p id]` | Verify a projection end to end: definition, extraction, comparison with `HEAD`, renderer bundle and renderer checks. |
| `projections show [revision] -p <projection>` | Run the extractor and present the extraction. Without a revision, use the working tree. `--json` prints the extraction; `--png FILE` draws it. |
| `projections compare <base>[..<head>] -p <projection>` | Run the extractor on both revisions, run the comparator and present the comparison. With one revision, compare it with the working tree. |
| `projections serve --stdio` | The Inspector's backend, which the VS Code extension starts: a live preview of the working tree, a saved document (`--document`), or scenario fixtures (`--fixtures`) when developing renderers and comparators. |

Verbs describe the user's goal, not the component: `extract` was rejected as a
CLI verb, and `diff` was removed once the comparison noun was chosen. The
projection is an option (`-p`), so positionals are always revisions, as in Git.
Nouns that group actions are singular (`extractor list`, `bookmark run`), as in
`gh`. Every command works from any directory in a checkout, and `-C DIR` names
another. The full surface is in
[the runner documentation](../runner/commands.md).

## Documents and fields

- Extractions use `entities` and `relationships`, matching the prose, instead of
  `nodes` and `edges`.
- The database domain schema is `database/v0`, avoiding `"schema": "schema/v0"`.
- Saved extractions carry runner-added provenance. Extractors never write
  provenance. A working-tree extraction records its base commit and is marked as
  modified; hosted views that require a verifiable commit reject it.
- A comparison's `changes` lists only entities and relationships that were
  added, removed, modified or renamed. `steps` groups change IDs in presentation
  order.

Renaming wire fields and schema values is a protocol change. It requires an
explicit version and compatibility decision, as [the contracts](../contracts.md)
already require for any wire-format change.

## Hosted model

A repository's own CI produces its projections; the Action reports them in the
run's job summary (and, optionally, a pull request comment) and uploads them as
an artifact, which **Projections: Open Artifact…** in VS Code opens. A hosted
app (a separate service, not part of this repository) is a viewer of those
documents. It has no extractor, runner or collection step of its own.

```
  pull_request / push ──▶ GitHub Action (repository CI) ──▶ `projections` Actions artifact
                                                                   │
  signed-in person ──▶ hosted app ──▶ Actions API (user's token) ──┘ ──▶ verify ──▶ view
```

- **Producer.** The GitHub Action runs the CLI in the repository's own workflow:
  `compare --all <merge base>..<head> --definition base` for a pull request,
  `show --all <commit>` for a push. Trust is the workflow author's decision
  (`trust: true`), exactly as `--trust` locally. The artifact holds one saved
  extraction or comparison per projection and a manifest
  ([CI artifacts](../contracts/saved-documents.md#ci-artifacts)).
- **Transport.** Actions artifacts, read through the Actions API with the
  signed-in person's own token, so it reads only what they can read. Retention
  is the repository's; an expired artifact is an explicit state, not an error or
  an empty result. Nothing is uploaded to, stored by or cached in the hosted
  app.
- **Verification.** Before display: GitHub's run and pull request facts bind the
  artifact (repository, event, head commit, run, merge base), byte digests bind
  the files, and the shared Engine loader verifies every document. Any mismatch
  rejects the artifact as a whole.
- **Presentation.** Every projection, with the built-in renderers in sandboxed
  frames and the host's table and text views. Artifact-named renderers are never
  loaded. Failed projections show their diagnostics.
- **Local documents.** Local, unpublished documents belong in the Inspector (in
  VS Code, **Projections: Open Artifact…**), not the hosted app.

## Repository structure

The repository is organized by domain component first; language only determines
what is inside each directory. Built-in components are laid out exactly as a
custom component would be, so they double as examples. Everything that ships, or
that something shipped depends on, is in `packages/`; the repository's own
tooling (its command line, scripts and Storybook) is in `tools/`.

```
packages/
  schemas/        language-neutral contracts (JSON Schema) and the shared conformance corpus
  engine/         Rust core (native + Wasm); engine/js is its TypeScript transport and browser document validation
  extractors/     one Rust crate per built-in extractor, with its helper, fixtures, tests and docs
    sdk/          the public Rust extractor SDK, the only Projections library extractors use
    catalog/      the registry of built-in extractors
  comparators/    default comparator, the rules interpreter and its sandboxed runtime, first-party rules
  renderers/      one package per built-in renderer, plus renderers/sdk and renderers/testing for authors
  sdk/            @githubnext/projections, the npm package renderer authors install
  host/core/      browser host: renderer frames, playback, selection, built-in table and text views
  host/vscode-ui/ the host's VS Code UI
  host/inspector/ the Inspector UI, a mountable package whose assets the CLI embeds
  cli/            the standalone Rust executable: commands, runner, Inspector backend (serve --stdio)
  integrations/   Projections inside another product, one folder per host product
    vscode/         the VS Code extension, which hosts the Inspector
    github-action/  scripts of the GitHub Action (action.yml, at the root)
    copilot-canvas/ the viewer as a canvas in the GitHub Copilot app
tools/            the repository's command line, scripts and Storybook
examples/  docs/
```

Decisions:

- **One crate per built-in extractor.** This mirrors one package per renderer
  and keeps each extractor's code, helper, fixtures and documentation together.
- **No TypeScript embedding API.** `@githubnext/projections-runner` and the CLI
  package's `runCli` export are deleted. The native CLI is the only
  orchestration implementation; other programs invoke it or consume its
  documents.
- **Self-contained public root.** Nothing in the repository may depend on
  anything outside it. Code outside may depend on Projections, never the
  reverse. A check rejects any path or import that escapes the public root.
- Dependencies point inward (paths relative to `packages/`): `schemas` ←
  `engine` ← `extractors/sdk` ← `extractors` and `comparators` ← `cli`; the CLI
  reaches extractors only through their process entrypoint, and the default
  comparator and comparator files only in the comparator runtime; renderers
  depend only on `renderers/sdk` and `renderers/kit`; `host` depends on the
  renderer protocol, never on a specific renderer.

## Mapping from the current implementation

<!-- prettier-ignore -->
| Current | Target |
|---|---|
| Collector | Extractor |
| Projection state, semantic state, `ProjectionState` | Extraction |
| `SnapshotDocument` | Saved extraction, with provenance |
| Engine `Comparison`, `ComparisonDocument` | Comparison, produced by the default comparator |
| Prototype `Sequencer` | Ordering within the default comparator |
| Engine `compare` operation | The default comparator module |
| Node worker for TypeScript and Prisma extractors | Self-contained helper using the project's own toolchain (TypeScript), or native code (Prisma) |
| Renderer as a trusted, bundled React component | Renderer behind the sandboxed frame protocol |
| `collector` definition field | `extractor` |
| `nodes`, `edges` | `entities`, `relationships` |
| `schema/v1` | `database/v0` |
| `collect` command | `show` |
| `@githubnext/projections-collectors` | An extractor package, named during reorganization |

## Deferred

- **Static sites.** v0 has no static site export: the `projections site`
  command, `projections pr --directory` and the `projections.site` and
  `projections.review-site` catalogs were removed. Reviewers use the Inspector,
  a hosted view or a saved extraction or comparison opened with the VS Code
  extension's **Projections: Open Artifact…**. A static export may return after
  v0 as a published review.

## Remaining bounded questions

- Durable hosted history beyond Actions artifact retention.
- Ordering strategies and explicit reverse order in the comparison schema.
- Many-to-many correspondence for splits and merges.
- Local CLI default for the definition source; handling projections added by a
  pull request.
- How custom components declare source paths and accepted schemas.
- Separate trust settings for component code and for executing examined code.
- Configuration options for the default comparator.
- The renderer message protocol, sandbox policy and allowed renderer sources.
- Final CLI flags, file layout and provenance fields.
- Protocol versioning and migration for renamed fields.

## Next steps

1. Reorganize the codebase around the extractor, comparator and renderer
   boundaries.
2. Specify the comparison schema, including ordering and correspondence, and the
   comparator interface. Expose the Engine's comparison as the default
   comparator module.
3. Specify the renderer frame protocol and move a built-in renderer onto it.
4. Rename public APIs, CLI commands and documentation, with a protocol version
   change for wire fields.
5. Close the runtime gaps so no built-in extractor requires Projections' own npm
   packages.
