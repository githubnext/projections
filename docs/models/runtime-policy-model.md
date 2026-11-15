# One model for runtime security policies

Status: **adopted** for Tetragon. The
[`tetragon-policies`](../../packages/extractors/tetragon-policies/README.md)
extractor writes it, the
[runtime-policy renderer](../../packages/renderers/runtime-policy/README.md)
presents it, and the
[runtime policy comparator](../../packages/comparators/runtime-policy/README.md)
interprets its changes. The vocabulary is deliberately not Tetragon's, so that
other runtime policy engines (KubeArmor, Falco, Tracee, seccomp, AppArmor) can
write the same model later. Its motivation is in the
[proposal](../design/ebpf-policy-projection.md).

A runtime security policy says, in some form, **where** in a running system it
attaches, **when** it acts there, **who** it applies to and **what happens**. A
pull request that changes a policy changes one or more of those four, and a
reviewer needs to know which: a new kill action, a policy that now covers every
pod, or a hook that nothing watches any more. This model keeps the four apart so
a comparison can say exactly which changed.

## Ground rules

- **The declaration is the policy.** Extractors read what the repository
  declares, never a running cluster. A policy loaded at run time, or a mode
  changed at run time, isn't part of the model.
- **No guessing.** Values a policy only gains when it loads (a generated list of
  every syscall, a CEL expression, a kernel symbol that may not exist) are
  recorded as such, never resolved by approximation. A field the extractor
  doesn't know is kept, not dropped (see [version skew](#version-skew)).
- **Deterministic.** The same revision and inputs always produce the same
  extraction, independent of file listing order.

## The boundaries

```
  policy ──declares──▶ probe ──attaches──▶ hook  (shared by every policy that attaches to it)
    │                    │
    │                    └──filters──▶ selector ──matches / excludes──▶ subject (binary)
    │                                     │
    └──applies-to──▶ subject (workloads)  └──applies-to──▶ subject (workloads)
```

<!-- prettier-ignore -->
| Entity | What it is | Why it is separate |
| --- | --- | --- |
| **policy** | One policy resource | The unit that is applied, named, scoped and switched between monitoring and enforcing |
| **hook** | An attach point: a kernel function, syscall, LSM hook, tracepoint, user-space function or USDT | Shared across policies, so two policies on one function meet at one hook and *coverage* is the union of what attaches to it. A hook that no probe attaches to any more is coverage lost |
| **probe** | One policy's specification at one hook | A policy can attach to many hooks, and a hook can carry several policies; the probe is what one pull request adds or removes |
| **selector** | One condition under which a probe acts, and what it does then | The level at which *effect* lives. Tetragon ORs a probe's selectors, so each is an independent rule |
| **subject** | Something a policy or selector applies to: a set of workloads, or a binary | Shared and identified by a canonical description, so a scope change is visible as a relationship moving from one subject to another |

## Vocabulary

Everything is ordinary `architecture/v0`
([contracts](../contracts/extractions.md)). Fields an engine has no use for are
absent. Extractions declare the vocabulary,
`"vocabularies": ["runtime-policy/v0"]`, and the engine checks the fields
renderers rely on
([`vocabularies/runtime-policy`](../reference/schemas/vocabularies-runtime-policy.md)
lists them); the others are documented here and stay open. A cluster-wide
policy's `namespace` is `null`.

### policy

<!-- prettier-ignore -->
| Field | Meaning |
| --- | --- |
| `engine` | The policy engine, such as `tetragon` |
| `resource`, `name`, `namespace` | The resource's kind and identity; `namespace` is `""` for a namespaced policy whose namespace comes from where it is applied |
| `path` | The file that declares it |
| `mode` | `enforce` or `monitor`. In `monitor` mode enforcement actions are elided |
| `modeSource` | `spec.options` when the policy sets it, `default` otherwise |
| `scope` | Plain-language description of the workloads it applies to (also the label of its `applies-to` subject) |
| `nodes`, `nodeSelector` | Where the agent loads it: `all nodes`, or the node label selector |
| `probes`, `selectors`, `enforcing` | Counts |
| `effect` | The strongest effect of its selectors: `enforce`, then `unknown`, `observe` or `none` |
| `invalid` | Violations of the repository's own CRD, when `crdPath` is given ([deployment facts](#deployment-facts)) |
| `findings` | Warnings about the presented revision ([findings](#findings)) |
| `options`, `enforcers`, `states` | Other engine options, enforcer attach points and state names |
| `templated` | The declaration contains `${…}` placeholders, read as literal text |
| `unmodelled` | Fields the extractor doesn't model ([version skew](#version-skew)) |

### hook

<!-- prettier-ignore -->
| Field | Meaning |
| --- | --- |
| `hookType` | `kprobe`, `fentry`, `tracepoint`, `lsm`, `uprobe`, `usdt` or `loader` |
| `target` | The function, `subsystem/event`, LSM hook, `binary:symbol` or `binary:provider:name`. Generated lists are `generated:<type>[:<pattern>]` |
| `stability` | `stable` (tracepoints, LSM hooks), `syscall` (stable ABI, symbol differs by architecture), `kernel-internal` (may be renamed or inlined between kernels), `user` or `generated` |
| `category` | `file`, `credentials`, `process`, `network`, `kernel-modules`, `bpf`, `namespaces`, `user-space` or `other`, derived from a table of well-known targets (`confidence: derived`) |
| `findings` | Kernel profiles that can't support the hook ([findings](#findings)) |

Hook IDs are `hook:<hookType>:<target>`.

### probe

`hookType`, `target`, and the engine's own description of what is captured:
`message`, `tags`, `args`, `data`, `return`, `returnArg`, `syscall`, `raw`,
`binary`, `viaList` (the list a target was expanded from) and `unmodelled`.

### selector

<!-- prettier-ignore -->
| Field | Meaning |
| --- | --- |
| `conditions` | Each filter as `{filter, operator, values, …, display}`. `display` is plain language using the argument's label when the policy gives one, otherwise its position and type (`arg0 (file) starts with /etc`), as [text with inline code](#text). It never guesses kernel semantics such as flag names |
| `binaries` | Binary filters: `operator`, `values`, `followChildren`, and `parent` for parent-binary filters. They are also `matches`/`excludes` relationships to binary subjects |
| `actions` | Each action with its arguments, `phase` (`call` or `return`), `display` (`Kill (Sigkill)`, `Deny (Override returns -1)`, `Observe`) as [text with inline code](#text) |
| `effect` | What happens when it matches (below) |
| `enforcement` | `active`, `elided` (an enforcing selector in a `monitor` policy) or `none` |
| `ordinal`, `label`, `implicit`, `macros` | Position, the engine's own label, whether it is the implicit "every call" selector of a probe without selectors, and macros expanded into it |
| `findings` | Kernel profiles that can't run its actions ([findings](#findings)) |

<!-- prettier-ignore -->
| `effect` | Meaning | Tetragon actions |
| --- | --- | --- |
| `enforce` | Stops or changes what the process does | `Sigkill`, `Signal`, `Override`, `NotifyEnforcer` |
| `respond` | Triggers something outside the kernel | `GetUrl`, `DnsLookup` |
| `observe` | Reports an event | `Post`, explicit or default |
| `track` | Updates engine state without reporting | `TrackSock`, `UntrackSock`, `Set`, `UpdateState` with `NoPost` |
| `silent` | Neither reports nor acts | `NoPost` alone |
| `unknown` | Uses an action the extractor doesn't know, and nothing known enforces | |

Keeping `effect` and `enforcement` apart lets a reviewer see a mode change as
"three selectors start enforcing" rather than as one changed option.

### subject

<!-- prettier-ignore -->
| `subjectKind` | Fields | ID |
| --- | --- | --- |
| `workloads` | `all`, `host`, `namespace`, `pods` and `containers` (normalized label requirements `{key, operator, values}`), `display` | `subject:workloads:<display>` |
| `binary` | `match`: `exact`, `prefix` or `suffix` | `subject:binary:<match>:<path>` |

Label selectors are normalized before they are described: `matchLabels: {a: x}`
and `a In [x]` are one requirement, values are sorted and requirements ordered,
so equivalent spellings produce one subject.

### Relationships

<!-- prettier-ignore -->
| Kind | From → to | ID |
| --- | --- | --- |
| `declares` | policy → probe | `declares:<probe>` |
| `attaches` | probe → hook | `attaches:<probe>` |
| `filters` | probe → selector, `data.ordinal` | `filters:<selector>` |
| `applies-to` | policy → workloads, or selector → workloads (`matchWorkloads`) | `applies-to:<policy or selector>` |
| `matches`, `excludes` | selector → binary, with `operator`, `parent`, `followChildren` | `binary:<selector>/<self or parent>/<match>/<path>` |
| `covers` | policy → workload, with `containers` when a container selector picks some; `confidence: derived` | `covers:<policy>/<workload>` |

`applies-to` has one relationship per policy, identified by the policy alone, so
a scope change is the same relationship moving to a different subject: a
modification, never a removal and an addition.

### Text

Text an extractor writes for people (a condition, an action, a workload scope, a
node selector, a finding, a limitation) is
[text with inline code](../contracts.md#text-with-inline-code): identifiers,
paths, addresses, values and label selectors go in backtick spans, the
connecting words stay outside, for example
`` `arg0` (`file`) starts with `/root/.ssh` or `/home` ``. Renderers draw it
with the kit's `Prose`; entity labels stay plain.

| Item              | Prose fields                                |
| ----------------- | ------------------------------------------- |
| selector          | `conditions[].display`, `actions[].display` |
| workloads subject | `display`                                   |
| policy            | `scope`, `nodes`                            |
| any               | `findings[].message`                        |
| extraction        | `metadata.limitations`                      |

## Deployment facts

Optional extractor inputs add facts from other repository files that change what
a policy means in practice. They are entities of their own, so a pull request
that changes them is compared like any other change.

<!-- prettier-ignore -->
| Entity | What it is | ID | Fields |
| --- | --- | --- | --- |
| **agent** | The policy engine's agent configuration (Tetragon's Helm values) | `agent:<engine>` | `engine`, `path`, `policyFilter`, `persistentEnforcement`, `policyCrds` |
| **kernel** | A kernel profile of the nodes policies load on | `kernel:<name>` | `name`, `kernel` (version), `config` (option → enabled), `symbols` and `errorInjection` (`{path, count}`) |
| **workload** | A Kubernetes workload the repository deploys | `workload:<kind>:<namespace>:<name>` | `resource`, `name`, `namespace`, `labels` (the pod template's), `containers` (`{name, repo}`), `path` |

A policy's `covers` relationships say which workloads its scope includes, so a
scope change is visible as workloads gained or lost, not only as a different
label selector.

### Findings

`data.findings` holds warnings about the presented revision, each
`{kind, message, profiles?}`: they are facts about that revision, not about a
change, so renderers show them at every point of a comparison.

<!-- prettier-ignore -->
| `kind` | On | Meaning |
| --- | --- | --- |
| `policy-filter-disabled` | policy | The agent's policy filter is off, so the engine rejects the policy's workload filtering and it doesn't load |
| `crds-disabled` | agent | The agent's chart doesn't install the policy CRDs |
| `hook-unavailable` | hook | A kernel profile can't attach the hook (no BPF LSM, no BTF for fentry, missing symbol) |
| `override-unavailable` | selector | A kernel profile can't run its `Override` |

## Identity across revisions

- **Policies** are identified as the engine identifies them:
  `policy:tetragon:<kind>[:<namespace>]:<name>`. Moving a policy between files
  changes only its `path`; renaming one is a removal and an addition unless the
  projection definition declares a `correspondence`.
- **Probes** are `probe:<policy>/<hookType>:<target>`, with `#2`, `#3` for a
  second or third probe on one target in one policy.
- **Selectors** are `selector:<probe>/<label>` when the engine gives them a
  label, and `selector:<probe>/#<position>` otherwise; `*` is the implicit
  selector. Unlabelled selectors are identified by position, so inserting one
  before others reports the later ones as modified. Tetragon's selector `label`
  exists for this; recommend it.

Child IDs nest their parent's ID without its kind prefix, separated by `/`.
Every part is percent-encoded, so `/` never appears inside one.

## Version skew

Policy engines add fields often. A field the extractor doesn't model must
neither fail the extraction (a newer engine version is valid) nor vanish (a
change to it would go unreviewed). The extractor therefore copies unknown fields
of a policy's spec, a probe or a selector into its `data.unmodelled`, which is
part of the extraction's content, so changing one marks the item modified. Each
one is also listed in `metadata.limitations`. An action it doesn't know makes
the selector's effect `unknown` unless a known action enforces.

## How Tetragon maps

<!-- prettier-ignore -->
| Tetragon | Model |
| --- | --- |
| `TracingPolicy`, `TracingPolicyNamespaced` | `policy` |
| `kprobes`, `fentries`, `tracepoints`, `lsmhooks`, `uprobes` (one probe per symbol, offset or address), `usdts`, `loader` | `probe` and `hook` |
| `call: list:<name>` | One probe per list value, with `viaList`; `generated_syscalls` and `generated_ftrace` lists stay one `generated` hook |
| `selectors[]`, `selectorsMacros` | `selector`, with macro filters appended as Tetragon does |
| `matchActions`, `matchReturnActions` | `actions`, `effect`, `enforcement` |
| `matchBinaries`, `matchParentBinaries` | `binaries` and binary subjects |
| `podSelector`, `containerSelector`, `hostSelector`, metadata namespace | The policy's workloads subject, after Tetragon's [filtering truth table](https://tetragon.io/docs/concepts/tracing-policy/k8s-filtering/#filtering-semantics) |
| `matchWorkloads` | A selector's workloads subject |
| `nodeSelector` | `nodes`, `nodeSelector` |
| `options: policy-mode` | `mode`, `modeSource` |

## Not modelled

- Policies loaded or modes changed at run time (`tetra tracingpolicy add`,
  `set-mode`).
- Whether a kernel has a symbol, allows error injection or supports BPF LSM; the
  hook's `stability` says how much to worry.
- Event volume, overhead and whether a selector ever matches.
- Precedence between policies: Tetragon has none, so coverage is a union. An
  engine with precedence would add it explicitly.
