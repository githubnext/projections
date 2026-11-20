# Domain model and vocabulary plan

Status: **adopted**. These decisions are implemented across protocol version 0,
the native CLI, the built-in and WebAssembly comparators, the sandboxed renderer
host, and the built-in renderers. For a user-facing overview, start with the
[guide](../guides/how-it-works.md). See
[mapping from the previous implementation](#mapping-from-the-current-implementation)
for how earlier terms were renamed, and
[remaining bounded questions](#remaining-bounded-questions) for open items.

## Goals

Projections needs a vocabulary precise enough for people building custom
extractors or renderers, yet plain enough for someone just picking a view on a
pull request. Every term should have a single clear meaning, steer clear of
names already overloaded in everyday dev tools, and describe a responsibility
rather than a visual format — nothing in the model should assume sight or
motion.

## Core decisions

### Showing one revision is a complete use

Inspecting a single revision — like the current state of your default branch —
is a complete, useful workflow on its own. Comparing two revisions builds on top
of it rather than being a prerequisite, so our docs, CLI, and renderer contracts
all lead with the single-revision case.

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

Program names describe the job, and document names describe the output —
`extractor → extraction` and `comparator → comparison` follow the same pairing.

Schemas stay ordinary technical infrastructure rather than domain jargon. The
system publishes an **extraction schema** and a **comparison schema** as JSON
Schema. An extraction's `schema` field picks a domain schema (like `graph/v0` or
`api/v0`) whose extra rules validate its contents.

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

See [Extension points](domain-model/extension-points.md) for which components
teams can replace and the rules every component obeys (no special privileges for
first-party components, plus determinism and authority).

## Comparisons

### What a comparator decides

Explaining a change involves four concerns. The first three carry shared meaning
and belong to the comparator; the fourth is presentation and belongs to
renderers.

| Concern        | Example                                              | Owner      |
| -------------- | ---------------------------------------------------- | ---------- |
| Correspondence | `billing` was split into `invoicing` and `payments`  | Comparator |
| Interpretation | A signature change is breaking; a column was widened | Comparator |
| Ordering       | Present the most widely used package first           | Comparator |
| Interpolation  | Node movement, edge routing, fades                   | Renderer   |

Because every renderer consumes the same comparison, a graph, table, and text
summary always agree on what changed. Comparisons never store coordinates,
colors, or animation timing.

The ordering logic from the earlier `Sequencer` prototype folds into the default
comparator instead of living as a separate component.

### Relationship to infrastructure planning

Comparisons look a lot like Terraform plans or ARM what-if results: match
resources by identity, classify each change, and put them in order. The analogy
helps when explaining the model, with one big difference. Infrastructure plans
are prescriptive — get the order wrong and the deployment breaks. A comparison
is purely explanatory — it describes a change that already happened, and its
order only serves human understanding. A bad order is confusing, never
destructive, which is why comparators can safely be user-supplied.

We borrow the useful ideas (stable addresses, explicit moves via `previousIds`,
action categories, dependency ordering) without borrowing words like "plan" or
"apply" that imply execution.

### Comparisons are computed at viewing time

Reviewers choose which pair of revisions to compare on the fly: base vs. head,
changes since their last review, any two commits on a branch, or two saved
extractions in the Inspector. Since the number of pairs grows quadratically, CI
can't precompute them all.

**Extractions are produced ahead of time by the runner; comparisons are computed
on demand wherever they are viewed.** Extractors need the repo and its
toolchains, so they run in CI or locally. Comparators only need two JSON
documents, so they can run anywhere.

### Comparators are data, interpreted in a sandbox

A comparator is a pure function: two extractions in, one comparison out. A
custom comparator is a **comparator file** (`<name>.comparator.yaml`) — YAML
identity passes, classifications, step operations, and metadata written in CEL,
layered over the default comparator. Comparator files are data rather than
arbitrary code: the rules interpreter (`rules.wasm`, a zero-import WebAssembly
module) runs them with no filesystem, network, clock, or randomness under a
fixed cost budget. The Rust CLI and servers execute it in an embedded Wasm
interpreter (wasmi), while browsers run it in a worker — neither needs Node.

**Comparator files only.** Declarative comparator files are the only supported
custom comparator format. Once they landed, we removed JavaScript and Wasm
custom comparators because comparators must run safely in production client and
server contexts displaying pull requests — untrusted repo code can't run there,
whereas bounded, validated data can (see
[Custom comparators](../design/declarative-comparators.md#comparator-files-only)).

- **The default comparator uses the same sandbox.** It is the Engine's
  comparison compiled to `default-comparator.wasm`, run inside the comparator
  runtime by every host including the CLI. Custom comparator files refine its
  output by pairing unmatched items, classifying changes, and reordering steps.
- **No trust required.** Because a comparator can't touch files or the network,
  even one from an untrusted revision is safe to run. The only policy question
  is whose explanation to display (see
  [one projection definition, two revisions](#one-projection-definition-two-revisions)).
- **Verifiable by rerunning.** Since comparators are deterministic, any viewer
  can recompute a comparison to verify a saved artifact rather than taking its
  claims on faith.
- **Bounded execution.** Hosts enforce memory and step limits in both the CLI
  and browsers, surfacing a limit breach as an explicit failure rather than
  silently falling back.
- **Lightweight authoring.** A custom comparator is a single file with no build
  or install step, type-checked on load with line-and-column diagnostics. Logic
  that needs a compiler belongs in the extractor (as facts in `data`); reusable
  generic operations belong in the interpreter's standard library. A
  comparator's digest hashes its semantics (ignoring comments and formatting)
  plus the interpreter language version.

### Integrity

- The Engine validates every comparison against both extractions: every
  referenced entity must exist, every change must appear in exactly one step,
  and statuses must match the underlying data.
- Each comparison records both extraction digests and the comparator's digest.
- Two extractions can only be compared if they came from the same projection
  definition (see below).

### API design work, not blockers

- **Reverse order.** By default, playing a comparison backward reverses the
  comparator's step order. Later, advanced comparators may declare an ordering
  strategy or an explicit reverse order.
- **Splits and merges.** The comparison schema will eventually support
  many-to-many correspondence beyond today's one-to-one `previousIds`.

## One projection definition, two revisions

A pull request can edit a projection's definition, its custom component code, or
add a brand-new projection. If each side used its own definition, the diff would
blur code changes with projection changes, and there wouldn't be one clear
comparator version to run.

**A comparison always applies one projection definition — and one version of its
component code — to both revisions.** Because users pick pairs interactively,
each extraction records the digest of the definition and component code that
produced it. Projections only compares extractions whose digests match, and
explains any mismatch instead of forcing a misleading diff. The extractor
request already separates the extractor program from the repo root it inspects
(`request.repository.root`), so one revision's extractor can inspect another.

<!-- prettier-ignore -->
| Definition source | Benefit | Drawback |
|---|---|---|
| **Base (default)** | Already reviewed; a pull request's author can't reshape how their own change is explained | Improvements to a projection aren't visible until merged |
| Head | Shows the projection as changed by the pull request | The author controls the explanation of their own change |
| Each side's own | Simple | Mixes code changes with projection changes |

Defaulting to the base matches how GitHub evaluates `CODEOWNERS`, branch
protection, and `pull_request_target`.

A few things follow from this:

- When a PR modifies a projection definition or component code, Projections
  calls it out explicitly and offers a head-defined comparison (which requires
  trusting the head).
- Custom components must declare their source paths, since Projections can't
  reliably infer imports, and those paths are needed for both change detection
  and provenance.
- Extractor trust splits into two separate questions: is the extractor code
  trusted, and does running it execute the target repo's code? A trusted base
  extractor that only parses `package.json` can safely inspect an untrusted fork
  PR, whereas one that imports a Django app still executes untrusted code.
  Comparators are sandboxed, so only the choice of whose explanation to show
  remains.
- A projection introduced in a PR has no base definition; show the head
  extraction alone, or compare with an explicitly trusted head definition.
- Developing an extractor is the mirror image of reviewing a PR: hold the code
  revision constant and compare two versions of the projection definition.

Still open: whether the local CLI should default to the base definition
(recommended for consistency) or to the working tree's definition.

## Renderers

Good renderers need real code for layout, edge routing, staged motion, and
responsive sizing — declarative specs aren't enough.

**Custom renderers run inside sandboxed frames that talk to the host over a
narrow message protocol**, much like Azure DevOps extensions. Because existing
renderer props are already narrow, the protocol essentially serializes those
props as messages.

<!-- prettier-ignore -->
| Direction | Messages |
|---|---|
| Host to renderer | Extraction, or both extractions and the comparison; progress; change highlighting; selection; theme tokens and color mode; reduced-motion preference; locale; viewport size |
| Renderer to host | Ready; requested height; selection changed; step boundaries; request to open a file or line; acknowledgement of rendered progress; errors |

We enforce stricter rules than Azure DevOps:

- **No network access by default.** Extractions can describe private code, so
  renderers run on a separate origin with `sandbox="allow-scripts"` and
  `connect-src 'none'`.
- **Host-owned fallbacks are always available.** A sandboxed renderer can't
  exfiltrate data, but it could still be buggy or misleading. Built-in table and
  text views remain available alongside every custom renderer (keeping every
  projection accessible), and the host always labels which renderer is active.
- **Renderer provenance is policy.** Renderers already in the repo just work; a
  renderer introduced only on a PR's head requires explicit trust, just like
  head extractors — a sandbox blocks fetch calls, but not top-level navigation
  that could leak data in a URL. Without trust, the host falls back to the
  built-in renderer or table/text views with a notice. Installed packages and
  org allow-lists remain open.

This design has three practical consequences:

- Built-in renderers use the exact same protocol and nothing else. Each ships as
  a static bundle built with the public renderer SDK and kit, loads into the
  same `sandbox="allow-scripts"` frame under the same CSP, receives the same
  messages, and is tested via `@githubnext/projections/testing` — no in-process
  shortcuts. The only difference is provenance: a built-in ships with the host,
  so it needs no trust, can serve as a schema fallback, and is the only kind
  hosted views run (since hosted views never execute code from artifacts).
- Rendering is asynchronous. Progress updates are tiny and extractions are sent
  once so scrubbing stays smooth, while tests wait for the renderer to
  acknowledge rendered progress.
- Focus management and tab order across the frame boundary require deliberate
  handling.

## Runtime requirements

Projections ships as a single standalone executable and never requires Node.

**Every built-in extractor needs only the Projections binary and the toolchain
the inspected project already uses.** An EF Core extractor can expect .NET,
Django can expect Python, and Go can expect Go, because those projects already
have them. Node is only needed for Node projects, using the project's own
installation. Custom extractors follow the same pattern since authors pick their
own language.

Ecosystem helpers ship embedded in the executable as self-contained files — no
separate packages to install and no downloads during extraction. They stay small
by using the user's already-installed compiler and libraries rather than
bundling their own copies, ensuring results match what the project actually
builds with.

Extractors are not filesystem- or network-sandboxed. An extractor, the tools it
invokes, and any repo code those tools run (build targets, source generators,
app startup) execute with the user's privileges. `--trust` is the gate: native
extraction only runs when the user explicitly trusts the repository.

Here is what each built-in extractor needs:

- **Projections binary only:** repository map, workspace dependencies, code
  statistics, existing SCIP indexes, GitHub Actions jobs, Prisma schemas, Rails
  schemas and routes, and pre-exported Cargo/NuGet/Terraform/schema data. We
  parse Prisma Schema Language natively (since Prisma has no stable public
  schema API) and read Rails `db/schema.rb` and routing DSL statically so
  historical commits don't need old gems installed.
- **TypeScript public API:** Node and the repository's own `typescript`
  installation, driven by a single self-contained helper embedded in the binary.
- **Go interfaces:** Go 1.24 or later, using a helper built purely on the Go
  standard library so no network access is needed.
- **.NET API, DI, and EF Core:** the project's .NET SDK 8.0.100+. The prebuilt
  helper is roughly 110 KB of first-party code that replays the project's
  compiler invocation with the SDK's Roslyn and reads DI/EF Core from the app
  build, requiring no extra bundles or restores at extraction time (app restores
  follow the repo's NuGet config and reuse the user's global NuGet cache).
- **Cargo, Terraform, Django (live):** Cargo, Terraform, or Python.
- **SCIP file references:** the project's own SCIP indexer (such as
  `scip-typescript` or `rust-analyzer`).
- **Command output:** whatever commands the definition configures.

Renderers are browser code — built-ins are embedded in the binary and custom
renderers are static bundles — so neither needs Node at runtime.

## CLI

<!-- prettier-ignore -->
| Command | Meaning |
|---|---|
| `projections init [id]` | Scaffold a projection (or add parts to one) and write the agent skill. |
| `projections check [-p id]` | Verify a projection end to end: definition, extraction, comparison with `HEAD`, renderer bundle and renderer checks. |
| `projections show [revision] -p <projection>` | Run the extractor and present the extraction. Without a revision, use the working tree. `--json` prints the extraction; `--png FILE` draws it. |
| `projections compare <base>[..<head>] -p <projection>` | Run the extractor on both revisions, run the comparator and present the comparison. With one revision, compare it with the working tree. |
| `projections serve --stdio` | The Inspector's backend, which the VS Code extension starts: a live preview of the working tree, a saved document (`--document`), or scenario fixtures (`--fixtures`) when developing renderers and comparators. |

CLI verbs match user intent rather than internal components — we rejected
`extract` as a verb and dropped `diff` once we settled on "comparison." Passing
the projection as an option (`-p`) keeps positional arguments purely for
revisions, just like Git. Grouping nouns are singular (`extractor list`,
`bookmark run`), matching `gh`. Commands work from any subdirectory in a
checkout, and `-C DIR` targets another directory. See
[the runner documentation](../runner/commands.md) for the full CLI surface.

## Documents and fields

- Extractions use `entities` and `relationships` rather than `nodes` and
  `edges`, matching the prose.
- The database schema is named `database/v0` to avoid awkward strings like
  `"schema": "schema/v0"`.
- Runner-added provenance lives on saved extractions; extractors never emit
  provenance themselves. Working-tree extractions record their base commit and
  are flagged as modified so hosted views requiring a verifiable commit reject
  them.
- A comparison's `changes` lists only entities and relationships that were
  added, removed, modified, or renamed, while `steps` groups change IDs in
  presentation order.

Any rename to wire fields or schema values is a protocol change requiring an
explicit version and compatibility decision, per
[the contracts](../contracts.md).

## Hosted model

Each repository's CI produces its own projections. The GitHub Action summarizes
them in the job summary (and optionally a PR comment) and uploads them as an
artifact, which you can open locally via **Projections: Open Artifact…** in VS
Code. A hosted app (a separate service outside this repo) simply views those
artifacts — it has no extractor, runner, or collection pipeline of its own.

```
  pull_request / push ──▶ GitHub Action (repository CI) ──▶ `projections` Actions artifact
                                                                   │
  signed-in person ──▶ hosted app ──▶ Actions API (user's token) ──┘ ──▶ verify ──▶ view
```

- **Producer.** The GitHub Action invokes the CLI inside the repo's workflow:
  `compare --all <merge base>..<head> --definition base` for pull requests and
  `show --all <commit>` for pushes. Workflow authors opt into trust via
  `trust: true`, mirroring `--trust` locally. The uploaded artifact contains one
  saved extraction or comparison per projection plus a manifest (see
  [CI artifacts](../contracts/saved-documents.md#ci-artifacts)).
- **Transport.** The hosted app fetches Actions artifacts through the Actions
  API using the viewer's own token, so people only see what they already have
  access to. Retention follows the repository's settings (an expired artifact
  renders as an explicit state, not an error or empty diff), and nothing is
  stored or cached by the hosted app.
- **Verification.** Before rendering anything, GitHub's run and PR metadata bind
  the artifact (repo, event, head commit, run, merge base), byte digests bind
  the files, and the shared Engine loader validates every document. Any mismatch
  rejects the whole artifact.
- **Presentation.** Every projection renders with built-in renderers in
  sandboxed frames alongside host table and text views. Artifact-supplied
  renderers are never executed, and failed projections display their
  diagnostics.
- **Local documents.** Unpublished local documents belong in the Inspector
  (**Projections: Open Artifact…** in VS Code), not the hosted app.

## Repository structure

The repo is grouped by domain component first, with language details inside each
folder. Built-in components follow the exact same layout as custom ones so they
double as examples. Everything that ships (or that a shipped package depends on)
lives under `packages/`; repo tooling (CLI, scripts, Storybook) lives under
`tools/`.

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

Key architectural rules:

- **One crate per built-in extractor,** mirroring one package per renderer and
  keeping each extractor's code, helper, fixtures, and docs together.
- **No TypeScript embedding API.** `@githubnext/projections-runner` and the CLI
  package's `runCli` export are gone; the native CLI is the sole orchestrator,
  and other tools either shell out to it or read its documents.
- **Self-contained public root.** Nothing in this repo may depend on anything
  outside it (external code may depend on Projections, never the reverse), and a
  boundary check rejects any escaping path or import.
- **Inward dependencies** (paths relative to `packages/`): `schemas` ← `engine`
  ← `extractors/sdk` ← `extractors` and `comparators` ← `cli`. The CLI talks to
  extractors only via their process entrypoint and runs comparators only inside
  the comparator runtime. Renderers depend solely on `renderers/sdk` and
  `renderers/kit`, and `host` depends on the renderer protocol rather than any
  specific renderer.

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

- **Static sites.** v0 intentionally drops static site export
  (`projections site`, `projections pr --directory`, and the `projections.site`
  and `projections.review-site` catalogs were removed). Reviewers use the
  Inspector, a hosted view, or saved documents opened with **Projections: Open
  Artifact…** in VS Code. Static export may return after v0 as a published
  review format.

## Remaining bounded questions

- Durable hosted history beyond Actions artifact retention.
- Ordering strategies and explicit reverse order in the comparison schema.
- Many-to-many correspondence for splits and merges.
- Local CLI default for the definition source and handling projections added by
  a PR.
- How custom components declare source paths and accepted schemas.
- Separate trust settings for component code vs. executing examined repo code.
- Configuration options for the default comparator.
- The renderer message protocol, sandbox policy, and allowed renderer sources.
- Final CLI flags, file layout, and provenance fields.
- Protocol versioning and migration for renamed fields.

## Next steps

1. Reorganize the codebase around the extractor, comparator, and renderer
   boundaries.
2. Specify the comparison schema (including ordering and correspondence) and the
   comparator interface, and expose the Engine's comparison as the default
   comparator module.
3. Specify the renderer frame protocol and migrate a built-in renderer onto it.
4. Rename public APIs, CLI commands, and docs alongside a protocol version bump
   for wire fields.
5. Close remaining runtime gaps so no built-in extractor requires Projections'
   own npm packages.
