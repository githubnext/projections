# API compatibility

Status: **adopted** for `api/v0`. Implemented by the
[`api-compatibility` comparator](../../packages/comparators/api-compatibility),
the `contract` facts produced by `dotnet-public-api`, `typescript-public-api`,
`rust-public-api`, `go-public-api`, and `swift-public-api` (Swift's
language-specific rules aren't modeled yet, so its changes use the shared
rules), and the [`api` renderer](../../packages/renderers/api).

When reviewing an API projection, there is one question you want answered first:
**does this change break anyone using the API?** This document explains where
that answer is computed, what it reports, and where it draws the line on what it
can't know.

## The answer: a classification per change

Every changed declaration receives one **compatibility level**:

<!-- prettier-ignore -->
| Level | Meaning | Typical version bump |
|---|---|---|
| `breaking` | Some valid consumer stops compiling, linking or running correctly against the new revision | Major |
| `additive` | New surface that consumers can opt into; nothing that worked stops working | Minor |
| `compatible` | A change that neither breaks consumers nor adds surface (a narrowed return type, a nullability annotation) | Patch |
| `unknown` | The rules can't decide; a person has to look | — |

When relevant, a breaking classification also says **how** it breaks: `binary`
(code compiled against the old revision fails against the new one without
recompiling) or `source` (code fails to compile or compiles with a different
meaning). Only .NET has a binary compatibility boundary distinct from source;
TypeScript, Rust, and Go consumers recompile from source, so their breaks carry
no sub-kind.

Each classification includes a plain-language **reason** ("Return type changed
from `string` to `int`") and the **rule** behind it — an official diagnostic ID
(`CP0002`), an anchor from an official compatibility reference
(`enum-variant-new`), or our own rule name when none exists
(`required-parameter-added`).

## Where it is computed

### The official tools need both revisions at once

Most ecosystems have an official or de facto compatibility checker:

<!-- prettier-ignore -->
| Ecosystem | Tool | What it compares |
|---|---|---|
| .NET | ApiCompat (`Microsoft.DotNet.ApiCompat`, SDK package validation) | Two assemblies |
| TypeScript | None official. `checker.isTypeAssignableTo` answers assignability, but only for two types in **one** program; API Extractor reports exist without a standard for what breaks | — |
| Rust | cargo-semver-checks, implementing the [Cargo SemVer reference](https://doc.rust-lang.org/cargo/reference/semver.html) | Two rustdoc JSON documents |
| Go | `golang.org/x/exp/apidiff`, the Go team's tool | Two package export data sets |

Every one of these tools is a native **two-revision** program, and Projections
intentionally has no slot for that:

- **Extractors** see only one revision at a time. That's what keeps extractions
  deterministic, cacheable, and reusable in any pairing — reviewers pick which
  two revisions to compare at viewing time (base vs. head, or the last two
  pushes), and precomputing every pair doesn't scale.
- **Comparators** see both extractions, but run as sandboxed rules with no
  filesystem, process, or network access. They can't invoke `dotnet`, `cargo`,
  or `go`.

Supporting those tools directly would require a third component kind — a native,
trusted, two-revision step precomputed for a fixed pair. That breaks
viewing-time comparisons and can't be verified by rerunning, so we ruled it out.

### The decision: compiler facts per revision, official rules per comparison

Because compatibility is a **comparison-level** judgment, it belongs in a
comparator, split along the existing architecture:

```
  revision ──▶ extractor (the ecosystem's own compiler) ──▶ declarations + contract facts ─┐
                                                                                           ├─▶ api-compatibility comparator ──▶ comparison + classification
  revision ──▶ extractor (the ecosystem's own compiler) ──▶ declarations + contract facts ─┘
```

1. **Extractors stay single-revision and deterministic.** Each `*-public-api`
   extractor already asks the ecosystem's compiler (Roslyn, the repo's `tsc`,
   rustdoc, `go/types`) for the public API. It also records each declaration's
   **contract** — the compiler facts official compatibility rules inspect, like
   accessibility, `virtual`, the full base-type chain, parameter names, default
   interface implementations, Rust's `#[non_exhaustive]`, Go struct
   comparability, or unexported interface methods. Everything comes from the
   compiler for that single revision, never guessed from text.
2. **The comparator applies the official rules** across the two contracts.
   `api-compatibility` is a regular comparator file
   ([`api-compatibility.comparator.yaml`](../../packages/comparators/api-compatibility/api-compatibility.comparator.yaml))
   loaded with no special privileges. It layers classifications onto the default
   baseline without altering correspondence or ordering.

Why not hash each declaration into binary- and source-relevant **fingerprints**?
A hash only tells you _that_ something changed, never _whether it's safe_:
adding an optional parameter and removing a required one both change the hash.
The comparator needs the underlying facts.

Why not embed raw tool inputs (reference assemblies, rustdoc JSON, apidiff
export data) in extraction metadata? The sandboxed comparator still couldn't run
the native tool, the blobs are huge, and we'd still have to reimplement the
rules anyway.

Here are the tradeoffs, candidly:

- The rules are **reproduced, not invoked**. Each ecosystem section below spells
  out which official rules are covered and which aren't. Anything outside them
  is marked `unknown`, never guessed.
- **Hosted views** classify changes too, running the comparator file from the
  PR's base revision in the sandboxed interpreter so a PR can't rewrite its own
  compatibility rules.
- Teams can still run the official tool in CI alongside Projections; this
  doesn't replace it as a release gate.

## Model (`api/v0`)

### Declaration contract

An `api/v0` entity can carry a `data.contract` object of compiler facts. Because
it is part of the entity's content, a contract change marks the declaration
`modified` even if its printed signature looks identical (for example, when a
base class gains a new base or an interface drops its only unexported method).
Extractors only emit facts their compiler actually reports.

The contract describes declarations in language-neutral terms defined in the
[schema reference](../reference/schemas/api.md#contract) and validated by the
Engine (wrong types or unknown fields fail at their path). Every contract names
its kind twice: `declaration` is the shared cross-language kind (`class`,
`interface`, `function`, `method`, `property`, `field`, `variant`, `constant`,
and so on), while `term` is the ecosystem's native word (Rust's `trait-method`,
Go's `func`, .NET's `record class`). Changing `term` counts as a kind change.
The remaining shared facts are:

<!-- prettier-ignore -->
| Fact | Meaning |
|---|---|
| `visibility` | `public`, or `protected` when only subclasses can use it; every contract states it |
| `static`, `abstract`, `sealed`, `readonly`, `required`, `optional` | It belongs to its type; implementers or subclasses must provide it; consumers can't inherit or implement it; consumers can't assign it; creating an instance must set it; it may be absent |
| `nonExhaustive`, `hiddenMembers` | It may gain variants or fields without a breaking change; it has fields or variants consumers can't see |
| `type` | Its type: of a field, property, variable, constant or event, the type an alias names, or the type an implementation is for |
| `value`, `underlying`, `source` | A constant's or enum member's value; the type an enum or defined type is represented by; what a re-export re-exports |
| `access` | A property's accessors (`read`, `write`, `init`), each with its visibility |
| `signatures` | How it is called: parameters (`name`, `type`, `optional`, `variadic`, `default`, and `passing`: by `value` or a .NET reference kind), `returns` and `typeParameters`; one per overload |
| `typeParameters`, `constraints` | Generic parameters (`name`, `constraints`, `default`, a value parameter's `type`); what an associated type must satisfy |
| `supertypes` | What it derives from (`extends`) or implements (`implements`) |
| `attributes` | Attributes or annotations as written; parameters and return values have their own |

Types where values flow (`type`, parameter types, `returns`) take the shape
`{text, union?}` — the language's rendered type text plus resolved union
constituents when available. Facts needed by only one ecosystem live under
`native` (documented per ecosystem below) and are ignored by other ecosystems'
rules. False booleans and empty lists are omitted.

The extraction's `metadata.ecosystem` selects the rule set (`dotnet`,
`typescript`, `rust`, or `go`). If it or the contracts are absent, the
comparator falls back to the shared rules and notes that in `notices`. Missing
facts cause rules that depend on them to return `unknown`.

### Comparison metadata

The comparator returns the baseline comparison enriched with two additions:

- Each entity change's `summary` holds a single-sentence classification so table
  and text views display it even without the `api` renderer.
- `metadata.compatibility` records the full structured breakdown:

```json
{
  "version": 0,
  "ecosystem": "dotnet",
  "rules": "ApiCompat (default mode), reproduced",
  "counts": {"breaking": 2, "additive": 5, "compatible": 1, "unknown": 0},
  "changes": {
    "api:Http:M:Http.Client.Send(Http.Request)": {
      "level": "breaking",
      "kinds": ["binary", "source"],
      "reason": "Return type changed from Response to Task<Response>",
      "findings": [
        {"level": "breaking", "kinds": ["binary", "source"], "rule": "CP0002",
         "reason": "Return type changed from Response to Task<Response>"}
      ]
    }
  },
  "notices": []
}
```

`changes` is keyed by comparison change ID and covers every entity change
(relationship changes aren't classified because `contains` edges just mirror
declarations). Each change's `level` is its most severe finding (`breaking`,
then `unknown`, `additive`, `compatible`), `kinds` unions the kinds of its
breaking findings, and `reason` joins the most severe findings' reasons.
`notices` holds up to 20 sentences about the classification as a whole, such as
missing contracts or an unrecognized ecosystem.

### Rules every ecosystem shares

<!-- prettier-ignore -->
| Change | Level | Rule |
|---|---|---|
| A declaration is removed | `breaking` (.NET: binary and source) | `removed` |
| A declaration is renamed or moved (`declared`, `split` or `merge` correspondence) | `breaking`; code naming the old identity fails | `renamed` |
| A declaration is added | `additive`, unless an ecosystem rule below says adding it breaks | `added` |
| A declaration changes and no rule explains it | `unknown` | `unclassified` |

## .NET: ApiCompat's default mode, reproduced

Because ApiCompat requires both compiled assemblies and can't run inside a
sandboxed comparator, we reproduce the rules of
`Microsoft.DotNet.ApiCompatibility` (the engine behind SDK package validation
and `Microsoft.DotNet.ApiCompat.Tool`) in its **default, non-strict mode with
two opt-in rules enabled** (`ApiCompatEnableRuleCannotChangeParameterName` and
`ApiCompatEnableRuleAttributesMustMatch`), since renamed parameters break named
arguments and attributes alter runtime behavior. Facts come from Roslyn after
replaying the project's build, and rule IDs match the
[package validation diagnostic IDs](https://learn.microsoft.com/dotnet/fundamentals/apicompat/diagnostic-ids).

Contract (`dotnet`):

<!-- prettier-ignore -->
| Fact | On | From Roslyn |
|---|---|---|
| `declaration` (`term`) | all | Types: `class` (`class`, `record class`), `struct` (`struct`, `record struct`), `interface`, `enum`, `type` (`delegate`). Members: `method`, `constructor`, `property`, `event`, `field`, `constant` (`const`), `variant` (`enum member`) |
| `visibility` | all | `public`, or `protected` for `protected` and `protected internal` (ApiCompat normalizes it so) |
| `sealed` | types | Effectively sealed: sealed, static, or without an accessible constructor |
| `abstract`, `static` | all | Roslyn's modifiers (a type's `abstract` only for classes) |
| `supertypes` | types | Every ancestor class (`extends`, nearest first, without `System.Object`), then every implemented interface (`implements`, sorted) |
| `underlying` | enums | The underlying integral type |
| `typeParameters` | generic types; generic methods' signatures | Constraints as `class`, `struct`, `unmanaged`, `notnull`, `new()` or a type |
| `type` | properties, fields, events | The type, without nullable annotations |
| `signatures` | methods, indexers | One: `returns` (a method's return type, an indexer's type) and parameters with `variadic` for `params` and `passing`: `value`, `ref`, `out`, `in` or `ref readonly` |
| `access` | properties | Each accessor's visibility: `read` (get), `write` (set), `init` |
| `readonly`, `required` | fields, properties | Roslyn's modifiers |
| `value` | constants, enum members | The constant value as text |
| `attributes` | all, parameters, return values (`returnAttributes`) | Each attribute as Roslyn writes it |
| `native.virtual`, `native.override`, `native.sealed` | members (`sealed` on types too) | The modifiers, which CP0012, CP0013, CP0018, CP0021 and CP0009's reason distinguish |

Nullable reference annotations stay in `data.signature` for display but are
stripped from types and parameters: changing them only causes compiler warnings,
and ApiCompat ignores them too.

<!-- prettier-ignore -->
| Rule | Change | Level |
|---|---|---|
| CP0001 | A type is removed | `breaking` (binary, source) |
| CP0002 | A member is removed, or its type changes (the old member is missing) | `breaking` (binary, source) |
| CP0005 | An abstract member is added to a type that wasn't effectively sealed | `breaking` (binary, source) |
| CP0006 | A member without a default implementation is added to an interface | `breaking` (binary, source) |
| CP0007 | An ancestor class is removed | `breaking` (binary, source) |
| CP0008 | An implemented interface is removed | `breaking` (binary, source) |
| CP0009 | A type becomes effectively sealed | `breaking` (binary, source) |
| CP0010 | An enum's underlying type changes | `breaking` (binary, source) |
| CP0011 | An enum member's value changes | `breaking` (binary) |
| CP0012 | `virtual` is removed (outside an effectively sealed type), or `abstract` is removed without becoming `virtual` | `breaking` (binary, source); in a type that can't be inherited, removing `virtual` or sealing an override is `compatible` |
| CP0014, CP0015 | An attribute is removed, or its arguments change | `breaking` |
| CP0017 | A parameter is renamed (breaks named arguments) | `breaking` (source) |
| CP0018 | `sealed` is added to an interface member, or a `static abstract` one becomes plain `static` | `breaking` (binary, source) |
| CP0019 | Visibility is reduced (`public` to `protected`) | `breaking` (binary, source) |
| CP0021 | A generic constraint is added, or removed outside a sealed type or non-virtual method | `breaking` (binary, source); removed on a sealed type or non-virtual method: `compatible` |
| CP0013, CP0016, CP0020 | `virtual` added, attribute added, visibility expanded: reported only in strict mode | `compatible` |

Additional rules come from the
[.NET breaking change rules](https://github.com/dotnet/runtime/blob/main/docs/coding-guidelines/breaking-change-rules.md)
(rule names in parentheses):

<!-- prettier-ignore -->
| Change | Level |
|---|---|
| A type's kind changes, such as class to struct (`type-kind`) | `breaking` (binary, source) |
| `static` is added or removed (`static`) | `breaking` (binary, source) |
| An existing member becomes `abstract` (`abstract-added`) | `breaking` (binary, source) |
| A constant's value changes (`constant-value`); compiled consumers keep the old value | `breaking` (binary) |
| A property loses an accessor or changes `set` to `init` (`accessor`); gains one: `additive` | `breaking` (binary, source) |
| A parameter's `ref`, `out` or `in` changes (`ref-kind`) | `breaking` (source) |
| A parameter loses its default value or `params` (`parameter-default`); gains one: `additive`; a default's value changes: `compatible` | `breaking` (source) |
| A field becomes `readonly`, or a property `required` (`readonly`, `required`) | `breaking` (source) |
| Only nullable annotations or formatting change (`annotations`) | `compatible` |

Not reproduced: assembly identity (CP0003) and package-level checks (PKV), which
aren't API declarations; members moved up to a base class (ApiCompat accepts
them, whereas the comparator reports removal); and cross-target-framework
comparisons.

## TypeScript: assignability over the checker's types

TypeScript has no official breaking-change standard. The right theoretical test
is type assignability (`checker.isTypeAssignableTo`), but the checker only
evaluates two types inside the same program while an extractor only sees one
revision. Instead, the extractor records each declaration's types **as the
repository's own checker resolves them**: parameter and return types broken into
union constituents, with each literal noting the primitive it widens to. The
comparator checks assignability over those constituents and returns `unknown`
whenever deeper structural reasoning is needed (distinct object types, generics,
conditional or mapped types).

Contract (`typescript`):

<!-- prettier-ignore -->
| Fact | On | From the checker |
|---|---|---|
| `declaration` (`term`) | all | `function`, `variable`, `class`, `interface`, `alias`, `enum`, `module` (`namespace`), `property`, `method`, `constructor`, `index`, `call` or `construct` |
| `signatures` | functions, methods, constructors, call, construct and index members | In overload order; a rest parameter is `variadic`; an index signature's one parameter is its key |
| `type` | variables, aliases, properties, index members | The type with its union constituents |
| `optional`, `readonly`, `static`, `abstract` | members | The member's modifiers |
| `visibility` | all | `protected` for a `protected` member or constructor; otherwise `public` |
| `supertypes` | classes, interfaces | The heritage clauses' types, as `extends` or `implements` |
| `native.nominalBrand`, `native.staticNominalBrand` | classes | It has private instance (static) members, so TypeScript compares it nominally |

Every type is shaped as `{text, union: [{text, primitive?}]}` — the checker's
canonical text plus its union constituents (a single entry for non-unions), with
literal constituents recording the primitive they widen to.

Assignability (`S ⊑ T`) holds when the texts match, `T` contains `any` or
`unknown`, `S` is `never`, or every constituent of `S` either matches a
constituent of `T` or is a literal of a primitive in `T`. It fails **provably**
when a constituent of `S` is a primitive or literal and every constituent of `T`
is too, with none accepting it. Everything else stays undecided.

<!-- prettier-ignore -->
| Rule | Change | Level |
|---|---|---|
| `required-parameter-added`, `parameter-removed` | A call that worked has too few or too many arguments | `breaking` |
| `parameter-narrowed` | An old argument type isn't assignable to the new parameter | `breaking` |
| `return-widened` | The new return type isn't assignable to the old one | `breaking` |
| `parameter-added`, `parameter-widened` | An optional parameter is added, or a parameter accepts more | `additive` |
| `parameter-optional` | A required parameter becomes optional: calls may omit it | `additive` |
| `parameter-renamed` | A parameter is renamed: TypeScript passes arguments by position | `compatible` |
| `return-narrowed` | The return type is narrower | `compatible` |
| `overloads` | Overloads are added, removed or reordered | `unknown`, unless each old overload is matched |
| `member-added` | A required property or method is added to an interface (implementers and object literals must add it), an abstract member to a class, or an index signature | `breaking` |
| `member-added` | An optional interface member, or a class member | `additive` |
| `optionality` | A property becomes required (producers break) or optional (readers break) | `breaking` |
| `readonly` | A property becomes `readonly` | `breaking`; removing it: `compatible` |
| `property-type` | A mutable property's type changes (read and written, so it must be identical) | `breaking` when provably different, else `unknown` |
| `alias-widened` | An alias accepts more (a union gains a member): exhaustive checks over it may fail | `additive` |
| `alias-narrowed` | An alias accepts less | `breaking` |
| `abstract`, `static`, `protected` | A class becomes abstract, a member changes static-ness or becomes protected | `breaking` |
| `heritage` | A base or implemented type is removed; added: `additive` | `breaking` |

Not reproduced: structural comparison between two different object types,
generic instantiation, conditional/mapped/template-literal types, and overload
resolution beyond pairwise matching. Those all report `unknown`.

## Rust: the Cargo SemVer reference

cargo-semver-checks is a native two-revision tool, so Projections never installs
or invokes it. Instead, the comparator reproduces the rules from the
[Cargo SemVer reference](https://doc.rust-lang.org/cargo/reference/semver.html)
(the same specification cargo-semver-checks implements) using facts extracted
from rustdoc JSON. Rule names match the reference's section anchors.

Contract (`rust`):

<!-- prettier-ignore -->
| Fact | On | From rustdoc |
|---|---|---|
| `declaration` (`term`) | all | `module`, `struct`, `enum`, `union`, `variant`, `field`, `interface` (`trait`), `function`, `method` (`method`, `trait-method`), `associated-type`, `constant` (`constant`, `associated-const`), `variable` (`static`), `alias` (`type-alias`), `macro`, `implementation` (`impl`), `re-export`, `package` (`crate`) |
| `visibility` | all | `public`: the public API is what is `pub` and reachable |
| `nonExhaustive` | structs, enums, variants | `#[non_exhaustive]` |
| `hiddenMembers` | structs, unions, enums, variants | Has fields (or, for an enum, variants) outside the public API |
| `value` | constants, variants | The value expression; a variant's explicit discriminant |
| `type` | fields, constants, statics, aliases, impls | The type; an impl's implementing type |
| `signatures` | functions, methods | Parameter names and types, the return type, generic parameters |
| `typeParameters` | other items with generics | Bounds as `constraints` (a lifetime's outlives), a `const` parameter's `type`, the `default` |
| `abstract` | trait items | Has no default |
| `sealed`, `supertypes` | traits | Sealed (a supertrait outside the public API); the supertraits (`extends`) |
| `supertypes` | impls | The implemented trait (`implements`) |
| `constraints` | associated types | The bounds |
| `readonly` | statics | Not `static mut` |
| `source` | re-exports | The re-exported path |
| `native.shape` | structs, variants | `plain`, `tuple` or `unit` |
| `native.repr` | structs, enums | `repr` attributes |
| `native.where` | items with generics | Where clauses |
| `native.const`, `native.async`, `native.unsafe`, `native.abi` | functions | Function header; `abi` only when not `Rust` |
| `native.unsafe`, `native.dynCompatible` | traits | Unsafe to implement; usable as `dyn Trait` |
| `native.synthetic` | impls | An auto trait impl |

<!-- prettier-ignore -->
| Rule | Change | Level |
|---|---|---|
| `item-remove` | A public item, field, variant, method or trait impl is removed (including a lost auto trait such as `Send`) | `breaking` |
| `enum-fields-new` | A field is added to a variant of an exhaustive enum | `breaking` |
| `enum-variant-new` | A variant is added to an exhaustive enum | `breaking` |
| `struct-add-public-field-when-no-private` | A public field is added to an exhaustive struct with no private fields | `breaking` |
| `struct-add-private-field-when-public` | A struct with only public fields gains a private one | `breaking` |
| `trait-new-item-no-default` | An item without a default is added to an unsealed trait | `breaking` |
| `trait-new-default-item` | An item with a default is added to a trait | `additive` |
| `attr-adding-non-exhaustive` | `#[non_exhaustive]` is added | `breaking` |
| `fn-change-arity` | A function's parameter count changes | `breaking` |
| `parameter-renamed` | A parameter is renamed: Rust has no named arguments | `compatible` |
| `fn-safe-unsafe` | A function becomes `unsafe`; the reverse (`fn-unsafe-safe`) is `compatible` | `breaking` |
| `trait-item-default-removed` | A trait item loses its default | `breaking` |
| `trait-object-safety` | A trait stops being usable as `dyn Trait` | `breaking`; becoming usable as one: `additive` |
| `repr-*` | A `repr` changes | `breaking` |
| `const-fn-removed` | A `const fn` loses `const` | `breaking` |
| `type-changed` | A field, constant or static type, a parameter or return type changes without generics | `breaking`; with generics: `unknown` (`fn-generalize-compatible` and its relatives can't be decided from text) |
| `constant-value` | A constant's value changes: it compiles unless used in a type, such as an array length | `unknown` |
| `generic-new-default` | A generic parameter is added to a type with a default | `compatible`; without one (`generic-new-no-default`): `breaking` |
| `fn-generic-new` | A generic parameter is added to a function | `unknown`: the Cargo reference calls it possibly breaking (callers that name the parameters fail) |
| `item-new` | Any other public item is added | `additive` |

Not reproduced: tightening or loosening generic bounds (reported as `unknown`),
type layout beyond `repr`, and Cargo features.

## Go: apidiff's rules

Because apidiff compares two package export data sets natively, a comparator
can't invoke it. The Go extractor's helper relies strictly on the standard
library's `go/types` (never downloading `golang.org/x/exp`), and the comparator
reproduces apidiff's documented rules
([README](https://github.com/golang/exp/blob/master/apidiff/README.md)), which
follow the Go 1 compatibility guarantee.

Contract (`go`):

<!-- prettier-ignore -->
| Fact | On | From `go/types` |
|---|---|---|
| `declaration` (`term`) | all | `constant` (`const`), `variable` (`var`), `function` (`func`), `method`, `field`, `package`; types (`type`): `struct`, `interface`, `alias`, or `type` for other defined types |
| `visibility` | all | `public`: the API is what is exported |
| `type` | consts, vars, funcs, methods, fields, aliases | The type, package-qualified relative to the module (a function's without parameter names); an alias's aliased type |
| `value` | consts | The exact constant value |
| `underlying` | defined types other than structs and interfaces | The underlying type |
| `typeParameters` | generic types | Each name and its constraint |
| `sealed` | interfaces | Has an unexported method (only embedding can implement it) |
| `abstract` | interface methods | Implementers must provide it |
| `supertypes` | types | Exported interfaces of the same package that the type (value or pointer) implements (`implements`) |
| `native.underlying` | defined types other than structs and interfaces | The underlying kind (`int64`, `chan`, `slice`, …) |
| `native.numeric`, `native.channel` | numeric and channel types | `{family, size32, size64}`; `{dir, elem}` |
| `native.comparable` | types | Values can be compared with `==` |
| `native.receiver` | methods | `value` (in both method sets) or `pointer` (pointer method set only) |
| `native.promoted`, `native.embedded` | methods, fields | Selectable through an embedded field; an embedded field |

<!-- prettier-ignore -->
| Rule | Change | Level |
|---|---|---|
| `removed` | An exported name, method or selectable field is removed | `breaking` |
| `kind` | A name denotes a different kind of object (a function may become a variable) | `breaking` |
| `type` | A const, var, func, method or field type changes | `breaking` |
| `value` | A constant's value changes | `breaking` |
| `interface-method-added` | A method is added to an interface without an unexported method | `breaking`; with one: `additive` |
| `method-set` | A method moves from the value to the pointer method set | `breaking`; the reverse: `additive` |
| `comparable` | A struct stops being comparable | `breaking` |
| `numeric` | A numeric type changes family or shrinks | `breaking`; grows within its family: `compatible` |
| `channel` | A channel loses its element type or gains a direction | `breaking`; loses a direction: `compatible` |
| `underlying` | Another underlying type change | `breaking` |
| `implements` | A type stops implementing an exported interface | `breaking` |
| `added` | An exported name, field or method is added | `additive` |

Not reproduced: tracking renamed unexported types (apidiff accepts `var V u1`
becoming `var V u2`, while the comparator reports a type change) and
module-level comparisons when packages are renamed relative to the module root.
Packages under `internal/` and `main` packages aren't importable, so they aren't
part of the API.

## Renderer

When `metadata.compatibility` is present, the `api` renderer surfaces it in four
ways:

- **Summary bar:** shows each nonzero level with its glyph and label, breaking
  first (`⚠ 2 breaking changes · ⊕ 5 additive changes · = 1 compatible change`).
  Clicking a count filters to those changes, hovering shows the rules that
  fired, and any top-level notices appear above the declarations.
- **Row badges and reasons:** each changed declaration's footer displays
  `⚠ Breaking`, `⊕ Additive`, `= Compatible`, or `? Unknown` after its change
  status, with the reason in its tooltip and (in diff view) on a dedicated line
  beneath the signature. Levels fade alongside change emphasis without adding
  extra diff colors.
- **Ordering:** breaking declarations sort to the top of the diff, followed by
  the rest in ID order.
- **Filtering:** a **Breaking only** toggle narrows the list to breaking
  changes.

When no classification is present (such as with the default comparator), the
renderer renders ordinary rows with no extra chrome.

## Testing

- Each ecosystem's comparator rules are unit-tested on small before/after
  declarations across both comparator runtimes.
- Every extractor's native test runs the real toolchain on a before/after
  project and asserts the comparator's classification on every change; those
  same projects drive the `api` renderer's Compatibility scenarios.
- Where the official tool can run locally, native tests cross-check our results
  against it on the exact same pair:
  - cargo-semver-checks (0.51.0, when installed, checked as a minor release)
    emits 7 lints, and every item it flags is classified `breaking` here.
  - apidiff (pinned in `packages/cli/tests/native_tools/go.rs`, invoked via
    `go run` when `PROJECTIONS_APIDIFF=1` is set) flags the exact same 8
    `breaking` changes as incompatible and the other 4 as compatible.
  - ApiCompat (`Microsoft.DotNet.ApiCompat.Tool` 10.0.403, installed to a
    scratch tool path when `PROJECTIONS_APICOMPAT=1` is set, with the two opt-in
    rules enabled) matches every `breaking` classification except two: a
    constant's value (which is outside ApiCompat's scope) and an enum member's
    value (CP0011, which is documented but not emitted by this version).
