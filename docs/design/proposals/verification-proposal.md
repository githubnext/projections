# Proposal: structural verification

Status: **proposal**. Nothing here is implemented. It records the premise, its
limits and a phased plan for letting users assert things about extractions.

An extraction is a deterministic, schema-typed model of a system at one
revision. That makes it something users can check, not just look at:

- "`@acme/ui` never depends on `@acme/db`, directly or transitively."
- "Every scoped service in `payments` is resolved through an interface."
- "This pull request adds no new dependency from the web tier to storage."
- "No Tetragon policy becomes enforcing in a pull request without an owner
  label."

These checks are not test automation, static analysis or formal verification.
This document calls them **structural verification**: checking the shape a
system assembles into, not how it behaves.

## What it is, and isn't

- **Not test automation.** Tests execute _behavior_: they drive paths through
  the code and check outputs. Verification evaluates assertions over a model and
  runs no repository code while doing so.
- **Not static analysis of source.** Rules reason over the extraction, not the
  syntax that produced it. The same rule works whether the model came from a
  parser, a compiler API or a constructed container.
- **Not formal verification.** There are no semantics and no proofs; the result
  is only as strong as the model it inspects (see
  [Soundness](#soundness-completeness-and-scope)).

Extraction itself may execute code. The dependency-injection extractors
construct the real container, `efcore-schema` runs application startup,
`spring-di` builds the application context and `terraform-infrastructure` runs
`terraform plan`. That execution is _assembly_: it bootstraps the system far
enough to observe its structure, then stops. Verification inherits whatever the
extraction observed, including its dependence on execution inputs.

### Prior art

Architecture conformance checking and "architectural fitness functions" are
established ideas: dependency-cruiser, Nx module boundaries,
eslint-plugin-boundaries, ArchUnit, import-linter, deptrac and jQAssistant. The
closest analogue is **policy as code over structured models**, such as
OPA/Conftest evaluating Terraform plans. Each of those is tied to one ecosystem
or one kind of model.

## Why Projections is a good home for it

1. **One model across ecosystems.** A rule written against `graph/v0`
   `depends-on` relationships applies to npm workspaces, Cargo, NuGet and any
   custom extractor that emits the same schema. The schema families are the
   portable vocabulary.
2. **Rules about change, not only state.** Projections already computes identity
   and correspondence between revisions. Rules can therefore target the
   _transition_ a pull request makes ("no _added_ edge from `ui` to `db`"), not
   just the end state. Existing tools mostly check the current state.
3. **Violations drawn on the projection.** A failing rule can mark the offending
   entities and relationships in the renderer, the same way change emphasis
   does, instead of printing a line of text.
4. **Safe, deterministic evaluation.** Rules are evaluated by the Engine (a
   pure, sandboxed core) over documents that may come from CI artifacts.
   Evaluation needs no trust and gives the same verdict for the same inputs.

## Soundness: completeness and scope

The premise is sound only if the result reports what the model can and can't
support.

### Positive and negative claims

- **Positive** assertions ("A depends on B", "table `orders` exists") are as
  reliable as the extractor's _precision_.
- **Negative and universal** assertions ("no path from A to B", "every service
  has an owner") additionally require the extraction to be _complete_ for the
  relationship kinds involved. They make a closed-world assumption. Dynamic
  imports, reflection, code generation and configuration-time wiring can all
  hide edges from a parser.

A pass must mean "absent from a model that is complete for this relationship
kind", not "not observed". Otherwise the feature gives false assurance, which is
worse than none.

**Requirement:** extractors declare completeness per entity and relationship
kind (for example `complete`, `partial` with stated limitations, or `unknown`),
alongside the existing per-item `confidence` (`authoritative`, `derived`,
`inferred`) and provenance `limitations`. A negative or universal assertion over
anything not declared complete yields **inconclusive**, never pass.

Execution-based extraction usually helps here. A constructed container is the
ground truth of what is registered, including reflective, conditional and
convention-based registrations a parser would miss, so a DI extractor can often
declare its registrations complete where a source scanner can't.

### Scope: inputs

Execution makes the model depend on its inputs: profiles, environment variables,
configuration files, feature flags and selected targets. A verdict is therefore
true **for a given set of extraction inputs**. "Holds under the `production`
profile" and "holds under `development`" are different claims. Determinism is
preserved (the same pinned inputs give the same verdict), but every verdict
reports the inputs and provenance it was evaluated against.

### Outcomes

Every assertion produces one of:

| Outcome        | Meaning                                                                                                          |
| -------------- | ---------------------------------------------------------------------------------------------------------------- |
| `pass`         | The model supports the claim, and it is complete enough for a negative or universal claim.                       |
| `fail`         | The model contains a counterexample, which is reported with the IDs of the offending entities and relationships. |
| `inconclusive` | The claim needs completeness or data the extraction doesn't declare. The result says what's missing.             |
| `error`        | The rule is invalid for this schema, for example an unknown kind or a type mismatch.                             |

A failure's counterexample is always concrete, because it was observed. A pass
on a negative claim is only as strong as the declared completeness.

## Shape of the feature

### Where rules live

Rules are declarative and live with the projection definition, either as a
`verify` section in `.github/projections/<id>.json` or as a sibling
`<id>.rules.json`. They are versioned with the code and read from the base
revision under the same definition policy as everything else, so a pull request
can't weaken the rules that judge it without that change being visible.

### Rule vocabulary (first version)

A small built-in vocabulary that covers the common shapes, with no general query
language at first:

- **Forbidden / required relationship** between selectors (kind, ID pattern,
  `data` predicates), optionally **transitive** (reachability over chosen
  relationship kinds).
- **Cardinality**, e.g. at most one entity of a kind matching a predicate.
- **Attribute constraints** on entities or relationships
  (`data.lifetime != "transient"` for kind `registration` in scope X).
- **Change rules** over a comparison: constraints on _added_, _removed_ or
  _modified_ items (no added `depends-on` from `ui/*` to `db/*`; no removed
  public API without the `breaking-ok` label).

Selectors match IDs and kinds exactly or by glob, never by fuzzy labels, as in
the rest of the protocol.

### Evaluation

The Engine evaluates rules Datalog-style. Transitive reachability, joins between
entities and relationships, and change rules over a comparison's classified
items are natural there. CodeQL uses the same approach for code. Evaluation is
bounded (time, memory, result size), deterministic and pure.

Later, if the vocabulary proves too small, an escape hatch is one of:

- **CEL** (Common Expression Language): small, sandboxed, and already familiar
  to Kubernetes and Tetragon users. Good for predicates.
- **Rego** (OPA): known to platform and security teams, good for policy over
  structured documents.
- **GQL / Cypher**: graph-native, ISO-standardized (GQL), the most expressive
  for path queries.
- A **Wasm verifier module** under the same sandbox contract as comparators, for
  teams that want arbitrary logic.

The recommendation is to ship the built-in vocabulary first and choose an escape
hatch from real demand.

### Surfaces

- **CLI:** `projections check` (and a focused `projections verify`) evaluates
  the rules for a revision or a comparison. It exits nonzero on `fail`, and
  optionally on `inconclusive` with a strict flag, with human output by default
  and `--json` for tools.
- **Action and CI:** rules run against the same extractions the artifact
  carries, and the results go into the artifact as a `verification` document
  next to the comparison. A pull-request check summarizes the outcomes.
- **Inspector and hosted view:** a verification panel lists the rules. A failing
  rule highlights its counterexample in the renderer through the existing
  annotation and emphasis channels, and an inconclusive rule explains what's
  missing.
- **Agents:** the authoring skill teaches agents to add rules alongside a custom
  projection, and `check` reports rule outcomes with structured errors.

## Plan

1. **Completeness metadata.** Add per-kind completeness to the extraction
   contract and schemas, and have the built-in extractors declare it honestly
   (DI containers: registrations complete; dependency graphs from lockfiles:
   complete for resolved packages; convention-based samples: partial). This is
   useful on its own: renderers and the Inspector can show coverage.
2. **Rule format and evaluator.** Define the rule schema (selectors,
   relationship and path constraints, cardinality, attributes, change rules) and
   implement evaluation in the Engine, with the four outcomes and concrete
   counterexamples. Add conformance vectors in the style of the existing Engine
   test vectors.
3. **CLI and CI.** `check`/`verify`, the `verification` document in artifacts,
   and the Action reporting results.
4. **Presentation.** A verification panel and counterexample highlighting in the
   Inspector and hosted view.
5. **Escape hatch.** Choose CEL, Rego, GQL or Wasm verifiers from real rules
   users couldn't express.

## Open questions

- **Naming.** "Structural verification", "invariants and rules", "fitness
  functions", or something else?
- **Strictness.** Is `inconclusive` a failure in CI by default? Probably not
  locally and configurable in CI, so incomplete extractors don't make every
  pipeline red.
- **Rule location and trust.** Rules come from the base revision, like
  definitions. Should a pull request be able to _add_ rules that apply to
  itself, and do head-only rules run when trusted?
- **Cross-projection rules.** Some useful claims span projections ("every
  service in the architecture projection has a database in the schema
  projection"). Is that in scope, and how is identity joined across schemas?
- **Inputs as part of the claim.** Should a rule be able to require specific
  extraction inputs (profiles, targets), so "verified under `production`" is
  enforced rather than incidental?
