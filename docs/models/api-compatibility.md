# API compatibility

Status: **adopted** for `api/v0`. Implemented by the
[`api-compatibility` comparator](../../packages/comparators/api-compatibility),
the `contract` facts the `dotnet-public-api`, `typescript-public-api`,
`rust-public-api`, `go-public-api` and `swift-public-api` extractors write
(Swift's own rules aren't modeled yet; its changes get the rules every ecosystem
shares), and the [`api` renderer](../../packages/renderers/api).

A reviewer looking at an API projection wants one answer before any other:
**does this change break the people who use the API?** This document decides
where that answer is computed, what it may say, and how honest it is about what
it can't know.

## The answer: a classification per change

Every changed declaration gets one **compatibility level**:

<!-- prettier-ignore -->
| Level | Meaning | Typical version bump |
|---|---|---|
| `breaking` | Some valid consumer stops compiling, linking or running correctly against the new revision | Major |
| `additive` | New surface that consumers can opt into; nothing that worked stops working | Minor |
| `compatible` | A change that neither breaks consumers nor adds surface (a narrowed return type, a nullability annotation) | Patch |
| `unknown` | The rules can't decide; a person has to look | — |

A breaking classification names **how** it breaks when that is meaningful:
`binary` (code compiled against the old revision fails against the new one
without recompiling) and `source` (code fails to compile, or compiles with a
different meaning). Only .NET has a binary compatibility boundary that differs
from its source boundary; TypeScript, Rust and Go consumers are always
recompiled from source, so their breaks carry no sub-kind.

Every classification carries a short **reason** in plain language ("Return type
changed from `string` to `int`"), and names the **rule** that produced it: an
official diagnostic ID (`CP0002`), a section of an official compatibility
reference (`enum-variant-new`) or, where no official name exists, our own
(`required-parameter-added`).

## Where it is computed

### The official tools need both revisions at once

Each ecosystem has an official or de facto compatibility checker:

<!-- prettier-ignore -->
| Ecosystem | Tool | What it compares |
|---|---|---|
| .NET | ApiCompat (`Microsoft.DotNet.ApiCompat`, SDK package validation) | Two assemblies |
| TypeScript | None official. `checker.isTypeAssignableTo` answers assignability, but only for two types in **one** program; API Extractor reports exist without a standard for what breaks | — |
| Rust | cargo-semver-checks, implementing the [Cargo SemVer reference](https://doc.rust-lang.org/cargo/reference/semver.html) | Two rustdoc JSON documents |
| Go | `golang.org/x/exp/apidiff`, the Go team's tool | Two package export data sets |

Every one of them is a **two-revision** program that runs natively. Projections
deliberately has no place for such a program:

- **Extractors** see exactly one revision. That is what makes an extraction
  deterministic, cacheable and reusable in any pairing: users pick the pair
  while viewing (base and head, or the two most recent pushes), so the number of
  pairs grows quadratically and can't be precomputed.
- **Comparators** see both extractions, but are rules the engine interprets in a
  sandbox, with no files, processes or network. They can't invoke `dotnet`,
  `cargo` or `go`.

Running the tools would need a third component kind, a native, trusted,
two-revision step computed ahead of time for a fixed pair. That contradicts
viewing-time comparison and can't be verified by rerunning, so it was rejected.

### The decision: compiler facts per revision, official rules per comparison

Classification is a **comparison-level** fact, so it belongs to a comparator.
The work splits along the existing boundary:

```
  revision ──▶ extractor (the ecosystem's own compiler) ──▶ declarations + contract facts ─┐
                                                                                           ├─▶ api-compatibility comparator ──▶ comparison + classification
  revision ──▶ extractor (the ecosystem's own compiler) ──▶ declarations + contract facts ─┘
```

1. **Extractors stay per-revision and deterministic.** Each `*-public-api`
   extractor already asks the ecosystem's own compiler (Roslyn, the repository's
   `tsc`, rustdoc, `go/types`) what the public API is. It now also writes each
   declaration's **contract**: the facts the official tool's rules inspect, such
   as accessibility, `virtual`, the full base-type chain, parameter names,
   whether an interface member has a default implementation, whether a Rust enum
   is `#[non_exhaustive]`, a Go struct's comparability or an interface's
   unexported methods. These are facts about one revision, read from the
   compiler, not inferred from text.
2. **The comparator reproduces the official rules** over two revisions'
   contracts. `api-compatibility` is an ordinary comparator file,
   [`api-compatibility.comparator.yaml`](../../packages/comparators/api-compatibility/api-compatibility.comparator.yaml),
   loaded exactly like a third party's; it has no privileges. It starts from the
   default baseline (so correspondence and order are unchanged) and adds the
   classification.

Why not per-declaration **fingerprints** (hashes of the binary-relevant and
source-relevant shape) instead of facts? A hash says _that_ something changed,
never _whether the change is safe_: adding an optional parameter and removing a
required one change the same hash. The comparator needs the facts.

Why not have extractors embed the tool's per-revision input (a reference
assembly, rustdoc JSON, apidiff export data) as extraction metadata? The
comparator still couldn't run the tool over it, the inputs are large, and the
rules would still have to be reimplemented.

What this costs, honestly:

- The rules are **reproduced, not invoked**. Each ecosystem section below lists
  exactly which official rules are reproduced and which are not. Where a change
  falls outside them, the answer is `unknown`, never a guess.
- **Hosted views** classify too: they run the comparator file from the pull
  request's base in the sandboxed rules interpreter, so a pull request can't
  change how it is judged.
- A user can still run the official tool in CI beside Projections; nothing here
  replaces it as a release gate.

## Model (`api/v0`)

### Declaration contract

An `api/v0` entity may carry `data.contract`, an object of facts about the
declaration. It is part of the entity's content: a contract change makes the
declaration `modified` even when its displayed signature is unchanged, because
the API did change (a base class gained a base, an interface lost its only
unexported method). Extractors write only facts their compiler reports.

The facts describe declarations, not languages: one model every ecosystem fills,
defined in the [schema reference](../reference/schemas/api.md#contract) and
checked by the Engine (a fact of the wrong type, or an unknown one, fails at its
path). Each contract names its kind of declaration twice: `declaration`, one of
the kinds every ecosystem shares (`class`, `interface`, `function`, `method`,
`property`, `field`, `variant`, `constant` and so on), and `term`, the
ecosystem's own word for it (Rust's `trait-method`, Go's `func`, .NET's
`record class`); a change of `term` is a change of kind. The other shared facts:

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

A type where values flow (`type`, a parameter's, `returns`) is `{text, union?}`:
the language's text, and, when the extractor resolves them, its union
constituents. Facts only one ecosystem's rules read are in `native`, an open
object documented with each extractor below; no other ecosystem's rules read it.
Booleans that are false and lists that are empty are left out.

The extraction's `metadata.ecosystem` names the rule set: `dotnet`,
`typescript`, `rust` or `go`. Without it (or without contracts) the comparator
applies only the rules every ecosystem shares and says so. A missing fact makes
the rules that need it answer `unknown`. How each ecosystem fills the contract
is documented below.

### Comparison metadata

The comparator returns the baseline comparison with:

- each entity change's `summary` set to its classification as one sentence, so
  hosts' table and text views state it without the renderer;
- `metadata.compatibility`:

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

`changes` is keyed by comparison change ID and covers every entity change.
Relationship changes aren't classified: `contains` relationships only mirror
declarations. A change's `level` is its most severe finding (`breaking`, then
`unknown`, `additive`, `compatible`); `kinds` is the union of its breaking
findings' kinds; `reason` joins the most severe findings' reasons. `notices`
holds at most 20 sentences about the classification as a whole (missing
contracts, an unknown ecosystem).

### Rules every ecosystem shares

<!-- prettier-ignore -->
| Change | Level | Rule |
|---|---|---|
| A declaration is removed | `breaking` (.NET: binary and source) | `removed` |
| A declaration is renamed or moved (`declared`, `split` or `merge` correspondence) | `breaking`; code naming the old identity fails | `renamed` |
| A declaration is added | `additive`, unless an ecosystem rule below says adding it breaks | `added` |
| A declaration changes and no rule explains it | `unknown` | `unclassified` |

## .NET: ApiCompat's default mode, reproduced

ApiCompat isn't invoked: it needs both assemblies, and nothing in the comparator
can run it. The comparator reproduces the rules of the SDK's
`Microsoft.DotNet.ApiCompatibility` (the engine behind package validation and
`Microsoft.DotNet.ApiCompat.Tool`) in their **default, non-strict mode with its
two opt-in rules enabled** (`ApiCompatEnableRuleCannotChangeParameterName` and
`ApiCompatEnableRuleAttributesMustMatch`), because renamed parameters break
named arguments and attributes change behavior. The facts come from Roslyn after
replaying the project's own build. Rule IDs are the
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

Nullable reference annotations are kept in `data.signature` but left out of
types and parameters: changing them produces warnings, not errors, and ApiCompat
ignores them too.

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

Beyond ApiCompat (from the
[.NET breaking change rules](https://github.com/dotnet/runtime/blob/main/docs/coding-guidelines/breaking-change-rules.md)),
with the rule name in parentheses:

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
aren't API declarations; members moved to a base class (ApiCompat accepts them,
the comparator reports removal); and comparisons across target frameworks.

## TypeScript: assignability over the checker's types

TypeScript has no official breaking-change standard. The rigorous question is
assignability (`checker.isTypeAssignableTo`), but the checker answers it only
for two types in one program, and an extractor sees one revision. So the
extractor records each declaration's types **as the repository's own checker
resolves them**: every parameter and return type as its union constituents, each
with the primitive a literal widens to. The comparator then decides
assignability over those constituents and answers `unknown` whenever the
question needs more than that (two different object types, generics, conditional
or mapped types).

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

Every type is `{text, union: [{text, primitive?}]}`: the checker's canonical
text, and its union constituents (one when it isn't a union), where a literal
constituent names the primitive it widens to.

`S ⊑ T` (a value of type `S` is assignable to `T`) holds when the texts are
equal, `T` contains `any` or `unknown`, `S` is `never`, or every constituent of
`S` equals a constituent of `T` or is a literal of a primitive in `T`. It fails
**provably** when a constituent of `S` is a primitive or literal and every
constituent of `T` is too, with none accepting it. Otherwise it is undecided.

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

Not reproduced: structural comparison of two different object types, generic
instantiation, conditional, mapped and template literal types, and overload
resolution beyond pairwise matching. These are `unknown`.

## Rust: the Cargo SemVer reference

cargo-semver-checks isn't invoked: it is a native two-revision tool, so it can't
run in a comparator, and Projections never installs or bundles it. The
comparator reproduces the rules of the
[Cargo SemVer reference](https://doc.rust-lang.org/cargo/reference/semver.html),
which cargo-semver-checks' lints implement, over facts from rustdoc's JSON
output. Rules are named by the reference's section anchors.

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

Not reproduced: generic bound tightening and loosening (`unknown` when bounds
change), type layout beyond `repr`, and Cargo features.

## Go: apidiff's rules

apidiff isn't invoked: it compares two package export data sets, and a
comparator can't run Go. The extractor's helper uses only the standard library's
`go/types` (so it never downloads `golang.org/x/exp`) and the comparator
reproduces apidiff's documented rules
([README](https://github.com/golang/exp/blob/master/apidiff/README.md)), which
are based on the Go 1 compatibility guarantee.

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

Not reproduced: correspondence of renamed unexported types (apidiff accepts
`var V u1` becoming `var V u2`; the comparator reports a type change), and
module-level comparison of packages renamed relative to the module root.
Packages under `internal/` and `main` packages aren't importable, so they aren't
API.

## Renderer

The `api` renderer reads `metadata.compatibility` when present:

- facts in the host's summary bar
  (`⚠ 2 breaking changes · ⊕ 5 additive changes · = 1 compatible change`), every
  nonzero level with its glyph and words, breaking first, each filtering to its
  changes, with the rules that classified them as its tooltip; the
  classification's notices stay above the declarations;
- a breaking declaration's reserved footer reads `⚠ Breaking` after its change
  status, with the reason as its tooltip and, in the diff, in a reserved line
  under the signature; additive, compatible and unknown changes read
  `⊕ Additive`, `= Compatible` and `? Unknown` the same way. Levels fade with
  change emphasis, like change status, and use no change color;
- breaking declarations sort first in the diff, then the rest in ID order;
- a **Breaking only** control filters the list to breaking changes.

Without a classification (the default comparator), the renderer shows nothing
extra and its rows are unchanged.

## Testing

- The comparator's rules are unit tested per ecosystem with small before and
  after declarations, and through both comparator runtimes.
- Each extractor's native test extracts a real before and after project with the
  real toolchain and checks the comparator's classification of every change; the
  same projects are the api renderer's Compatibility scenarios.
- Where the official tool can run, the native tests also run it on the same
  pair:
  - cargo-semver-checks (0.51.0, when installed; checked as a minor release)
    reports 7 lints, and every item it names is `breaking` here;
  - apidiff (pinned in `packages/cli/tests/native_tools/go.rs`, downloaded by
    `go run` only with `PROJECTIONS_APIDIFF=1`) reports exactly the 8 changes
    classified `breaking` as incompatible and exactly the other 4 as compatible.
  - ApiCompat (`Microsoft.DotNet.ApiCompat.Tool` 10.0.403, installed into a
    scratch tool path only with `PROJECTIONS_APICOMPAT=1`, with the two opt-in
    rules) reports exactly the changes classified `breaking`, except two: a
    constant's value, which is beyond ApiCompat, and an enum member's value
    (CP0011), which is documented but which this version doesn't report.
