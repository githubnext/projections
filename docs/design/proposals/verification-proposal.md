# Proposal: structural verification

Status: **proposal**. Nothing here is implemented yet. This document lays out
the premise, boundaries, and phased plan for letting teams write assertions over
extractions.

Because an extraction is a deterministic, schema-typed model of a system at a
single revision, you can do more than look at it — you can check rules against
it:

- "`@acme/ui` never depends on `@acme/db`, directly or transitively."
- "Every scoped service in `payments` is resolved through an interface."
- "This pull request adds no new dependency from the web tier to storage."
- "No Tetragon policy becomes enforcing in a pull request without an owner
  label."

These aren't unit tests, source linters, or formal proofs. Here we call them
**structural verification**: checking the shape a system assembles into rather
than how it behaves at runtime.

## What it is, and isn't

- **Not test automation.** Tests exercise _behavior_ by running code paths and
  checking outputs. Verification evaluates assertions over an extracted model
  without executing any repository code.
- **Not static analysis of source.** Rules inspect the extracted model rather
  than raw syntax, so the same rule works whether the model came from a parser,
  a compiler API, or an assembled container.
- **Not formal verification.** There are no formal semantics or mathematical
  proofs; a verdict is only as strong as the underlying model (see
  [Soundness](#soundness-completeness-and-scope)).

Extraction itself can still run code — DI extractors build the real container,
`efcore-schema` runs application startup, `spring-di` builds the application
context, and `terraform-infrastructure` runs `terraform plan`. That execution is
just _assembly_: bootstrapping the system far enough to inspect its structure,
then stopping. Verification inherits whatever that assembly observed, including
its dependence on execution inputs.

### Prior art

Architecture conformance checks and "architectural fitness functions" are well
established: dependency-cruiser, Nx module boundaries, eslint-plugin-boundaries,
ArchUnit, import-linter, deptrac, and jQAssistant. The closest relative is
**policy as code over structured models**, such as OPA/Conftest checking
Terraform plans. Each of those tools, however, is tied to one ecosystem or one
model format.

## Why Projections is a good home for it

1. **One model across ecosystems.** A rule written over `graph/v0` `depends-on`
   relationships works across npm workspaces, Cargo, NuGet, and any custom
   extractor emitting that schema. The schema families give you a portable
   vocabulary.
2. **Rules about change, not just state.** Projections already computes identity
   and correspondence between revisions, so rules can target the _transition_ a
   pull request introduces ("no _added_ edge from `ui` to `db`") rather than
   only the final state. Most existing tools only inspect the current state.
3. **Violations drawn right on the projection.** Instead of printing a wall of
   text, a failing rule can highlight the offending entities and relationships
   inside the renderer using the same visual channels as change emphasis.
4. **Safe, deterministic evaluation.** The Engine — a pure, sandboxed core —
   evaluates rules over documents that may come from CI artifacts. Evaluation
   requires no trust and produces the same verdict for the same inputs.

## Soundness: completeness and scope

Structural verification is only trustworthy if it is honest about what the model
can and cannot prove.

### Positive and negative claims

- **Positive** assertions ("A depends on B", "table `orders` exists") are as
  reliable as the extractor's _precision_.
- **Negative and universal** assertions ("no path from A to B", "every service
  has an owner") also require the extraction to be _complete_ for the relevant
  relationship kinds, because they make a closed-world assumption. Dynamic
  imports, reflection, code generation, and runtime wiring can easily hide edges
  from a static parser.

A pass has to mean "absent from a model known to be complete for this
relationship kind", not merely "we didn't spot it." Otherwise the check offers
false confidence, which is worse than no check at all.

**Requirement:** extractors must declare completeness per entity and
relationship kind (such as `complete`, `partial` with stated limitations, or
`unknown`), alongside existing per-item `confidence` (`authoritative`,
`derived`, `inferred`) and provenance `limitations`. Any negative or universal
assertion over data not declared complete returns **inconclusive**, never pass.

Execution-based extraction helps here. A constructed container is the ground
truth of what is registered — including reflective, conditional, and
convention-based registrations that a static scanner would miss — so a DI
extractor can often declare its registrations complete where a parser cannot.

### Scope: inputs

When extraction runs code, the model depends on its inputs: profiles,
environment variables, config files, feature flags, and selected targets. A
verdict therefore holds **for a specific set of extraction inputs**. "Holds
under the `production` profile" and "holds under `development`" are separate
claims. Determinism still holds (the same pinned inputs yield the same verdict),
and every verdict records the inputs and provenance it evaluated against.

### Outcomes

Every assertion resolves to one of four outcomes:

| Outcome        | Meaning                                                                                                          |
| -------------- | ---------------------------------------------------------------------------------------------------------------- |
| `pass`         | The model supports the claim, and it is complete enough for a negative or universal claim.                       |
| `fail`         | The model contains a counterexample, which is reported with the IDs of the offending entities and relationships. |
| `inconclusive` | The claim needs completeness or data the extraction doesn't declare. The result says what's missing.             |
| `error`        | The rule is invalid for this schema, for example an unknown kind or a type mismatch.                             |

A failure always comes with a concrete counterexample because it was actually
observed. A pass on a negative claim is only as strong as the extractor's
declared completeness.

## Shape of the feature

### Where rules live

Rules are declarative and live beside the projection definition, either inside a
`verify` section of `.github/projections/<id>.json` or in a sibling
`<id>.rules.json`. They are versioned with the repository and read from the base
revision under the same definition policy as everything else, so a pull request
cannot quietly weaken the rules judging it.

### Rule vocabulary (first version)

Version one starts with a small built-in vocabulary covering the most common
checks, without introducing a general query language yet:

- **Forbidden or required relationships** between selectors (kind, ID pattern,
  and `data` predicates), optionally **transitive** (reachability across chosen
  relationship kinds).
- **Cardinality**, such as at most one entity of a given kind matching a
  predicate.
- **Attribute constraints** on entities or relationships (for example,
  `data.lifetime != "transient"` for kind `registration` in scope X).
- **Change rules** over a comparison: constraints on _added_, _removed_, or
  _modified_ items (no added `depends-on` from `ui/*` to `db/*`; no removed
  public API without the `breaking-ok` label).

Selectors match IDs and kinds by exact string or glob — never fuzzy labels —
consistent with the rest of the protocol.

### Evaluation

The Engine evaluates rules in a Datalog-style model, which fits transitive
reachability, joins between entities and relationships, and change rules over
classified comparison items (similar to CodeQL). Evaluation is bounded in time,
memory, and result size, and stays pure and deterministic.

If the built-in vocabulary later turns out to be too narrow, we can pick an
escape hatch from:

- **CEL** (Common Expression Language): compact, sandboxed, familiar to
  Kubernetes and Tetragon users, and well suited to predicates.
- **Rego** (OPA): familiar to platform and security teams for policy over
  structured documents.
- **GQL / Cypher**: graph-native and ISO-standardized (GQL), giving the richest
  path queries.
- A **Wasm verifier module** running under the same sandbox contract as
  comparators, for teams that need arbitrary logic.

We recommend shipping the built-in vocabulary first and letting real usage tell
us which escape hatch is needed.

### Surfaces

- **CLI:** `projections check` (and a focused `projections verify`) runs the
  rules for a revision or comparison, exiting nonzero on `fail` (and optionally
  on `inconclusive` under a strict flag), with human-readable output by default
  and `--json` for tooling.
- **Action and CI:** rules run against the same extractions already in the
  artifact, writing a `verification` document beside the comparison and
  summarizing results in a pull-request check.
- **Inspector and hosted view:** a verification panel lists each rule; clicking
  a failing rule highlights its counterexample in the renderer via the existing
  annotation and emphasis channels, while an inconclusive rule explains what
  completeness or data is missing.
- **Agents:** the authoring skill teaches agents to write rules alongside custom
  projections, and `check` returns structured errors for rule outcomes.

## Plan

1. **Completeness metadata.** Add per-kind completeness to the extraction
   contract and schemas, and update built-in extractors to declare it honestly
   (DI containers: complete for registrations; lockfile dependency graphs:
   complete for resolved packages; convention-based samples: partial). This pays
   off immediately because renderers and the Inspector can display coverage.
2. **Rule format and evaluator.** Define the rule schema (selectors,
   relationship and path constraints, cardinality, attributes, change rules),
   build evaluation into the Engine with the four outcomes and concrete
   counterexamples, and add conformance vectors matching the existing Engine
   test vectors.
3. **CLI and CI.** Wire up `check`/`verify`, add the `verification` document to
   artifacts, and report outcomes from the Action.
4. **Presentation.** Add the verification panel and counterexample highlighting
   to the Inspector and hosted view.
5. **Escape hatch.** Choose CEL, Rego, GQL, or Wasm verifiers based on real
   rules users couldn't express with the built-in vocabulary.

## Open questions

- **Naming.** Should we call this "structural verification", "invariants and
  rules", "fitness functions", or something else?
- **Strictness.** Should `inconclusive` fail CI by default? Probably not locally
  and configurable in CI, so partial extractors don't turn every pipeline red.
- **Rule location and trust.** Rules come from the base revision like
  definitions. Should a pull request be allowed to _add_ rules that apply to
  itself, and should head-only rules run when trusted?
- **Cross-projection rules.** Some valuable checks span projections ("every
  service in the architecture projection has a database in the schema
  projection"). Is that in scope, and how would identity join across schemas?
- **Inputs as part of the claim.** Should a rule be able to require specific
  extraction inputs (profiles, targets) so "verified under `production`" is
  enforced rather than incidental?
