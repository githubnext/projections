# Custom comparators

> **Current state:** comparator files are the only custom comparators:
> rules-only, interpreted by the engine on clients and servers. The JavaScript
> and WebAssembly comparator modules are removed; sections that compare against
> them are marked historical.

Status: **the only custom comparator kind** (productionized from the
[feasibility study](#history); the JavaScript and WebAssembly comparator kinds
were removed; the format was renamed from "comparator rules", `*.rules.yaml`, to
comparator files, `*.comparator.yaml`, before release). Declarative comparators
are the only way to customize comparison because comparators must run in
production contexts, on clients and servers that show pull requests, where a
program from a repository can't. Rules are data an interpreter runs in a
sandbox; programs from a repository are not.

A comparator turns two extractions into the one comparison every mode draws:
which items correspond, what each change is, how it is classified and in which
order the changes play. The default comparator does this natively. A **custom
comparator** is a **comparator file**, `<name>.comparator.yaml`, that layers
declarations over it: identity passes that pair what the default matching leaves
unmatched, comparator rules (CEL predicates) that classify and summarize
changes, declarative step operations, and metadata. A definition names one by
its path, alone or with options:

```json
"comparator": ".github/projections/api.comparator.yaml"
"comparator": {"file": ".github/projections/api.comparator.yaml", "options": {}}
```

A string or an object with `file` is a custom comparator; an object without
`file` (`{}` or `{"options": ...}`) is the default comparator. The former
`{"rules": ...}` key, and paths that don't end in `.comparator.yaml` or
`.comparator.yml`, are refused with how to migrate. The interpreter keeps its
internal names (the `packages/comparators/rules` crates, `rules.wasm`): it
interprets the rules a comparator file declares.

The implementation is
[`packages/comparators/rules`](../../packages/comparators/rules): the
interpreter (Rust, [`cel`](https://crates.io/crates/cel) and
[`yaml-rust2`](https://crates.io/crates/yaml-rust2)), the
[JSON Schema](../../packages/schemas/schemas/comparator/v0.json) for comparator
files (published at `/schemas/comparator/v0.json`), and its tests. It builds to
`rules.wasm`, a zero-import WebAssembly module that every host runs in its
sandbox.

- [The format](#the-format)
- [Variables](#variables)
- [Functions](#functions)
- [The standard library](#the-standard-library)
- [Types and load-time checking](#types-and-load-time-checking)
- [Step operations](#step-operations)
- [YAML, the subset](#yaml-the-subset)
- [The comparator's digest](#the-comparators-digest)
- [Testing comparators](#testing-comparators)
- [Editing comparator files](#editing-comparator-files)
- [The core and the comparator](#the-core-and-the-comparator)
- [Reference definitions](#reference-definitions)
- [Verdicts per comparator](#verdicts-per-comparator)
- [Equivalence](#equivalence)
- [Determinism, termination and cost](#determinism-termination-and-cost)
- [Performance: safety over speed](#performance-safety-over-speed)
- [The CEL and YAML implementations](#the-cel-and-yaml-implementations)
- [Comparator files only](#comparator-files-only)
- [Running comparators in a hosted view](#running-comparators-in-a-hosted-view)
- [History](#history)

## The format

A comparator file is YAML. Expressions are
[CEL](https://github.com/google/cel-spec), the Common Expression Language used
by Kubernetes admission policies and Google Cloud IAM conditions: a small,
side-effect-free, non-Turing-complete expression language with C-like syntax.
This is the moved components comparator in full:

```yaml
# yaml-language-server: $schema=https://schemas.projections.githubnext.com/comparator/v0.json
format: projections.comparator
version: 0
description: >-
  Pairs each removed entity with the added entity of the same kind and label, when exactly
  one of each exists, as one component that moved; relationships whose kind and endpoints
  match once moved endpoints are mapped pair the same way. The moves form one step between
  the removals and the additions.

identity:
  - name: moved
    description: Unmatched entities with the same kind and label.
    collections: [entities]
    key: '[item.kind, item.label]'
  - name: links
    collections: [relationships]
    when: has(pairs.moved)
    key: '[item.kind, moved(pairs.moved, item.from), moved(pairs.moved, item.to)]'

functions:
  moved:
    description: An entity's ID after the moves.
    params:
      - {name: moves, type: 'map<string, string>'}
      - {name: id, type: string}
    returns: string
    body: 'id in moves ? moves[id] : id'

classify:
  where: origin == 'moved'
  summary: "'`%s` moved from `%s` to `%s`.'.format([afterItem.label, beforeItem.id, afterItem.id])"

steps:
  add:
    - changes: origin in ['moved', 'links']
      kind: restructure
      place: before:add
      sort: '[change.collection, change.before[0]]'
      summary: |-
        size(members.filter(m, m.collection == 'entities')) == 1
          ? 'Move `%s`'.format([graph.entity('after', members[0].after[0]).label])
          : 'Move %d components'.format([size(members.filter(m, m.collection == 'entities'))])
```

The sections, in the order they are evaluated:

<!-- prettier-ignore -->
| Section | What it holds | Evaluated |
|---|---|---|
| `defaults` | Option values merged under the comparison's `options` ([defaults](#defaults)) | before anything |
| `checks` | `{assert, message, code?, path?}`; the first failing assertion fails the comparison (`invalid-options` at `/options` by default) | once |
| `variables` | `[{name, expression}]`, read as `variables.<name>` | once, in order |
| `functions` | Typed, named, parameterised expressions with their own `variables` | when called |
| `identity` | Ordered passes over what the default matching left unmatched: `key` (items whose key is unique on both sides correspond) or `claims` (IDs an item claims on the other side; each connected group is one change), with an optional `when` | per unmatched item |
| `classify` | Per change: `where`, `variables`, `summary` (a string) and `annotation` (any JSON value, readable afterwards as `annotations[id]`) | per selected change |
| `context` | Named rules: `name`, `description`, `where`, `variables`, and `before` and `after`, each a `list<string>` of item IDs added to the change's [context](#context-rules) | per selected change, after `classify` |
| `steps` | Declarative [step operations](#step-operations) with `variables`, or `value`, one CEL expression for the whole list | once |
| `metadata` | `values`, comparison metadata keys merged over the baseline's, with `variables` | once |

The default comparator always runs first: its matching (exact IDs, then declared
`previousIds`) is the first two identity passes (named `exact` and `claims`,
reserved), and its comparison, with the default order, is `baseline`.
Expressions see `before` and `after` (the normalised extractions), `options`,
`baseline` and `lookup`, an index built once (`lookup.before.entities[id]`,
`relationships[id]`, and `incoming[id]` and `outgoing[id]`, an entity's
relationships in extraction order; likewise for `after`). Sections add their
own: `item`, `side` and `pairs` (each pass's one-to-one pairs, before ID to
after ID) in identity passes; `change`, `origin` (the pass that matched it),
`befores`, `afters`, `beforeItem` and `afterItem` in `classify`, with `item` for
whichever exists (the after item, or the before item of a removal); and
`changes`, `pairs`, `changeOf` and `annotations` afterwards. Every entity and
relationship the rules see carries `data` as a map, `{}` when the extraction
omitted it, so `item.data.mode` needs no guard; `has(item.data.mode)` or
`item.data.?mode` still tests an optional field. Inputs are built lazily: a file
that never reads `lookup` doesn't pay for it.

A `Change` carries `varied`, the
[volatile](../contracts/extractions.md#volatile-data) values that differ between
its items: a `list<Varied>` of `{path, within, reason}` (`reason` only when a
spread bound couldn't apply), and always a list, `[]` when nothing varied, so
`change.varied.exists(v, !v.within)` needs no guard (in `changes`, `members`,
`lead` and `baseline.changes` alike). Changes that are only expected variation
(an `exact` pair `unchanged` with `varied`) are listed in `changes`, but
`classify` doesn't run on them and step operations (`add`, `rank`, step
summaries) never see them; a file that wants the noise reads it from `changes`,
as in
[`test-timings`](../../examples/comparators/test-timings/test-timings.comparator.yaml):
`changes.filter(c, c.status == 'unchanged' && size(c.varied) > 0)`. A `steps`
expression (`steps: <expression>` or `value`) builds every step itself, so it
must leave them out; the Engine rejects one in a step (`variation-in-step`). The
core, not the rules, judges variation, so no file can call more or less of it
expected. No library function was added for it: `change.varied` is what a rule
needs.

A [generated value](generated-values.md)'s entry has `generated: true` and
`because`, the basis parts that moved; both fields are on every `Varied`
(`false` and `[]` otherwise), so they need no guard. `generated.because(change)`
gathers the parts across a change, and `generated.only(change, parts)` says
whether a change differs only in generated values whose bases moved only in
`parts`, which needs the core's comparison of the rest of the items. Rules use
them to classify and order, never to change a status: a model upgrade stays
`modified` (see
[`model-upgrades`](../../examples/comparators/model-upgrades/model-upgrades.comparator.yaml)).

## Context rules

A change's **context** is what a person needs to read it: the declaration a
changed parameter belongs to, the table a changed column is in, the two services
a new dependency connects. A viewer's Changes scope shows the changes and their
context, and folds the rest. The core gives every change whose status or
identity changed its structural context: a changed relationship's endpoints, and
the items containing a changed or context entity, with the containment
relationships that place them, in each revision
([Comparisons](../contracts/comparisons.md)). `context` rules add to it, never
remove from it, and nothing they say hides a change:

```yaml
context:
  - name: callers
    description: The tools that call a changed function, so a reviewer sees who is affected.
    where: change.collection == 'entities' && item.kind == 'function'
    after: |-
      change.after.size() == 1 && change.after[0] in lookup.after.incoming
        ? lookup.after.incoming[change.after[0]].filter(r, r.kind == 'calls').map(r, r.from)
        : []
```

Each rule runs, in order, on every change whose status or identity changed (not
on expected variation), after `classify`, and sees what `classify` sees
(`change`, `origin`, `item`, `beforeItem`, `afterItem`, `befores`, `afters`,
`changes`, `pairs`, `changeOf`), `annotations` and the change's `annotation`.
`where` selects the changes; `variables` are evaluated per change; `before` and
`after` each return a `list<string>` of IDs of that revision's entities or
relationships (a removal's context is in `before`), at least one of them given.
An ID that isn't an item of that revision fails the comparison
(`invalid-context`, with the rule's line); the change's own items are left out.
The comparison records each change's context in UTF-16 order, with the names of
the rules that added an ID (`context.rules`), so viewers and agents can say why
an item is shown. A change has at most 1,000 context IDs per revision
(`context-limit`). Comparator tests assert a change's context with
`changes: [{id, context: {before?, after?, rules?}}]`.

## Variables

Variables have the shape of Kubernetes `ValidatingAdmissionPolicy`'s:
`variables: [{name, expression}]`, evaluated once and in order, each able to
read the earlier ones, and read as `variables.<name>`, so a reader can tell a
variable from an input or a function. They are available at file level (once per
comparison), in `classify` (once per change), in `steps` and `metadata`, and in
every function (once per call). They replace the study's `let` maps, and they
are the main tool against accidental quadratic cost: a value used twice is
computed once.

Before, in the study's API rules:

```yaml
body: |-
  parentOf(before) != null && counterpart(parentOf(before)) == null
  && kindOf(parentOf(before)) != 'assembly' ? breaking('removed', code(labelOf(before))
    + ' was removed with ' + code(labelOf(parentOf(before))))
  : breaking('removed', code(labelOf(before)) + ' was removed')
```

After:

```yaml
variables:
  - name: parent
    expression: parentOf(before)
body: |-
  variables.parent != null && counterpart(variables.parent) == null && kindOf(variables.parent) != 'assembly'
    ? breaking('removed', '%s was removed with %s'.format([prose.code(labelOf(before)), prose.code(labelOf(variables.parent))]))
    : breaking('removed', '%s was removed'.format([prose.code(labelOf(before))]))
```

## Functions

CEL has no user-defined functions. `functions` are named, parameterised CEL
expressions, author space for domain logic (`covers`, `typescriptAssignable`):

```yaml
functions:
  policyFound:
    params: [{name: id, type: string}, {name: before, type: Item}, {name: after, type: Item}]
    returns: list<string>
    variables:
      - name: from
        expression: entity('before', graph.children('before', id, 'applies-to'))
    body: ...
```

`params` are names, or `{name, type}` with a declared type the checker uses at
call sites and inside the body; `returns` declares the result. A body sees its
parameters, its own variables, the inputs and the other functions, never its
caller's variables. The call graph must be acyclic, checked when the file loads,
so a function is a macro the engine expands lazily: every program it can express
is a pure CEL program, possibly a larger one.

A name that is also a library namespace (`ids`, `graph`) can't be a parameter or
a variable, because it would shadow the library's calls.

## Defaults

A body never sees the file's `variables`, so values several functions share,
such as the lists a definition may override, go in `defaults`: a map of option
names to values (any JSON), merged under the comparison's `options`. Every
expression, functions included, reads them as `options.<name>`, and an option
the definition sets replaces its default key by key:

```yaml
defaults:
  impure: [filesystem, process, network]
functions:
  impure:
    params: [{name: capability, type: string}]
    returns: bool
    body: capability in options.impure
```

Defaults are literals, part of the file and so of its digest; a value computed
from other options is a file-level variable.

## Macros

CEL's own macros are `has`, `all`, `exists`, `exists_one`, `map` and `filter`.
Rules add four, for what chains of `? :` and list surgery otherwise spell out.
Like CEL's, they are rewrites of the parsed expression, done when the file loads
([`macros/`](../../packages/comparators/rules/src/macros)), never text
substitution, so diagnostics point at what the author wrote. Each expands to
plain CEL: only the branch it chooses is evaluated, so a branch may read a field
that is absent on other changes, and the cost meter charges exactly what the
expansion costs. CEL's grammar has no `=>`, so conditions are the keys of a map
literal, which keeps its written order.

<!-- prettier-ignore -->
| Macro | For | Expands to |
|---|---|---|
| `match(subject, {'key': value, …}, default)` | A table keyed by one value | `subject == 'key' ? value : … : default` |
| `cond({condition: value, …}, default)` | Ordered conditions: the first that holds wins | `condition ? value : … : default` |
| `collect({condition: value, …})` | The values whose conditions hold, in order | `(condition ? [value] : []) + …` |
| `template('… {name} …', {'name': value, …})` | Text with named fields; without the map, `{name}` is the function parameter `name`, or else `variables.name` | `'… %s …'.format([value, …])` |

Load-time checks, each with the YAML line and column:

- `match` keys are string or int literals, each once;
- every branch of a `match` or `cond`, and its default, has one type;
- a template's fields and its map's keys are the same names; `{{` and `}}` are
  literal braces;
- a function can't take a macro's name.

A variable or a function parameter can declare its domain,
`values: [newly-enforced, enforcement-removed, …]`. A `match` on it then warns
about keys outside the domain and about values it leaves to the default.

Before, in runtime-policy's `sentence` (20 branches):

```yaml
body: |-
  found == 'newly-enforced' ? '%s now enforces: %s%s.'.format([rule, actions(after), variables.when])
  : found == 'enforcement-removed' ? '%s no longer enforces (was %s).'.format([rule, actions(before)])
  : found == 'scope-broadened' ? 'Policy %s now applies to more workloads: %s.'.format([name, after.?data.?scope.orValue('unknown')])
  : …
  : ''
```

After:

```yaml
body: |-
  match(found, {
    'newly-enforced': template('{rule} now enforces: {actions}{when}.', {'rule': rule, 'actions': actions(after), 'when': variables.when}),
    'enforcement-removed': template('{rule} no longer enforces (was {actions}).', {'rule': rule, 'actions': actions(before)}),
    'scope-broadened': template('Policy {name} now applies to more workloads: {scope}.', {'name': name, 'scope': after.data.?scope.orValue('unknown')}),
    …
  }, '')
```

And `collect` replaces the placeholder-then-filter pattern:

```yaml
# Before
(!enforcing(before) && enforcing(after) ? ['newly-enforced'] : [])
  + (datum(before, 'conditions') != datum(after, 'conditions') ? ['condition-changed'] : [])
# After
collect({
  !enforcing(before) && enforcing(after): 'newly-enforced',
  differs(before, after, 'conditions'): 'condition-changed'
})
```

### Chained conditionals are a smell

A chain of three or more `? :` (through either branch) is a lint warning,
`chained-conditional`, suggesting `match`, `cond`, `collect` or a named
function. A comparator file with warnings still loads and runs, and the
interpreter reports them beside its digest (`warnings` in a host's `check`);
`npm run check:comparators` fails on any warning in the repository's comparator
files and documentation examples. The choice, in order:

1. `match` when the chain compares one value with constants;
2. `collect` when it builds a list of what holds;
3. a named function when its conditions are a domain concept (`covers`,
   `implied`) whose steps deserve names;
4. guaranteed `data`, `item` and optional access (`x.?f.orValue(d)`) when the
   chain only guards against nulls;
5. `cond` for a genuine if/else-if chain over different conditions.

## The standard library

What belongs in the engine rather than in author space is anything (a) generic
across domains, (b) needed by more than one comparator and (c) inexpressible in
CEL or expressible only as list surgery. Each function is registered with a
declared signature, a cost class and documentation
([`library/`](../../packages/comparators/rules/src/library)); the checker checks
calls against the signatures.

<!-- prettier-ignore -->
| Function | Signature | Why it's in the engine |
|---|---|---|
| `json(value)` | `dyn -> string` | Serialising a value of unbounded depth needs recursion; CEL's `string()` takes only scalars |
| `ids.sort(ids)` | `list<string> -> list<string>` | IDs sort by UTF-16 code units everywhere in the protocol; CEL's `sort()` uses code points |
| `ids.key(id)` | `string -> string` | The same order as a `sortBy` key |
| `lists.zip(a, b)` | `list, list -> list<list>` | Pairing parameters or overloads positionally is otherwise an index loop |
| `lists.zipLongest(a, b)` | `list, list -> list<list>` | The same, as long as the longer list, with null where one ends: an added or removed parameter |
| `lists.enumerate(items)` | `list -> list<list>` | `[index, item]` pairs, for positions in messages, otherwise `lists.range(size(xs)).map(i, …xs[i]…)` |
| `maps.fromEntries(entries)` | `list<list> -> map<string, dyn>` | **CEL can't build a map of computed size** |
| `maps.keys(map)` | `map<string, dyn> -> list<string>` | Keys in UTF-16 order; iterating a map follows hash order, which differs between runs |
| `graph.parents(side, id, kind)`, `graph.children(...)` | `string, string, string -> list<string>` | Graph navigation by relationship kind, otherwise a filter over `incoming` per call |
| `graph.entity(side, id)`, `graph.relationship(side, id)` | `string, string -> Entity`/`Relationship` | Lookup by ID without the whole `lookup` index |
| `graph.depths(nodes, edges)` | `list<string>, list<list<string>> -> map<string, int>` | **Longest-path depth is a fixed point**; comprehensions can't feed one iteration into the next |
| `graph.components(nodes, edges)` | `list<string>, list<list<string>> -> list<list<string>>` | **Connectivity is a fixed point** |
| `findings.classify(findings, levels)` | `list<Finding>, list<string> -> Classification` | "The most severe finding wins, with its kinds and distinct reasons" is generic, and was 40 lines of list surgery in the API rules |
| `prose.code(text)`, `prose.escape(text)` | `string -> string` | Every comparator that writes sentences quotes code spans in [protocol prose](../contracts.md) |
| `generated.because(change)` | `Change -> list<string>` | The basis parts that moved across a change's [generated values](generated-values.md), unique and in UTF-16 order: deduplicating and sorting is list surgery CEL can't do |
| `generated.only(change, parts)` | `Change, list<string> -> bool` | Whether a change differs only in generated values whose bases moved only in `parts`: it needs the core's content comparison modulo paths, which CEL can't express |

Three are strictly necessary (`json`, `maps.fromEntries` and the two graph fixed
points); the rest remove list surgery that more than one comparator needed.
Domain operators the brief anticipated (`selectorContains`, `semverBump`,
`typeAssignable`) don't belong in the engine: the first two are short CEL, and
the third, done properly, is a TypeScript-specific algorithm that belongs in
that ecosystem's extractor as a precomputed fact. A new operation is
[contributed to the engine](#comparator-files-only), not written by authors.

## Types and load-time checking

cel-rust 0.15 has no type checker, so the interpreter has its own
([`check/`](../../packages/comparators/rules/src/check), over
[`types.rs`](../../packages/comparators/rules/src/types.rs)), scoped to the
declared types: `Extraction`, `Entity`, `Relationship`, `Item` (either),
`Change`, `Varied`, `Step`, `Comparison`, `Lookup`, `Finding` and
`Classification`, plus CEL's scalars, `list<T>`, `map<K, V>`, `optional` and
`dyn`. Every input is declared, every section's own variables too, and function
parameters and results where the author declares them. Data (`item.data`) is
`dyn`.

When a file loads, every expression is checked, and every problem is reported at
once: unknown variables, fields, functions and namespaces (with a "did you mean"
suggestion), the wrong number of arguments, operators applied to incompatible
types, a function's declared result not matching its body, and cycles among
functions. Each diagnostic has the YAML line and column of the offending token,
computed from the scalar's position (block scalars included) and the CEL offset
within it:

```text
invalid-rules at /metadata/values/count: Line 5, column 17: Undeclared reference `chnages`; did you mean `changes`?
```

The CLI, the Inspector and the hosts get the same diagnostics, because the check
runs in the interpreter (`projections_rules_inspect`) in the sandbox.

## Step operations

Steps are declarative, so common orderings need no list manipulation:

```yaml
steps:
  variables: [...]
  add:                                # new steps, each made of the changes a predicate selects
    - changes: <per change: bool>     # `change`, `origin`, `annotation`
      kind: restructure
      place: before:add               # start, end, before:<kind>, after:<kind>
      sort: <per change: key>         # optional; default entities, then relationships, by ID
      summary: <with `members`: string or null>
  rank: <per change: number, list of numbers or null>
  descending: false
  summary: <per step, with `step`, `members` and `lead`: string or null>
```

The engine does the list work: it starts from the baseline's steps, drops the
changes the comparison no longer has, moves selected changes out of the steps
they were in, drops steps left empty, orders members by ID (UTF-16), sorts steps
stably by their best-ranked change with unranked steps after the ranked ones,
and gives `summary` the step's `lead` (its first best-ranked change). `value`,
one CEL expression returning the whole step list, remains the escape hatch; no
comparator here uses it. The priority order comparator is one expression:

```yaml
steps:
  rank: |-
    change.collection == 'entities'
      ? lists.range(size(variables.priority)).filter(i, variables.priority[i] in change.before + change.after)
      : null
```

## YAML, the subset

Rules are YAML so that expressions need no escaping, long expressions can be
block scalars (`|-`), and files can carry comments. The engine reads a
deliberately small subset, then validates the result against the schema:

- one document; block or flow mappings, sequences and scalars;
- at most 1 MiB and 32 levels of nesting;
- no anchors or aliases (no alias bombs, and every value is written where it is
  used), no tags, no merge keys (`<<`) and no duplicate keys; keys are plain
  strings;
- plain scalars resolve by YAML 1.2's core schema, narrowed: `null`, `~` and
  empty are null, `true` and `false` are booleans, decimal integers and floats
  are numbers. Everything else, including YAML 1.1's `yes`, `0x1F` and `.inf`,
  and every quoted or block scalar, is a string.

Editors validate a file through its first line,
`# yaml-language-server: $schema=https://schemas.projections.githubnext.com/comparator/v0.json`.

## The comparator's digest

A custom comparator's identity digest is `sha256:` over
`projections-rules-comparator\n`, the interpreter's identity and `\n`, followed
by the RFC 8785 canonical JSON of the **parsed** rules; not over the YAML bytes.
A comment, reflowed text, a different quoting style or key order doesn't change
it; any change of meaning, or a different interpreter, does. That is the
property a digest of behaviour needs: saved comparisons stay verifiable when
someone fixes a typo in a comment, and two files with the same meaning are the
same comparator. The YAML bytes are still part of the record: the definition
digest covers the comparator file's bytes (a custom comparator's file always
belongs to its definition). A change inside a CEL string, even whitespace, does
change the digest; normalising CEL would need a canonical CEL printer, which
isn't worth it. The Rust runtime (`rules_digest`), the interpreter (`digest`)
and the JavaScript runtime (`rulesComparatorDigest`) compute it identically, and
tests hold them to it.

The interpreter's identity is a digest of the **language**, not of
`rules.wasm`'s bytes or its source. The same source built on macOS and on Linux,
or on arm64 and x86-64, gives different bytes: Cargo hashes the host into every
crate's metadata, which reorders symbols and changes code layout, though never
behaviour. A digest of the source fixed that, but then any refactor of the
interpreter, or of the default comparator it compiles in, invalidated every
saved comparison. So the identity is the digest of the language's manifest,
[`language.json`](../../packages/comparators/rules/language.json): the format,
the macros, the standard library's signatures and cost classes, the declared
types, the cost budget and an explicit behaviour `revision`
([`language.rs`](../../packages/comparators/rules/src/language.rs)), which is
bumped when what something means changes without its signature changing. A test
holds the committed manifest to the code. The build
([`build.mjs`](../../packages/comparators/rules/scripts/build.mjs)) embeds the
digest in the module's `projections.interpreter` custom section, and hosts read
it there (`interpreter_digest`; in JavaScript,
`WebAssembly.Module.customSections`).

A behaviour change that isn't bumped can't make a wrong comparison verify:
verifying reruns the rules and requires the same comparison, so the saved
comparison fails verification instead. The section is trusted because the
interpreter is: hosts run only the `rules.wasm` they ship, never one from a
repository or an artifact.

## Testing comparators

Comparator files are tested by data too: a file beside each,
`X.comparator.test.yaml` for `X.comparator.yaml`, whose cases give two
extractions (fixture files, inline, or revisions) and state the comparison the
comparator must produce, partially (step order, steps, changes, counts,
metadata, or the error the comparator must fail with) or whole, as a snapshot.
`projections check` runs them in the same sandbox as every other host and fails
CI when one fails; consumers need neither npm nor Rust.
[The contracts](../contracts/comparisons.md#comparator-tests) define the format
and its semantics, and [the runner](../runner/stdio-backend.md#comparator-tests)
the `check` step and the API editors use.

**A sibling file, not a `tests:` section in the comparator file.** The
comparator's digest covers the canonical file
([above](#the-comparators-digest)), so inline tests would change the
comparator's identity whenever a test changed: saved comparisons would stop
verifying, and a hosted view would show "the comparator changed in this pull
request" for an edit to a test. Hosts fetch the comparator file at a revision,
at most 1 MiB, and must not fetch fixtures or tests. And tests name files
(fixtures, snapshots) relative to themselves, which pure comparator data
shouldn't. So test files are never part of a definition's digest and hosts never
read them.

**No `projections test` command.** `projections check -p <id> --no-render`
already is the fast loop, and it is the one command agents and CI run before
saying a projection works; a second command would be one more thing to forget.
The tests are one step of it, with their cases and failures as data in `--json`,
and editors list and run them through the Inspector API (`serve --stdio`), not a
command's text.

The pure parts, reading a test file with line and column and judging a
comparison against a case, are
[`suite/`](../../packages/comparators/rules/yaml/src/suite) in
`projections-rules-yaml`, the crate of the YAML subset rules are written in,
which evaluates nothing; the CLI resolves sources, runs the comparator in the
interpreter and writes snapshots
([`comparator_tests/`](../../packages/cli/src/comparator_tests/mod.rs)). The CLI
never evaluates rules natively. Every test file in this repository (the
examples, the first-party comparators and the `init` starter) passes in
`cargo test -p projections-cli --test comparator_tests`.

## Editing comparator files

![A comparator file in VS Code, Dark Modern: the CEL in its values coloured by what each name is, and the hover of graph.entity with its signature, documentation and cost](images/rules-editor-dark.png)

Editors see comparator files the way the interpreter does. Their language
service is `rules-editor.wasm`
([`projections-rules-editor`](../../packages/comparators/rules/editor)), a
module built from the interpreter's own crate and kept apart from `rules.wasm`,
which every viewer downloads. Its export, `projections_rules_editor`, takes one
JSON request, `{op, source, kind, line?, column?}`, and answers it from the same
YAML reader and checker that load the file:

- **`tokens`.** The CEL in every value that the format says is an expression,
  and in nothing else: `expression`, `body`, `assert`, `message`, `path`, `key`,
  `claims`, `when`, `where`, `summary`, `annotation`, `changes`, `sort`, `rank`,
  `value` and metadata `values`. Each value is lexed by the `cel` crate's own
  lexer (its `parser_pratt` lexer; the default parser's ANTLR lexer isn't
  public), and each token is classified from its context and what the expression
  can see. Every token uses an LSP standard type and modifier, so every theme
  colours it:

  <!-- prettier-ignore -->
  | Token | Type and modifiers |
  |---|---|
  | The standard library (`json`, `graph.*`, `ids.*`, `lists.*`, `maps.*`, `findings.*`, `prose.*`) and CEL's own functions | `function` or `method`, with `defaultLibrary` |
  | The rules macros (`match`, `cond`, `collect`, `template`) | `macro` |
  | CEL's macros (`has`, `all`, `exists`, `map`, `filter`, …) | `macro`, with `defaultLibrary` |
  | The file's own `functions` | `function` |
  | `variables`, and a namespace before a library call | `namespace` |
  | `variables.<name>` | `variable`, with `readonly` |
  | Inputs and section names (`before`, `after`, `options`, `item`, `change`, …) | `parameter`, with `readonly` and `defaultLibrary` |
  | Function parameters | `parameter` |
  | Comprehension variables | `variable` (`declaration` where they are bound) |
  | Fields, and the keys of `options` | `property` |
  | Strings, numbers, keywords and comments | `string`, `number`, `keyword`, `comment` |
  | Operators and punctuation | `operator`, so the YAML string colour doesn't show through |
  | A `template` string's `{name}` | `variable` (`parameter` for a function's parameter), with its braces as `operator` |

  The types in `params` and `returns` are `type`. Declared variable and
  parameter names have `declaration`.

  The YAML reader keeps each scalar's first position. The service walks the
  source from there, through quotes and escapes, block indentation and line
  folding, and maps a character only where the source spells exactly that
  character, so a token is never drawn in the wrong place. A file that isn't
  YAML yet has no tokens, and an expression that doesn't parse still has tokens.

- **`diagnostics`.** Exactly what loading reports: what
  `projections_rules_inspect`, `projections check` and
  `npm run check:comparators` report, at their line and column, ending at the
  end of the token they start at. That means errors (a YAML or CEL syntax error,
  an unknown field, name or function with its suggestion, a type error, a macro
  misused) and the lint warnings (`chained-conditional`, `match-values`). As
  when loading, warnings come once the file has no errors. For a test file
  (`kind: tests`), the diagnostics are those of the test format's reader.
- **`hover`.**
  - The standard library: a signature with parameter names
    (`json(value: dyn) -> string`), its documentation and its cost class.
  - Macros and CEL's functions: a signature and documentation.
  - The file's functions: their parameters, result and `description`.
  - `variables.<name>`: its checked type, `description`, expression and
    `values`.
  - Inputs, parameters, comprehension variables and fields: their declared
    types.
- **`complete`.** Completions depend on what comes before the cursor:
  - after `variables.`, the variables in scope, with their types;
  - after `options.`, the keys the file reads (`options.x`, `options['x']`, and
    the keys a check over `options` compares with);
  - after a library namespace, its functions;
  - after a value of a declared type (an input, a parameter, a typed variable, a
    library call's result, or a comprehension variable over a list of them), its
    fields and the methods for its kind;
  - otherwise, the names in scope, the file's functions, the macros, the library
    and CEL's functions.

  Completions read the scope the checker records for the expression's section.
  The service reads the file tolerantly, keeping an expression that doesn't
  parse as `null`, so it still knows what an unfinished expression can see.

Positions are 1-based lines and Unicode code-point columns, as the YAML reader
counts them. Editors convert them to their own units, such as UTF-16 in VS Code.
Checker messages count characters too. The tables only editors read, the macros'
and CEL's documentation and the library's parameter names, live in the editor
module, not in `language.json`, so the service doesn't change the interpreter's
identity. Tests hold that every library function and CEL function is documented.

The VS Code extension
([`rules-language.ts`](../../packages/integrations/vscode/src/rules-language.ts))
ships `rules-editor.wasm` and runs it in a worker thread. The worker compiles
the module once and instantiates it per request. This needs neither the CLI nor
trust, and typing never waits on it. Hosts have the checker in-process, so this
path, rather than the `serve --stdio` backend, works before any backend starts,
in untrusted workspaces, and at native WebAssembly speed. Highlighting is a
semantic tokens provider for comparator files and their tests, not a TextMate
injection, because an injection can't be limited by file name and would colour
every YAML file, workflows included. The providers answer only inside
expressions, so the YAML extension's schema validation, hovers and completions
(`yamlValidation`) keep working around them. **A separate module.** The service
needs the CEL lexer, the test format's reader, tolerant reading and the
checker's recorded scopes, which `rules.wasm` doesn't. Built into `rules.wasm`,
they would cost every viewer about 250 KB (86 KB compressed). So the editor
crate links the interpreter without its module ABI (`abi`, a default feature)
and with the reading hooks (`editing`), and `rules.wasm` is built with neither
the hooks nor the editor. The build fails if `rules.wasm` exports
`projections_rules_editor`. `rules-editor.wasm` is about 2.2 MB (650 KB
compressed), and only the extension ships it.

## The core and the comparator

The default comparator's matching is a generic core of identity passes
([`matching.rs`](../../packages/comparators/default/src/matching.rs)) that both
comparators share: a pass only sees the items earlier passes left unmatched;
claim groups become one-to-one, split or merge changes (or an
`ambiguous-correspondence` error); a one-to-one pair's status is derived from
canonical content modulo variation the extractions declare within tolerance
(through the Engine's `volatility` module), relationship endpoints compared
through one-to-one entity correspondence, and pairs that varied only within
tolerance are listed as `unchanged` with `varied`; what is left is added or
removed; change IDs are unique. Rules add passes; they can't make an unchanged
pair `modified` or hide a change, because the contract doesn't allow any
comparator to.

**The default order stays a native core primitive.** It is expressible as rules
([`default-order.yaml`](../../packages/comparators/rules/tests/rules/default-order.yaml),
19 functions over `graph.depths` and `graph.components`, kept as an executable
specification and tested against the native order on 1,831 cases), but it is an
algorithm, not configuration, and as rules it is quadratic: it finds each
change's step by scanning, where the native order indexes. Comparator files
always start from the native order (`baseline`), computed natively, never by the
default-order rules.

## Reference definitions

_Historical: this records the migration from the removed JavaScript and
WebAssembly comparators._

The rules are the **reference** definitions of the comparators they replace, not
emulations of the originals. Rules that existed only to reproduce an
implementation language's behaviour on ordinary inputs are gone:

- **Runtime policy.** JavaScript's `?.`, `??` and template-literal coercion
  (`field`, `orElse`, `text`) became CEL's optional syntax
  (`entity.?data.?effect.orValue(null)`); the last-write-wins `Map` behind
  `hookOf` became `graph.parents`/`graph.children`; sorting setting names in
  UTF-16 order became `ids.sort(maps.keys(...))`. 20 functions instead of 32.
- **API compatibility.** Zip and enumerate by index became `lists.zip`; Rust's
  `Classification::from` (consecutive de-duplication, the most severe level,
  distinct reasons) became `findings.classify`; the .NET `BTreeSet` differences
  became `filter`s over the declared lists.

Equivalence is therefore [semantic](#equivalence), and the five places where an
original was quirky are pinned as divergence tests. Where an original was wrong
rather than different, it was fixed: the moved components JavaScript named a
paired relationship's change by its unsuffixed after ID, so a relationship whose
ID was also a changed entity's ID produced two changes with one ID and an
invalid comparison; it was changed to add the uniqueness suffix the core adds.

The originals' fate:

<!-- prettier-ignore -->
| Original | Fate |
|---|---|
| Runtime policy (`runtime-policy.js`) | **Deleted.** The rules ship as the comparator; its scope-containment tests run against the rules' `scopeChange` and `covers` |
| Moved components (JavaScript example) | **Replaced** by the rules example [`examples/comparators/moved-components`](../../examples/comparators/moved-components) |
| Priority order (Rust/WebAssembly and JavaScript examples) | **Replaced** by the rules example [`examples/comparators/priority-order`](../../examples/comparators/priority-order) |
| API compatibility (Rust module) | **Deleted; the rules replace it.** Two definitions of 4 ecosystems' rules would drift, the Rust was 2,650 lines against 1,138, and a module comparator can't run where rules must. Its 25 unit tests run against the rules ([`tests/api`](../../packages/comparators/rules/tests/api)), unchanged but for the harness |
| `projections init` starter and the guide's example (JavaScript) | **Deleted**; they had become rules before |

Before the originals were deleted, their comparisons of every fixed case the
equivalence tests used (the repository's fixture pairs in both directions, with
each test's option variants, and the hand-written option and fixture cases; not
the seeded random ones) were recorded once in
[`tests/golden`](../../packages/comparators/rules/tests/golden), with each
case's input digest. The rules must agree with every one in the semantic normal
form below; a case whose fixtures have since changed is reported as stale and
skipped, since nothing can record it again. The seeded cases now check that the
rules run: a comparison the Engine validates, or a comparator's failure.

| Original                                                         | Golden cases |
| ---------------------------------------------------------------- | ------------ |
| Priority order (the Rust and JavaScript originals agreed on all) | 212          |
| `projections init` starter                                       | 312          |
| Guide example                                                    | 104          |
| Moved components                                                 | 52           |
| Runtime policy                                                   | 89           |
| API compatibility                                                | 93           |

## Verdicts per comparator

_Historical: the feasibility study's verdicts, measured against the originals
before they were removed._

"Idiomatic" means configuration a reviewer reads as intent: identity keys,
predicates, rank expressions, finding constructors, sentences. "List surgery"
means CEL that rebuilds data structures or control flow the original language
provides: index loops, scans standing in for maps, emulated coercions. It is
expressible, but it counts against the format.

- **Default: matching and options**: originally Rust; as rules, 2 passes
  (reserved) and the native option checks. Verdict: **Core**.
- **Default: order**: originally Rust, 428 lines; as rules, 168 lines, 19
  functions (specification only). Verdict: **Expressible with `graph.depths`,
  `graph.components`**; kept native. Remaining list surgery: All of it:
  layering, waves, relationship placement.
- **[Priority order](../../examples/comparators/priority-order/priority-order.comparator.yaml)**:
  originally Rust 110, JavaScript 37; as rules, 21. Verdict: **Fully
  expressible**. Idiomatic: All: two option checks and one `rank`.
- **[`projections init` starter](../../packages/cli/templates/starter.comparator.yaml)**:
  originally 32; as rules, 31. Verdict: **Fully expressible**. Idiomatic: All.
- **[Guide example](../guides/order-of-changes.md#write-a-custom-comparator)**:
  originally 10; as rules, 8. Verdict: **Fully expressible**. Idiomatic: All.
- **[Moved components](../../examples/comparators/moved-components/moved-components.comparator.yaml)**:
  originally 116; as rules, 40. Verdict: **Fully expressible**. Idiomatic: All:
  two identity passes, a summary, one added step.
- **[Runtime policy](../../packages/comparators/runtime-policy/runtime-policy.comparator.yaml)**:
  originally 272; as rules, 315, 23 functions. Verdict: **Fully expressible**
  with `json`. Idiomatic: Interpretations (`collect`, `cond`), selector
  containment (`implied` as a `match`; `selects`, `covers`: nested
  `exists`/`all`), sentences (a `match` of `template`s), `rank` and `summary`
  steps.
- **[API compatibility](../../packages/comparators/api-compatibility/api-compatibility.comparator.yaml),
  four ecosystems**: originally Rust, about 2,650; as rules, 1,564, 149
  functions. Verdict: **Fully expressible** with `findings.classify`,
  `lists.zipLongest`, `lists.enumerate`. Idiomatic: Every ecosystem rule
  (ApiCompat diagnostics, TypeScript assignability over union constituents, the
  Cargo SemVer rules, apidiff), findings and sentences, as `match` by ecosystem
  and declaration kind, `collect` of findings and `template` sentences, over the
  typed, language-neutral `api/v0` contract; one shared rule per concept they
  share (an addition a container's implementers must make, a change of kind,
  supertypes lost or gained, visibility reduced, arity, a changed type or value,
  modifiers) reads a 224-line `policy` table of each ecosystem's rule IDs,
  levels, break kinds and messages. Remaining list surgery: Accessors for
  optional facts (`fact`, `is`, `listed`), and defensive ones (`holds`,
  `nativeText`, `field`) for `contract.native`, which is open JSON.

Nothing needs general computation. No comparator iterates to a fixed point over
its own output except the default order (graph depth and connectivity), and
nothing recurses over data of unbounded depth except quoting a value as JSON.
Notable negative results: **`typeAssignable`** isn't needed (the API comparator
compares union constituents, one nested `filter`/`exists`/`all`; structural
assignability into object members would need recursion, but the comparator
treats such types as opaque text, and the right home for it is the extractor),
nor are **`selectorContains`** (about ten lines of CEL) and **`semverBump`**
(the most severe finding wins).

## Equivalence

_Historical: the equivalence runs ended when the originals were removed; the
golden comparisons replace them._

Until the originals were removed,
[`tests/`](../../packages/comparators/rules/tests) ran every original and its
rules on the same inputs; the results below are from then, and the
[golden comparisons](#reference-definitions) keep the fixed cases checked. The
inputs are every before and after pair of extraction fixtures in the repository,
in both directions, with each comparator's option variants, plus seeded
generators: random graphs with renames, splits, merges, ambiguous claims and IDs
whose UTF-16 and code-point orders differ; components moving between modules;
mutations of the Tetragon policy fixtures; and mutations of the API fixtures'
contract facts, entities, identities and signatures for each ecosystem.

Equivalence is **semantic**: the same correspondences, statuses,
classifications, counts, steps and step order, with text compared after a normal
form, because the rules are reference definitions rather than emulations. The
normal form collapses whitespace, writes integral numbers without a fraction
(`2.0` is `2`), reads JavaScript's `undefined` as `unknown`, compares
`; `-separated lists as sets, and compares findings and notices as sets.
Canonical equality (RFC 8785 with `changes` in ID order) is reported too.

<!-- prettier-ignore -->
| Comparator | Cases | Byte-identical | Same failure | Canonically equal | Semantically equal | Mismatches |
|---|---|---|---|---|---|---|
| Default (native order) against the order rules | 1,831 | 1,782 | 49 | 1,831 | 1,831 | **0** |
| Priority order (Rust) | 1,389 | 1,353 | 36 | 1,389 | 1,389 | **0** |
| Priority order (JavaScript) | 1,389 | 1,353 | 36 | 1,389 | 1,389 | **0** |
| `projections init` starter | 2,112 | 1,705 | 407 | 2,112 | 2,112 | **0** |
| Guide example | 704 | 682 | 22 | 704 | 704 | **0** |
| Moved components | 852 | 439 | 8 | 852 | 852 | **0** |
| Runtime policy | 739 | 736 | 3 | 739 | 739 | **0** |
| API compatibility | 1,693 | 1,668 | 25 | 1,693 | 1,693 | **0** |

On the corpus the domain-direct rules are even canonically equal: the emulation
was only ever needed for inputs outside it. Moved components' comparisons differ
in bytes only in the order of `changes`.
`cargo test --release -p projections-comparator-rules` runs everything; debug
builds check a tenth of the generated cases and a quarter of the fixture pairs
(`DECLARATIVE_FULL=1` restores them).

### Known differences

Five inputs outside the corpus made an original and its rules disagree, each
pinned by a test in
[`tests/divergences.rs`](../../packages/comparators/rules/tests/divergences.rs)
as documentation of where the originals were quirky. The originals are deleted,
so the tests pin the rules' output and say what the original's was:

<!-- prettier-ignore -->
| Comparator | Smallest input | Original | Rules |
|---|---|---|---|
| Default, `order.by: data.<key>` | Two added steps whose values are `-0` and `0` | `f64::total_cmp` puts `-0` first | CEL compares them equal; the tie keeps the default order |
| Moved components | A moved entity's relationship arrives with an after ID that is also a changed entity's ID | Was an invalid comparison (a bug, now fixed): both agree | The core's uniqueness suffix (`e~1`) |
| Runtime policy | A `graph/v0` policy whose `scope` is an object (the `runtime-policy/v0` vocabulary requires a string) | `[object Object]` | `{pods: app=web}` |
| API compatibility | A `contract.native` fact `1` that becomes `1.0` while the signature changes | serde_json tells them apart: `unknown`, "its contract changed" | JSON (and the Engine's canonical content) doesn't: `compatible` |
| API compatibility (.NET) | A non-string constant `value` `1.0` → `2.0` | serde's `1.0` | JavaScript's `1`; since the facts are typed, the Engine rejects it first |

## Determinism, termination and cost

**Determinism.** CEL has no clock, randomness or I/O. Map iteration follows hash
order, so the library's `maps.keys` and `ids.sort` return sorted lists, and
every file here sorts what it lists. The engine's own lists (changes, steps,
members) are in canonical order and identity passes iterate in ID order. A test
runs each comparator file repeatedly in fresh interpreters and compares the
bytes.

**Termination.** CEL is not Turing-complete: comprehensions iterate over
existing lists, `lists.range` is capped at 10⁶, and functions form an acyclic
call graph. Every evaluation terminates.

**Cost.** Termination isn't a cost bound: a quadratic comprehension over
`lists.range(1000000)` terminates after 10¹² steps, and 32 acyclic functions
`fN(s) = fN-1(s + s)` build a 4 GiB string. Three limits stop them, from the
inside out:

1. A **deterministic cost meter**
   ([`cost.rs`](../../packages/comparators/rules/src/cost.rs)). Every call in
   every expression (operators, comprehension steps, functions) is instrumented
   when the file loads and charges one unit plus the size of its result. A
   comparison may spend 2×10⁸ units; past that it fails with `cost-limit`. The
   count is a property of the rules and the input, the same on every host and in
   every build.
2. The **sandbox**: the interpreter is an ordinary zero-import comparator
   module, run in wasmi with fuel (`Limits::rules()`, 10¹² units) and a 256 MiB
   memory cap in the CLI, and in a Worker with a deadline and the same memory
   cap in browsers.
3. Static limits: 1 MiB comparator files, 32 levels of YAML nesting and the CEL
   parser's own nesting limit.

A static per-expression estimate ("this rule is quadratic in entities") is a
later addition for the Inspector.

## Performance: safety over speed

The rules interpreter evaluates rules from repositories, so it always runs
**sandboxed**, wasmi with fuel and memory caps in the CLI and a sandboxed Worker
in browsers, as defence in depth against bugs in the interpreter or the CEL
crate, even on a server where speed would argue for running it as trusted code.
The trade-off is plain: the sandbox costs 5-25 times native speed, which on real
fixtures is tens to hundreds of milliseconds.

Two safety-neutral measures keep it there:

- **Compile once per content.** Hosts compile the interpreter once and check
  each comparator file once per content (the CLI keeps the checked module; the
  JavaScript runtime caches checks by content hash). Each comparison runs in a
  fresh sandbox instance, which parses the rules again: the parse is the price
  of not sharing state between comparisons.
- **A native baseline.** The default matching and order inside a rules
  comparison are the default comparator's own Rust, compiled into the
  interpreter, not the order rules.

Two measures inside the interpreter took the API comparator from 578 ms to 306
ms in the sandbox: function calls and variables copy a value once (cel 0.15's
two value representations otherwise convert, and rehash maps, twice per call),
and YAML positions split the source into lines once rather than per block
scalar.

Times on an Apple Silicon laptop under heavy load; the sandbox figures are best
of three.

<!-- prettier-ignore -->
| Comparator, input | Native: check | Native: compare | Native default alone | Sandbox: check | Sandbox: compare | Sandbox default comparator module | Ceiling |
|---|---|---|---|---|---|---|---|
| Priority order, `file-packing` (1,582 entities, the largest fixture) | 1.5 ms | 55 ms | 54 ms | 9 ms | 419-452 ms | 370 ms | 2 s |
| API compatibility, TypeScript fixture | 18 ms | 11 ms | 1.1 ms | 183 ms | 306-337 ms | 11 ms | 500 ms |
| API compatibility, Go fixture | 14 ms | 4.6 ms | 1.1 ms | 201 ms | 233-259 ms | 8.5 ms | 500 ms |
| Runtime policy, Tetragon `credentials` | 4.3 ms | 1.7 ms | 0.6 ms | 54 ms | 58-67 ms | 6.6 ms | 500 ms |

On the largest fixture the rules cost what the default comparator costs natively
(55 against 54 ms) and 1.2 times it in the sandbox; the work is the default
matching and order, and priority order adds one rank per change. On the small
API and runtime policy fixtures parsing the rules dominates: the API rules are
1,138 lines of CEL.

"Compare" in the sandbox includes parsing the rules again in the fresh instance.
The ceilings, in
[`tests/module.rs`](../../packages/comparators/rules/tests/module.rs), are loose
on purpose: they catch pathological regressions, not small slowdowns.

### At the extraction limit

The Engine caps an extraction at 10,000 entities and 50,000 relationships.
[`examples/scale.rs`](../../packages/comparators/rules/examples/scale.rs)
generates two extractions of that size with every relationship changed (100,000
changes), the same worst case as [the engine evaluation](engine-evaluation.md).

<!-- prettier-ignore -->
| Comparator | Native | Native peak (process) | Sandbox (wasmi) | Fits 256 MiB | Fuel |
|---|---|---|---|---|---|
| Default comparator | 773 ms | 607 MiB | 6.0 s | Yes | < 10¹¹ |
| Empty comparator file (the default comparator through the interpreter) | 815 ms | 615 MiB | 6.5 s | Yes | < 10¹¹ |
| Priority order | 1,132 ms | 618 MiB | 10.5 s | Yes | < 2×10¹¹ |
| Moved components | 1,361 ms | 649 MiB | 9.9 s | Yes | < 2×10¹¹ |

The process peaks include the generated inputs as JSON values; the interpreter's
own memory is the sandbox's linear memory, which stays inside the 256 MiB cap. A
module's default fuel (10¹¹) is too little at the limit, so rules run with
`Limits::rules()`, 10¹², five times the most measured. The cost meter charged
200,003 units for priority order, a thousandth of its budget. Cost is linear:
from 1,250 to 10,000 entities, each doubling costs 2.0-2.2 times (moved
components 126, 256, 538 and 1,129 ms natively), with no quadratic pass in
identity matching, `pairs`, step building or copying. Rules need 10 s in the
sandbox at the limit; that is a CLI run over the largest legal input, and the
safety decision accepts it.

## The CEL and YAML implementations

<!-- prettier-ignore -->
| | Choice | Licence | WebAssembly |
|---|---|---|---|
| CEL | [`cel`](https://crates.io/crates/cel) 0.15 (cel-rust), without its `chrono`, `regex` and encoder features | MIT | Builds for `wasm32-unknown-unknown` with zero imports; its dependencies (`antlr4rust`, `nom`, `lazy_static`, `thiserror`, `serde`) are pure Rust |
| YAML | [`yaml-rust2`](https://crates.io/crates/yaml-rust2) 0.13, its event parser only | MIT or Apache-2.0 | Pure Rust, zero imports |

Neither crate's package includes its license file, so [`notices`](../../notices)
holds the upstream texts, and `rules.wasm` ships with `THIRD_PARTY_NOTICES.txt`
for every crate compiled into it. cel 0.15 implements the CEL standard library
with optional types and cel-go's strings, lists and math extensions, which the
rules use; it lacks a checker, cost tracking and two-variable comprehensions,
which the interpreter supplies or works around. The CEL parser (ANTLR) is the
slowest part: about 30 µs per expression.

## Comparator files only

Custom comparators are comparator files. The JavaScript and WebAssembly
comparators were removed after rules landed: the `comparator.module` definition
and scenario kind, the QuickJS engine, the public module ABI and its SDK
(`comparators/sdk`), the Rust API compatibility crate, and the JavaScript and
Rust examples, with no compatibility path (the protocol is pre-1.0). wasmi stays
only as the sandbox for Projections' own modules, the rules interpreter and
`default-comparator.wasm`, whose interface is now internal
([the interpreter module](../contracts/comparisons.md#the-interpreter-module));
the default comparator stays native Rust.

Rules can do what every comparator here does. Heavy logic goes elsewhere:

- **Into the extractor**, computed per revision into `data`, in the author's own
  toolchain: type assignability, semantic versions, anything that needs a
  compiler or a parser. A comparator then compares facts.
- **Into the engine**, as a library operation, when it is generic, needed by
  more than one comparator, and inexpressible in CEL or only as list surgery.
  Contributing one means a function in `library.rs` with its signature, cost
  class and documentation, checker and determinism tests, and a row in
  [the table above](#the-standard-library).

## Running comparators in a hosted view

A hosted view of CI artifacts never runs code from artifacts. Rules are data:
interpreting them, in the sandboxed interpreter, is the same kind of act as
rendering an extraction, so a hosted view can run them, given four decisions.
What is built is under [What changes](#what-changes).

### Obtaining the comparator file

A hosted view already reruns the default comparator rather than trusting a saved
comparison. For rules it needs the comparator file the comparison claims to have
used, and two sources are possible:

- **Fetch from the repository at the recorded commit** through the GitHub API
  (`GET /repos/{owner}/{repo}/contents/{path}?ref={commit}`) with the viewer's
  token, where `{path}` is the definition's comparator file and `{commit}` the
  definition revision: the merge base by default, the head when the run used
  `--definition head`.
- **Embed the comparator file in the artifact**, in the comparison document.

Recommendation: **fetch, and use an embedded copy only as a cache.** An artifact
is produced by a workflow run of the pull request, which the pull request's
author can change, so anything it embeds is a claim. The repository at the merge
base is not under the author's control. Either way the view verifies before it
runs anything: the parsed file's canonical digest must equal the comparison's
`comparator.digest`, and the definition recorded in both extractions must name
the same comparator file. A mismatch is a new unverified reason,
`rules-mismatch`. A fetched file is parsed with the same restricted YAML reader
and validated against the schema; a file that fails is `incompatible`.

### Base versus head

Whose rules judge a pull request is a trust decision, and the contracts already
make it for definitions: by default a comparison applies the **base** revision's
definition, with its component code, to both revisions. Rules follow the same
rule, so a pull request can't change how it is judged:

- The view reruns the comparison with the **base** rules, fetched at the merge
  base, and shows that.
- When the head revision's rules differ from the base's (their canonical digests
  differ, or the head adds or removes the comparator file), the view shows a
  notice, "This pull request changes the comparator file", and the file's diff
  itself is the reviewable part of the pull request: a readable YAML diff of
  declarations, not code.
- The view offers to show the comparison with the head's rules too, rerun by the
  view, clearly labelled as the head's rules. It never shows the head's result
  by default.
- When the base has no comparator file (the pull request introduces it), the
  default is the default comparator, with the same notice and the same offer.

This is stricter than the CLI's renderer trust model needs to be, because rules
can't exfiltrate anything; the risk is only misleading classification ("this
breaking change is compatible"), and showing the base's judgement by default
removes it.

### Cost limits

Per artifact, the view:

- caps a comparator file at 1 MiB and its YAML nesting at 32;
- relies on the interpreter's deterministic cost meter (2×10⁸ units per
  comparison), the same on every host;
- runs comparisons in a Worker with the comparator runtime's browser bounds (256
  MiB, and a deadline: 2 s per comparison and 10 s per artifact is a reasonable
  start), and reports `limit-exceeded`, never a partial result;
- caches checked rules by content, and verified comparisons by artifact SHA-256,
  rules digest and interpreter digest.

A deadline is host-dependent: a slow device might fail what a fast one passes.
That is acceptable for a viewer, which only fails to verify and never shows a
different result; the cost meter is what makes a result reproducible.

### What changes

As built:

- **Server-side sandbox.** A server-side verifier runs rules natively in wasmi
  with the CLI's bounds (fuel 10¹², 256 MiB), through `projections-rules`, a
  small runner in the comparator runtime crate that `createNativeRulesRuntime()`
  (`@githubnext/projections-comparator-runtime/node`) spawns per check or
  comparison and kills at a 10 s deadline. Browsers keep the Worker sandbox
  (`createRulesRuntime()`);
  [the security architecture](../guides/security.md#layer-3-comparators-are-data-interpreted-in-a-sandbox)
  says what each isolates.
- **`verifyComparison`** (`packages/engine/js/src/artifacts`) takes optional
  `rules` (the bytes and a runtime): it checks `comparator.id` against the
  definition's comparator file and `comparator.digest` against the checked
  file's digest, reruns them, validates the output with the Engine and compares.
  Without the file, a custom comparison is still rejected
  (`ARTIFACT_COMPARATOR`); a failing or invalid comparator run is
  `ARTIFACT_RULES`.

## History

The format began as a feasibility study: could every comparator in the
repository be re-expressed as data? It could, byte for byte, with three generic
operators, and the study recommended going ahead on the conditions this document
now records as built: variables at every level, a typed library, a load-time
checker with line and column, a deterministic cost counter, and the default
order as a native primitive. The verdict was accepted, and hosted views can run
custom comparators because rules are data.

A later review of the runtime policy and API compatibility rules found the same
smell everywhere: chains of `? :` standing in for tables, lists built from
`(c ? [x] : [])` and placeholders filtered out, and null guards around fields
every item has. The principle adopted: chained ternaries are a smell, and each
one is a prompt to look for a function or macro. The [macros](#macros),
guaranteed `data`, `item`, `lists.zipLongest` and `lists.enumerate` came from
that review, and the lint keeps it: across the repository's comparator files,
chains of two or more conditionals went from 64 (runtime policy 11, API
compatibility 52, the default order's specification 1) to 1, and chains of three
or more from 24 to none.

The other custom comparator kinds were then removed, since comparators must run
in production contexts (client and server) where a program from a repository
can't. Before deleting the originals, their comparisons of the fixed equivalence
cases were recorded as golden files, 862 in all, which the rules still match.
