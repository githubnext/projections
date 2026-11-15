---
description: "TypeScript packages' public API (typescript-public-api)"
---

# TypeScript public api — `typescript-public-api`

Discovery precedence:

1. Explicit `inputs.entrypoints`.
2. Each package's `exports`, including subpaths and conditions (`types` takes
   precedence over runtime conditions), or `types`/`typings` when `exports` is
   absent.

Example:

```json
{
  "extractor": "typescript-public-api",
  "renderer": "api",
  "inputs": {
    "tsconfig": "packages/client/tsconfig.json",
    "entrypoints": {
      ".": "packages/client/src/index.ts",
      "./testing": "packages/client/src/testing.ts"
    }
  }
}
```

`inputs.tsconfig` may sit anywhere in the repository, beside the definition for
example: its `include` and `files` resolve relative to its own directory, as the
compiler resolves them, so `"include": ["../../../packages/client/src"]` selects
that package's sources. With `inputs.entrypoints`, the program's roots are the
entry points alone (with the options of the tsconfig that covers each), so only
what they import is parsed and checked. A tsconfig's tests and scripts, whose
dependencies may not be installed, are left out. Without entry points, every
file the tsconfig includes is checked, and an unresolved module fails the
extraction with a hint to set `inputs.entrypoints`.

Export wildcard targets match sources in the selected program and substitute the
matched segment into the public subpath. JavaScript targets can resolve
same-stem TS/declaration files. An absent `dist/index.d.ts` is **not** guessed
to mean `src/index.ts`; explicitly select source entrypoints instead.
Conditional surfaces are combined, and conflicting definitions of the same
public export fail instead of arbitrarily choosing one condition.
Unsupported/unresolvable export targets need explicit entrypoints.

Export IDs comprise package name, public subpath and exported name, not
declaration filenames. Reexports and import aliases resolve through the checker.
Callable overloads, generic constraints/defaults, type predicates, type aliases,
mapped types, interfaces, classes, public/protected instance members, static
members, constructors, index signatures and interface call/construct signatures
are recorded. Unrelated object members and exports are sorted; overloads retain
checker order for functions, methods, constructors and structural call/construct
signatures. Intersection operands also retain checker order because they can
compose overloads. Reachable nonexported structural types are expanded so
changes to a function's internal return interface remain observable. Private
fields, private methods, `#private` members and all implementation bodies are
excluded. Class export entities retain `data.contract.native.nominalBrand` and
`staticNominalBrand` markers for private instance/static members, including
`#private`, so adding nominal branding changes the API without revealing private
names, types or bodies. Protected members remain because they affect subclass
consumers. Source evidence can change without semantic equality changing.

Limitations: this is a static checker surface, not a declaration emitter or
complete ABI compatibility checker. Overload order is conservatively preserved
even for disjoint signatures: utility-type inference can observe the last
overload. Nominal-brand markers record presence, not the identity/count of
private declarations. Advanced conditional/mapped/template types fall back to
the compiler's type printer. Recursive structures use named backreferences.
Separate programs with different compiler options do not reconcile divergent
interpretations of the same source. Project-reference builds are not run;
missing generated declarations require source path mappings or preexisting
output.

Each declaration also carries `data.contract`, its
[language-neutral contract facts](../../../docs/reference/schemas/api.md#contract):
its kind of declaration (with TypeScript's word for it as `term`, such as
`namespace`), its call signatures' parameters and return types, member modifiers
and visibility, and heritage clauses as `supertypes`, with every type as the
checker's text and its union constituents (each literal with the primitive it
widens to). Only `contract.native.nominalBrand` and `staticNominalBrand` are
TypeScript's own: a class with private (static) members, which TypeScript
compares nominally. The extraction declares `metadata.ecosystem: "typescript"`.
The [`api-compatibility` comparator](../../comparators/api-compatibility)
classifies changes from them; see
[API compatibility](../../../docs/models/api-compatibility.md#typescript-assignability-over-the-checkers-types).

The shared TypeScript input contract and runtime requirements (Node.js and the
repository's own `typescript`) are described in
[TypeScript support](../typescript-support/README.md).
