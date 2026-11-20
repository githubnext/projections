# Projections contracts v0

Package versions are release versions ([releasing](maintainers/releasing.md));
the formats here have their own. Every format here is version 0: pre-stable, and
it may change incompatibly without a compatibility reader. Version 1 will be the
first stable version of the protocol, the domain schemas and the saved and
renderer documents.

```
  revision ──▶ extractor ──▶ extraction ──▶ renderer

  base revision ──▶ extractor ──▶ extraction ─┐
                                              ├─▶ comparator ──▶ comparison ──▶ renderer
  head revision ──▶ extractor ──▶ extraction ─┘
```

A **projection** combines an **extractor**, an optional **comparator** and a
**renderer**. An extractor examines one revision and writes an **extraction**. A
comparator relates two extractions of the same projection and writes a
**comparison**. Extractors may be written in any language; no TypeScript or Rust
SDK is required. Machine-readable draft-2020-12 schemas are shipped in
`packages/schemas/schemas/<name>/v<major>.json`, and published at their `$id`,
`https://schemas.projections.githubnext.com/<name>/v<major>.json` (see
[Versioning and publishing](#versioning-and-publishing)). They are generated
from the TypeBox definitions in `packages/schemas/src/typebox`, which also
provide the TypeScript types `packages/schemas/src/index.ts` exports; run
`npm run generate --workspace @githubnext/projections-schemas` after changing
them (`npm test` fails when the committed files are out of date). The schemas
validate structure; they do not replace the Engine's identity, topology,
numeric/raw-input, depth, digest and comparison-integrity validation. Register
the referenced schemas together.

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

Schemas have their own host, `https://schemas.projections.githubnext.com/`,
which serves nothing else.

- **An ID names a major version only**, `<name>/v<major>.json`, and that is what
  documents and editors refer to. Within a major, schemas change only additively
  (new optional fields, new definitions, looser constraints), in place. Version
  0 follows the same rule until 1.0.
- **A breaking change is a new major**, `<name>/v<major + 1>.json`, published
  alongside the previous one. A published major is never removed.
- **Every release publishes an immutable snapshot** of each schema at
  `<name>/v<major>/<release>.json`, such as
  `https://schemas.projections.githubnext.com/graph/v0/0.2.0.json`, where
  `<release>` is the CLI's version. A snapshot's content is the schema as that
  release shipped it, `$id` included, so pin a snapshot to stop following
  additions. A prerelease writes snapshots only; a stable release also replaces
  `v<major>.json`.

The release workflow publishes the whole set: snapshots first, then each
`v<major>.json`; it never deletes. Every file is served as
`application/schema+json` with `Access-Control-Allow-Origin: *`, so validators,
browser editors and vscode.dev can fetch them directly; `v<major>.json` is
cached for five minutes and snapshots for a year, as immutable.
[Schema publishing](maintainers/schema-publishing.md) describes the setup. CI
checks that every `$id` and `$ref` uses the schemas host and that the published
set is complete.

The TypeScript types of every document are public in
`@githubnext/projections/schemas` (see [Packages](contracts/packages.md)). They
are the static types of the TypeBox definitions the schemas are generated from,
which stay in this repository's internal `packages/schemas/` workspace with the
generated `packages/schemas/<name>/v<version>.json`.

Editors that use [SchemaStore](https://www.schemastore.org) match files by path.
A catalog entry for projection definitions, to propose once the URLs are public,
would be:

```json
{
  "name": "Projections definition",
  "description": "A projection definition: an extractor, an optional comparator and a renderer",
  "fileMatch": [".github/projections/*.json"],
  "url": "https://schemas.projections.githubnext.com/definition/v0.json"
}
```

Match by path rather than adding `$schema` to a definition: definitions reject
unknown fields.

Comparator files can name their schema in their first line, which the YAML
language server reads,
`# yaml-language-server: $schema=https://schemas.projections.githubnext.com/comparator/v0.json`,
and the catalog entry for them would be:

```json
{
  "name": "Projections comparator",
  "description": "A Projections custom comparator: identity passes, CEL classification, step operations and metadata over the default comparator",
  "fileMatch": ["*.comparator.yaml", "*.comparator.yml"],
  "url": "https://schemas.projections.githubnext.com/comparator/v0.json"
}
```

and for their tests, `comparator-tests/v0.json`, matching
`*.comparator.test.yaml` and `*.comparator.test.yml`.

### Schema-owned contracts

TypeBox, in `packages/schemas`, is the one schema system for the contracts this
repository owns: each schema provides the JSON Schema, the TypeScript type and
the runtime validator, so a hand-written type never stands in for a checked one.

- **Published contracts**, `src/typebox`: the versioned documents above, with
  their `$id`s and reference pages.
- **The local runner's API**, `src/runner`, exported as
  `@githubnext/projections-schemas/runner`: the responses of the Inspector
  service (`projections view` and [`serve --stdio`](runner/stdio-backend.md))
  that its clients decode. It is internal and unversioned, never published: the
  runner and its clients ship from the same commit. Its generated schema is
  `packages/schemas/internal/runner-api.json`, outside the published set.
  `decodeRunnerResponse(name, value)` checks a response whole, nested entries
  included, and returns it typed, or throws a `RunnerResponseError` that names
  the request and the JSON pointer of the value that doesn't match. It uses
  TypeBox's interpreting checker, which needs no `eval` and so runs under the
  Inspector's content security policy. Clients accept properties a schema
  doesn't declare, so a runner can add a field without breaking them.
- **Documents another boundary validates** are opaque in the runner API, which
  checks only the envelope its clients read: a saved document's `format` and
  `version` (the CLI validated the document when it loaded it), and an explore
  candidate's trial definition.

**Rust conformance.** The Rust service has no generated types. Instead, its
tests (`packages/cli/tests/service/conformance.rs`) check every runner API
response they receive against `internal/runner-api.json`, more strictly than the
clients: a property the schema doesn't declare fails. Changing a response
therefore starts in the TypeBox source; regenerate the schema, and the service
tests then hold the Rust side to it.

Host-to-renderer and renderer-to-host frame validation is asymmetric on purpose
(see [renderer frames](contracts/renderer-frames.md)) and stays outside this
rule.

## Pages

Each page specifies one family of documents; the rules that apply to all of them
follow.

- [Packages](contracts/packages.md): the published packages and what each
  exports.
- [Extractions](contracts/extractions.md): the extraction document, volatile
  data and canonical bytes.
- [Extractor request and execution](contracts/extractors.md): what an extractor
  receives, how it runs and the built-in extractors.
- [Projection definitions](contracts/definitions.md): the definition file.
- [Saved extractions and CI artifacts](contracts/saved-documents.md): saved
  extraction documents and CI artifact manifests.
- [Comparisons](contracts/comparisons.md): the comparison document, the default
  comparator, comparator files and tests, the interpreter module and saved
  comparisons.
- [Scenarios](contracts/scenarios.md): renderer and comparator fixture
  scenarios.
- [Renderer frame protocol](contracts/renderer-frames.md): the messages between
  a host and a renderer frame.

## Text with inline code

Human-readable strings in these documents mark inline code with backticks:
comparison and step `summary`, notices, diagnostic `message`s, extractor error
messages and extraction `metadata` text, and the text comparators and extractors
put in their own metadata (such as `api-compatibility`'s reasons). Every
identifier, type, member, signature, version, path, selector and other literal
symbol goes in a span; human language stays outside:

```
Parameter `currency` was renamed to `currencyCode`, breaking named arguments
```

A backslash escapes a literal backtick or backslash (`` \` ``, `\\`), inside a
span or outside it; any other backslash is literal. An unclosed backtick is
literal text. There is no other markup: no emphasis, links or nesting, and the
text is never HTML.

Viewers draw spans in the code font and the rest in the text font (the renderer
kit's `Prose`, and the host's table and text views); attributes that take plain
text, such as titles and accessible labels, drop the markers (`plainProse`).
Plain-text output, such as the CLI's text rendering, keeps the backticks.
`@githubnext/projections/schemas` exports `proseSpans`, `plainProse` and
`codeSpan` (which escapes a string as one span).

## Trust

Explicit trust (`--trust`, and the Inspector's trust confirmation) is required
to run repository code. **Code from the reviewed revision runs freely; code that
only a comparison's head supplies needs explicit trust.**

- An **extractor** requires trust when it is a command or a built-in extractor
  that runs a toolchain (`requiresTrust` in `projections list` and the
  Inspector's `policies`). Trust covers both revisions. Built-in extractors that
  only read files never require it.
- A **comparator** never requires trust: comparator files are data run by a
  sandboxed interpreter.
- A **custom renderer** bundle is repository code, so it requires trust
  (`rendererRequiresTrust`), whichever revision supplies it: the working tree,
  `HEAD`, a base or a head. The one exception is a bundle whose `index.html` and
  `renderer.json` bytes are identical to the bundle the same projection declares
  at the revision's merge base with the repository's default branch
  (`refs/remotes/origin/HEAD`; for the working tree, `HEAD`'s merge base): that
  renderer is the one the repository's maintainers merged, and everything it is
  given is derived from the same repository. A checkout with no
  `refs/remotes/origin/HEAD` (`git remote set-head origin --auto` sets it) has
  no exception. Checking out a pull request doesn't change its default branch,
  so a renderer the pull request adds or changes still needs trust. Every host
  applies the rule: the Inspector and viewer, VS Code (a trusted workspace
  passes `--trust`), `show`/`compare --png` and the `screenshot` tool, and
  `check`'s renderer checks. A renderer development server serves the package's
  live sources rather than the compared bundle, so the Inspector uses one only
  with `--trust`. Bundles a scenarios document names follow
  [the scenarios rule](contracts/scenarios.md).

Renderer frames use `sandbox="allow-scripts"` and a content security policy that
grants no origin (not even the host's) and `connect-src 'none'`, so a renderer
can't read files, call APIs or fetch. Browsers can't, however, stop a sandboxed
frame from navigating itself, so a malicious renderer could exfiltrate the data
it receives by encoding it into a navigation URL. That is why renderer source is
a trust decision. Without trust, hosts show the built-in renderer for the
extraction's schema (the renderer named for, or handling, its schema family), or
their table and text views, with a notice saying why. Hosted views never load
artifact-supplied renderers.

## One implementation, native and browser

The native and browser Engines implement the same request and response contract
(engine ABI version 0). Operations are `parse-json`, `decode`, `normalize`,
`canonicalize`, `validate-comparison` and `vary`. `vary` (`{before, after}`)
compares two extractions of the same revision, such as a rerun, item by item by
ID with no matching, and returns `{equal, within, beyond}`: `equal` when the
canonical bytes are identical; `within`, each
`{collection, id, path, generated?}` whose volatile value varied within
tolerance (a generated value reworded from an equal basis has
`generated: true`); `beyond`, everything else that differs, each with a
`reason`: volatile values beyond tolerance (a generated value whose basis moved
has `generated` and `because`, and a reason such as "Regenerated because the
model changed"), other fields (`/label`, `/data/<key>`), items in one run only
(an empty `path`) and, without a collection or ID, `/schema`, `/vocabularies` or
`/volatile`. The runs are reproducible when `beyond` is empty. JavaScript hosts
call it as `engine.vary(before, after)`, Rust callers as
`projections_engine::volatility::vary`. `parse-json` returns generic strict JSON
for artifact envelopes, preserving duplicate-key, Unicode and numeric checks
before host parsing; it allows 64 nested levels and 32 MiB. `decode` accepts raw
extractor JSON so duplicate keys and numeric precision are checked before an
ordinary host parser can erase that information. The Engine has no filesystem,
Git, process, network, DOM, host theme or clock dependency. Diagnostics use JSON
Pointer paths and stable machine-readable codes.

Inside, the Engine parses rather than validates: JSON stays at its boundary. The
boundary strictly parses within the size limits, reads an extraction or a
comparison once into a typed model, writes the model back, and computes
canonical bytes and digests, which the protocol defines over JSON. Reading
establishes every fact validation checks, so the model holds them by
construction: IDs are unique, endpoints are entities, required fields are
present, and an item's `data`, metadata and generated values are the Engine's
own canonical values (finite numbers, safe integers, objects without duplicate
keys, omitted and `null` kept apart). Matching, ordering, comparison integrity
and volatility and tolerance judgments work on the model alone, as pure
functions of owned values. Diagnostics are reported in the order the contract
checks them, however a document is read. Rust callers read an extraction with
`Extraction::from_json` and check a comparator's JSON comparison against two
with `check_comparison`.

The browser-safe artifacts package strictly parses raw envelopes through the
Engine and uses build-time-generated structural validators. It verifies
extraction digests and projection/definition identity, then reruns the default
comparator rather than accepting a saved change, status, step or summary claim.
Artifact loading is bounded to 32 MiB UTF-8, independently of individual
extraction limits. Validation does not authenticate provenance or replace
archive-byte or source checks. Extraction and comparison viewing also work
offline without authentication.
