---
description: The resolved Cargo package graph (graph/v0)
---

# Cargo dependencies — `graph/v0`

The resolved package graph, direct and transitive, presented by the graph
renderer's
[`dependencies` view](../../renderers/graph/README.md#dependency-graphs).

- `metadataPath`: optional, existing JSON from
  `cargo metadata --format-version 1`. This is the read-only mode.
- Otherwise `cargoPath` defaults to `cargo`, and `manifestPath` defaults to
  `Cargo.toml`. The extractor executes
  `cargo metadata --format-version 1 --manifest-path <validated manifest>`.

Requires metadata version 1 with a populated `resolve` graph; `--no-deps`
metadata is rejected. Nodes identify resolved packages by name and source
(registry, Git repository without its requested revision or resolved commit, or
`local`), never by version or Cargo's absolute path IDs, so a version bump is
one modified package. The version and full source are package data. When a graph
resolves one package to several versions at once (for example `syn` 1 and 2),
each ID adds the semver-compatible line Cargo unifies within (`@1`, `@2`,
`@0.4`), or the full version if those coincide. Workspace membership and
dependency aliases, kinds, and target conditions are preserved. This is Cargo's
resolved graph, not a single-target build graph. Local (path) packages that
share a name are told apart by their workspace-relative directory
(`cargo:util:local@crates%2Fa%2Futil`), never merged. Cargo may update a
lockfile during resolution.

Shared input, path and trust rules for native ecosystem extractors are in
[the extractors overview](../README.md#ecosystem-extractors).
