---
description: "A .NET project's public API, via Roslyn (dotnet-public-api)"
---

# .NET public API — `dotnet-public-api`

Roslyn/.NET effective public API. The project's own build reports its exact
compiler arguments, and the helper replays them with the Roslyn of the SDK that
ran the build (selected by the repository's `global.json` or the default SDK),
including the project's source generators. This extractor shares the .NET
helper, configuration, application adapter contract and validation described in
[.NET support](../dotnet-support/README.md).

Each declaration also carries `data.contract`, the facts ApiCompat's rules
inspect (visibility, modifiers, the full base-type chain and implemented
interfaces as `supertypes`, member types without nullable annotations,
signatures with their parameters, accessors as `access`, generic constraints,
constant values and attributes) as
[language-neutral contract facts](../../../docs/reference/schemas/api.md#contract),
with C#'s word for each kind of declaration as `term` (such as `record class`);
only the `virtual`, `override` and `sealed` modifiers are .NET's own, in
`contract.native`. The extraction declares `metadata.ecosystem: "dotnet"`. The
[`api-compatibility` comparator](../../comparators/api-compatibility) classifies
changes from them; see
[API compatibility](../../../docs/models/api-compatibility.md#net-apicompats-default-mode-reproduced).
`tests/fixtures/compatibility` holds a before and after library whose every
change the native test classifies.
