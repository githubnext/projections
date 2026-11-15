# Extractor composition: upstream extractions

Status: **adopted**. A custom extractor can build on built-in extractions of the
same revision instead of reading what a built-in already reads. The contract is
in [the extractor request](../contracts/extractors.md), and the guide is
[Build on built-in extractions](../guides/first-extractor.md#7-build-on-built-in-extractions-optional).

## The problem

`cargo-dependencies` and `workspace-dependencies` read crates, packages and
their lockfile resolution. An architecture projection that adds facts to those
units, such as which use the network or the filesystem, had to read Cargo
metadata and every `package.json` again, and lost the lockfile resolution the
built-ins do. Extractors couldn't be composed.

## The decision

A command extractor names built-ins in `extractor.upstream`, each with its own
`inputs`. The runner extracts the examined revision with each, as the projection
`<id>.<name>`, then passes the normalized extractions to the command in the
request's `upstream`, keyed by name. The command writes the final extraction.

- **Built-ins only, at most eight.** An upstream can't have upstreams of its
  own, so composition can't recurse or form cycles, and the request stays
  bounded (8 MiB per extraction).
- **The same execution as any built-in.** Upstream runs are trust-gated,
  supervised, normalized and cached by their own identity; they take the
  downstream definition's `execution.scope` and `timeoutMs`, so they read no
  more files than the command may.
- **Deterministic.** The downstream definition digest covers `upstream`, and
  built-ins' code belongs to the Projections executable, whose version every
  cache key includes. A pure built-in extracts the same revision the same way,
  so the command sees the same input on every run.
- **The command decides how to combine.** Merging extractions needs an ID
  convention (`<name>:` prefixes, say) and a rule for overlapping items, which
  differ by domain; the command applies its own rather than one the runner would
  impose.

## Alternatives

- **A built-in `union` extractor**:
  `inputs.parts: [{namespace, extractor, inputs}]` merging same-schema
  extractions with namespaced IDs. It needs no command, but it can't add facts,
  which is what motivated composition; with `upstream` a command can do the same
  merge in a few lines.
- **Arbitrary extractors upstream**: allowing command extractors upstream would
  make a definition a graph of programs, with cycles to detect and trust to
  thread through. Nothing needs it yet.
