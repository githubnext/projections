# Extractor composition: upstream extractions

Status: **adopted**. Custom extractors can build on built-in extractions of the
same revision instead of re-parsing files a built-in already understands. See
[the extractor request contract](../contracts/extractors.md) for the wire format
and
[Build on built-in extractions](../guides/first-extractor.md#7-build-on-built-in-extractions-optional)
for the walkthrough.

## The problem

`cargo-dependencies` and `workspace-dependencies` already know how to read
crates, packages, and lockfile resolution. If you wanted an architecture
projection that adds extra facts to those units — like which ones touch the
network or filesystem — you had to re-read Cargo metadata and every
`package.json` yourself, and you still lost the lockfile resolution the
built-ins give you. There was no way to compose extractors.

## The decision

A command extractor can now declare built-ins under `extractor.upstream`, each
with its own `inputs`. The runner extracts the examined revision with each
listed built-in (named `<id>.<name>`) and passes the normalized results to your
command in the request's `upstream` map, keyed by name. Your command then writes
the final extraction.

- **Built-ins only, up to eight.** An upstream extractor can't declare upstreams
  of its own. That rules out recursion and cycles and keeps the request bounded
  at 8 MiB per extraction.
- **Same execution rules as any built-in.** Upstream runs go through the usual
  trust gating, supervision, normalization, and caching under their own
  identity. They inherit the downstream definition's `execution.scope` and
  `timeoutMs`, so they can never read more files than the command itself is
  allowed to see.
- **Deterministic inputs.** The downstream definition digest includes
  `upstream`, and built-in code lives inside the Projections executable whose
  version is part of every cache key. Because a pure built-in extracts a given
  revision the same way every time, the command sees identical input across
  runs.
- **The command owns the merge.** Combining extractions requires an ID
  convention (such as `<name>:` prefixes) and a rule for overlapping items, both
  of which depend on the domain. Leaving that to the command avoids forcing a
  one-size-fits-all merge rule from the runner.

## Alternatives

- **A built-in `union` extractor.** Using
  `inputs.parts: [{namespace, extractor, inputs}]` to merge same-schema
  extractions with namespaced IDs wouldn't require writing a command, but it
  also couldn't attach new facts — which is the main reason we needed
  composition. With `upstream`, a command can do the same merge in a few lines
  and still enrich the result.
- **Arbitrary command extractors upstream.** Letting command extractors depend
  on other command extractors would turn a projection definition into a full
  dependency graph of programs, bringing cycle detection and transitive trust
  decisions with it. Nothing needs that yet.
