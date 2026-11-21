---
description: The language-neutral contracts and their JSON Schemas
icon: braces
---

# Schemas

The language-neutral contracts. `src/typebox` holds the TypeBox sources;
`schemas/<name>/v<n>.json` are the published JSON Schemas generated from them
(`npm run generate --workspace @githubnext/projections-schemas`; the package's
tests fail when they are stale), and `fixtures/` holds the conformance fixtures.
`src/runner` holds the local runner's API responses, exported as
`@githubnext/projections-schemas/runner` with their decoder; they are internal
and unversioned, and their generated schema, `internal/runner-api.json`, is
never published. The CLI's service tests check the Rust responses against it
([schema-owned contracts](../../docs/contracts.md#schema-owned-contracts)). The
reference pages are in
[docs/reference/schemas](../../docs/reference/schemas/README.md), and
[the contracts](../../docs/contracts.md) specify the wire formats.
