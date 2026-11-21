# Projections contracts v0

Package versions track releases (see [releasing](maintainers/releasing.md)),
while the document formats described here carry their own versions. Every format
is currently at version 0: pre-stable, and subject to breaking changes without a
compatibility reader. Version 1 will be the first stable release of the
protocol, domain schemas, saved documents, and renderer frames.

```
  revision ──▶ extractor ──▶ extraction ──▶ renderer

  base revision ──▶ extractor ──▶ extraction ─┐
                                              ├─▶ comparator ──▶ comparison ──▶ renderer
  head revision ──▶ extractor ──▶ extraction ─┘
```

A **projection** brings together an **extractor**, an optional **comparator**,
and a **renderer**. An extractor inspects one revision and emits an
**extraction**. A comparator relates two extractions of the same projection and
emits a **comparison**. Because the boundary is plain JSON over stdin and
stdout, you can write extractors in any language without needing a TypeScript or
Rust SDK.

Machine-readable draft-2020-12 schemas ship in
`packages/schemas/schemas/<name>/v<major>.json` and are published at their
`$id`, `https://schemas.projections.githubnext.com/<name>/v<major>.json` (see
[Versioning and publishing](#versioning-and-publishing)). They are generated
from the TypeBox definitions in `packages/schemas/src/typebox`, which also
supply the TypeScript types exported by `packages/schemas/src/index.ts`.
Whenever you change those definitions, run
`npm run generate --workspace @githubnext/projections-schemas` so the committed
files stay in sync (`npm test` will fail if they drift). Keep in mind that JSON
Schema only checks structure—it does not replace the Engine's identity,
topology, numeric/raw-input, depth, digest, and comparison-integrity checks.
Register all referenced schemas together when validating.

<!-- prettier-ignore -->
| Schema | `$id` | Document |
|---|---|---|
| `extraction` | `https://schemas.projections.githubnext.com/extraction/v0.json` | Extractor stdout |
| `extractor-request` | `https://schemas.projections.githubnext.com/extractor-request/v0.json` | Extractor stdin |
| `definition` | `https://schemas.projections.githubnext.com/definition/v0.json` | Projection definition |
| `extraction-document` | `https://schemas.projections.githubnext.com/extraction-document/v0.json` | Saved extraction |
| `comparison` | `https://schemas.projections.githubnext.com/comparison/v0.json` | Comparator output |
| `comparison-document` | `https://schemas.projections.githubnext.com/comparison-document/v0.json` | Saved comparison |
| `scenarios` | `https://schemas.projections.githubnext.com/scenarios/v0.json` | Authored renderer scenarios (`scenarios.json`) |
| `artifact` | `https://schemas.projections.githubnext.com/artifact/v0.json` | [CI artifact](contracts/saved-documents.md#ci-artifacts) manifest, `projections.artifact.json` |

### Versioning and publishing

Schemas live on their own dedicated host,
`https://schemas.projections.githubnext.com/`, which serves nothing else.

- **An ID names a major version only**, `<name>/v<major>.json`, and that is what
  documents and editors point to. Within a major version, schemas evolve only in
  place through additive changes (new optional fields, new definitions, or
  looser constraints). Version 0 follows this same rule until 1.0.
- **A breaking change gets a new major**, `<name>/v<major + 1>.json`, published
  alongside the previous one. Published major versions are never removed.
- **Every release publishes an immutable snapshot** of each schema at
  `<name>/v<major>/<release>.json` (for example,
  `https://schemas.projections.githubnext.com/graph/v0/0.2.0.json`), where
  `<release>` is the CLI's version. Each snapshot captures the exact schema
  shipped in that release, `$id` included, so you can pin a snapshot if you
  don't want to pick up additive changes automatically. Prereleases publish
  snapshots only, while stable releases also update `v<major>.json`.

The release workflow publishes the full set in order—snapshots first, then each
`v<major>.json`—and never deletes old files. Every file is served as
`application/schema+json` with `Access-Control-Allow-Origin: *`, so validators,
browser editors, and vscode.dev can fetch them directly. `v<major>.json` is
cached for five minutes, while snapshots are cached as immutable for a year. See
[Schema publishing](maintainers/schema-publishing.md) for the infrastructure
details. CI verifies that every `$id` and `$ref` points to the schemas host and
that the published set is complete.

TypeScript types for every document are available publicly from
`@githubnext/projections/schemas` (see [Packages](contracts/packages.md)). These
are the static types of the TypeBox definitions that generate the schemas, while
the source definitions and generated `packages/schemas/<name>/v<version>.json`
files stay in this repository's internal `packages/schemas/` workspace.

Editors backed by [SchemaStore](https://www.schemastore.org) match schemas by
file path. Once the URLs are public, a catalog entry for projection definitions
would look like this:

```json
{
  "name": "Projections definition",
  "description": "A projection definition: an extractor, an optional comparator and a renderer",
  "fileMatch": [".github/projections/*.json"],
  "url": "https://schemas.projections.githubnext.com/definition/v0.json"
}
```

Use path matching rather than adding `$schema` to a definition file, because
definitions reject unknown fields.

Comparator files, on the other hand, can declare their schema on line 1 for the
YAML language server:
`# yaml-language-server: $schema=https://schemas.projections.githubnext.com/comparator/v0.json`.
Their SchemaStore catalog entry would be:

```json
{
  "name": "Projections comparator",
  "description": "A Projections custom comparator: identity passes, CEL classification, step operations and metadata over the default comparator",
  "fileMatch": ["*.comparator.yaml", "*.comparator.yml"],
  "url": "https://schemas.projections.githubnext.com/comparator/v0.json"
}
```

Comparator test files use `comparator-tests/v0.json` and match
`*.comparator.test.yaml` and `*.comparator.test.yml`.

### Schema-owned contracts

TypeBox in `packages/schemas` is the single schema system for the contracts this
repository owns. Each schema defines the JSON Schema, the TypeScript type, and
the runtime validator together, so a hand-written type never stands in for a
checked one.

- **Published contracts** (`src/typebox`): the versioned documents listed above,
  along with their `$id`s and reference pages.
- **The local runner's API** (`src/runner`, exported as
  `@githubnext/projections-schemas/runner`): the responses from the Inspector
  service (`projections view` and [`serve --stdio`](runner/stdio-backend.md))
  that its clients decode. This API is internal, unversioned, and never
  published because the runner and its clients always ship from the same commit.
  Its generated schema lives outside the published set at
  `packages/schemas/internal/runner-api.json`. Calling
  `decodeRunnerResponse(name, value)` validates a response whole—nested entries
  included—and returns it typed, or throws a `RunnerResponseError` naming the
  request and the JSON pointer of the mismatching value. Because it uses
  TypeBox's interpreting checker, it needs no `eval` and runs cleanly under the
  Inspector's content security policy. Clients also tolerate extra properties a
  schema doesn't declare, letting the runner add fields without breaking them.
- **Documents another boundary validates** stay opaque in the runner API, which
  checks only the envelope its clients read: a saved document's `format` and
  `version` (the CLI already validated the document on load) and an explore
  candidate's trial definition.
- **The repository's own files**, `src/repository`: its tooling configuration
  and test data, such as `.portability.yaml`, `notices/notices.json` and the
  comparator goldens. Like the runner API, they are internal and unversioned,
  generated to `packages/schemas/internal/<name>.json`, and DollarLint
  (`.dollarlint.toml`) validates the files against them.

**Rust conformance.** The Rust service doesn't use generated types. Instead, its
tests (`packages/cli/tests/service/conformance.rs`) check every runner API
response against `internal/runner-api.json` even more strictly than the clients
do: any undeclared property fails the test. When you change a response, start in
the TypeBox source, regenerate the schema, and let the service tests hold the
Rust side to it.

Host-to-renderer and renderer-to-host frame validation is intentionally
asymmetric (see [renderer frames](contracts/renderer-frames.md)) and stays
outside this rule.

## Pages

Each page below specifies one document family; the sections after this cover the
rules shared across all of them.

- [Packages](contracts/packages.md) covers the published packages and what each
  entry exports.
- [Extractions](contracts/extractions.md) specifies the extraction document,
  volatile data, and canonical bytes.
- [Extractor request and execution](contracts/extractors.md) defines what an
  extractor receives, how the runner executes it, and how built-in extractors
  work.
- [Projection definitions](contracts/definitions.md) documents the definition
  file format.
- [Saved extractions and CI artifacts](contracts/saved-documents.md) covers
  saved extraction documents and CI artifact manifests.
- [Comparisons](contracts/comparisons.md) specifies the comparison document, the
  default comparator, custom comparator files and tests, the interpreter module,
  and saved comparisons.
- [Scenarios](contracts/scenarios.md) describes renderer and comparator fixture
  scenarios.
- [Renderer frame protocol](contracts/renderer-frames.md) defines the message
  protocol between a host and a renderer iframe.

## Text with inline code

Human-readable strings in Projections documents wrap literal code tokens in
backticks. This applies to comparison and step `summary` text, notices,
diagnostic `message`s, extractor error messages, extraction `metadata` text, and
any text that comparators or extractors put in their own metadata (such as
`api-compatibility`'s reasons). Put every identifier, type, member, signature,
version, path, selector, or other literal symbol inside a backtick span, and
keep natural prose outside:

```
Parameter `currency` was renamed to `currencyCode`, breaking named arguments
```

Use a backslash to escape a literal backtick or backslash (`` \` ``, `\\`) both
inside and outside a span; any other backslash stays literal, and an unclosed
backtick is treated as plain text. No other markup is supported—no emphasis,
links, or nesting—and these strings are never interpreted as HTML.

Viewers render code spans in monospace and the surrounding prose in the body
font (via the renderer kit's `Prose` component and the host's table and text
views). Plain-text attributes like tooltips and accessible labels strip the
backtick markers using `plainProse`, while plain-text outputs like the CLI's
text view keep them. `@githubnext/projections/schemas` exports `proseSpans`,
`plainProse`, and `codeSpan` (which escapes a string into a single span).

## Trust

Running code that comes from a repository requires explicit trust (`--trust` on
the CLI, or the trust confirmation in the Inspector). **Code from the reviewed
revision runs freely; code that only a comparison's head supplies needs explicit
trust.**

- An **extractor** needs trust whenever it runs a custom command or a built-in
  extractor that invokes a toolchain (surfaced as `requiresTrust` in
  `projections list` and in the Inspector's `policies`). Granting trust covers
  both compared revisions. Built-in extractors that only read files never need
  trust.
- A **comparator** never needs trust, because comparator files are declarative
  data executed inside a sandboxed interpreter.
- A **custom renderer** bundle is repository code, so it requires trust
  (`rendererRequiresTrust`) regardless of which revision supplies it—the working
  tree, `HEAD`, a base, or a head. There is one exception: if a bundle's
  `index.html` and `renderer.json` bytes match the bundle declared by the same
  projection at the revision's merge base with the repository's default branch
  (`refs/remotes/origin/HEAD`, or `HEAD`'s merge base for the working tree), it
  runs without extra trust. That bundle was already merged by the repository's
  maintainers, and everything it receives comes from the same repository. If a
  checkout lacks `refs/remotes/origin/HEAD` (you can set it with
  `git remote set-head origin --auto`), the exception does not apply. Checking
  out a pull request does not change the default branch, so any renderer added
  or modified by a pull request still requires trust. Every host enforces this
  rule: the Inspector and viewer, VS Code (where a trusted workspace passes
  `--trust`), `show`/`compare --png`, the `screenshot` tool, and `check`'s
  renderer checks. Because a renderer development server serves live package
  sources rather than the compared bundle, the Inspector only connects to one
  with `--trust`. Bundles referenced by a scenarios document follow
  [the scenarios rule](contracts/scenarios.md).

Renderer iframes run with `sandbox="allow-scripts"` and a content security
policy that grants no origin (not even the host's) and sets
`connect-src 'none'`. That prevents a renderer from reading files, calling host
APIs, or making network requests. Even so, browsers cannot stop a sandboxed
frame from navigating itself, which means a malicious renderer could exfiltrate
the data it receives inside a navigation URL. That is why renderer source
remains a trust boundary. Without trust, hosts fall back to the built-in
renderer for the extraction's schema (whichever renderer is named for or handles
that schema family), or to their table and text views, along with a notice
explaining why. Hosted views never load artifact-supplied renderers.

## One implementation, native and browser

Both the native and browser Engines implement the same request/response contract
(engine ABI version 0), exposing eight operations: `parse-json`, `decode`,
`normalize`, `canonicalize`, `validate-comparison`, `vary`, `pair`, and
`review`.

- `review` (`{comparison}`, reading only each change's `status`,
  `correspondence`, and `varied` fields on an engine-validated comparison)
  summarizes what a comparison asks of a reviewer:
  `{status, reviewable, content, identity, variation}`. A change counts as a
  content change when its status is `added`, `removed`, or `modified`, an
  identity change when its correspondence is `declared`, `split`, or `merge` (a
  renamed and modified item counts as both), reviewable when it is either, and
  expected variation when it is `unchanged`, `exact`, and has `varied`. `status`
  is `changed` if and only if at least one change is reviewable, so expected
  variation alone leaves a comparison `unchanged`. Both the CLI's batch and
  artifact statuses (`projections_engine::review`) and JavaScript hosts
  (`engine.review(comparison)`) use this result rather than counting `changes`
  directly.
- `pair` (`{before, after}`, reading only `projection.id`,
  `provenance.definition`, and `provenance.definitionDigest` from each
  extraction document) decides whether two extractions can be compared and
  returns `{pairing}`: `same` when they match; `projection` when they belong to
  different projections; `definition` (with the `differing` top-level fields)
  when their recorded definitions differ outside `presentation` (regardless of
  digests); or `components` when the definitions agree but the digests differ
  because the declared sources' bytes changed. It is the single implementation
  of that rule: the CLI calls `projections_engine::pairing`, JavaScript hosts
  call `engine.pair(before, after)`, and the shared conformance corpus
  (`packages/schemas/fixtures/conformance.json`) runs it both natively and in
  Wasm. Code outside the engine never compares digests or definitions on its
  own; the `no-restricted-syntax` rules in `tools/scripts/engine-contracts.mjs`
  flag any attempt to do so.

- `vary` (`{before, after}`) compares two extractions of the same revision—such
  as a rerun—item by item by ID without matching. It returns
  `{equal, within, beyond}`: `equal` is true when canonical bytes match;
  `within` lists each `{collection, id, path, generated?}` whose volatile value
  stayed within tolerance (with `generated: true` when a generated value was
  reworded from an equal basis); and `beyond` lists every other difference, each
  with a `reason`. Entries in `beyond` cover volatile values outside tolerance
  (a generated value whose basis moved includes `generated`, `because`, and a
  reason such as "Regenerated because the model changed"), non-volatile fields
  (`/label`, `/data/<key>`), items present in only one run (using an empty
  `path`), and top-level changes without a collection or ID (`/schema`,
  `/vocabularies`, or `/volatile`). Two runs are reproducible when `beyond` is
  empty. JavaScript hosts call `engine.vary(before, after)`, and Rust callers
  use `projections_engine::volatility::vary`.
- `parse-json` performs strict JSON parsing for artifact envelopes, catching
  duplicate keys, invalid Unicode, and numeric errors before host parsing can
  lose them. It allows up to 64 nesting levels and 32 MiB.
- `decode` takes raw extractor JSON directly so duplicate keys and numeric
  precision are checked before a standard JSON parser can erase them.

The Engine has no filesystem, Git, process, network, DOM, host theme, or clock
dependencies. All diagnostics use JSON Pointer paths and stable machine-readable
codes.

Internally, the Engine parses rather than merely validating—JSON stays at the
boundary. That boundary parses strictly within size limits, decodes an
extraction or comparison once into a typed model, serializes the model back out,
and computes the canonical bytes and digests that the protocol defines over
JSON. Because reading verifies every invariant up front, the in-memory model
holds them by construction: IDs are unique, relationship endpoints refer to real
entities, required fields exist, and item `data`, metadata, and generated values
are stored as the Engine's own canonical values (finite numbers, safe integers,
objects without duplicate keys, and omitted fields kept distinct from `null`).
Matching, ordering, comparison integrity, and volatility/tolerance checks all
run as pure functions over this typed model. Diagnostics are always emitted in
the order the contract specifies, regardless of how a document is read. Rust
callers decode an extraction with `Extraction::from_json` and validate a
comparator's JSON comparison against two extractions with `check_comparison`.

The browser-safe artifacts package parses raw envelopes strictly through the
Engine and runs build-time-generated structural validators. It checks extraction
digests and projection/definition identity, then reruns the default comparator
instead of trusting any saved change, status, step, or summary claims. Artifact
loading is capped at 32 MiB UTF-8, independent of individual extraction limits.
Keep in mind that validation does not authenticate provenance or replace
archive-byte or source checks. Viewing extractions and comparisons also works
offline without authentication.
