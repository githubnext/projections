---
description: The language-neutral contracts and their JSON Schemas
icon: braces
---

# Schemas

The language-neutral contracts. `src/typebox` holds the TypeBox sources;
`schemas/<name>/v<n>.json` are the published JSON Schemas generated from them
(`npm run generate --workspace @githubnext/projections-schemas`; the package's
tests fail when they are stale), and `fixtures/` holds the conformance fixtures.
The reference pages are in
[docs/reference/schemas](../../docs/reference/schemas/README.md), and
[the contracts](../../docs/contracts.md) specify the wire formats.
