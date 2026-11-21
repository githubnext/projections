# One model for runtime security policies

Status: **adopted** for Tetragon. The
[`tetragon-policies`](../../packages/extractors/tetragon-policies/README.md)
extractor writes this model, the
[runtime-policy renderer](../../packages/renderers/runtime-policy/README.md)
presents it, and the
[runtime policy comparator](../../packages/comparators/runtime-policy/README.md)
interprets its changes. The vocabulary is intentionally engine-neutral so other
runtime policy engines — such as KubeArmor, Falco, Tracee, seccomp, or AppArmor
— can adopt the same model later. See the
[proposal](../design/ebpf-policy-projection.md) for the background.

Every runtime security policy answers four questions: **where** in a running
system it attaches, **when** it triggers, **who** it applies to, and **what
happens** when it does. A pull request that edits a policy changes one or more
of those four dimensions, and reviewers need to see which one shifted — whether
it's a new kill action, a policy that suddenly covers every pod, or a hook that
nothing watches anymore. This model separates those four concerns so comparisons
can pinpoint exactly what changed.

## Ground rules

- **The declaration is the policy.** Extractors read only what the repository
  declares, never a live cluster. Policies loaded or toggled at runtime aren't
  part of the model.
- **No guessing.** Values that only resolve when a policy loads — like a
  generated syscall list, a CEL expression, or a kernel symbol that may not
  exist — are recorded literally rather than approximated. Unknown fields are
  preserved rather than dropped (see [version skew](#version-skew)).
- **Stay deterministic.** The same revision and inputs always produce the same
  extraction, regardless of file listing order.

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

Everything here is standard `architecture/v0`
([contracts](../contracts/extractions.md)), with unused fields omitted.
Extractions declare `"vocabularies": ["runtime-policy/v0"]`, and the engine
validates the fields renderers rely on (listed in
[`vocabularies/runtime-policy`](../reference/schemas/vocabularies-runtime-policy.md));
other fields are documented here and left open. Cluster-wide policies set
`namespace` to `null`.

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

Hook IDs follow the format `hook:<hookType>:<target>`.

### probe

A probe records `hookType`, `target`, and the engine's own capture details:
`message`, `tags`, `args`, `data`, `return`, `returnArg`, `syscall`, `raw`,
`binary`, `viaList` (the list a target was expanded from), and `unmodelled`.

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

Separating `effect` from `enforcement` lets reviewers read a mode toggle as
"three selectors start enforcing" instead of a single flipped option.

### subject

<!-- prettier-ignore -->
| `subjectKind` | Fields | ID |
| --- | --- | --- |
| `workloads` | `all`, `host`, `namespace`, `pods` and `containers` (normalized label requirements `{key, operator, values}`), `display` | `subject:workloads:<display>` |
| `binary` | `match`: `exact`, `prefix` or `suffix` | `subject:binary:<match>:<path>` |

Label selectors are normalized before being described: `matchLabels: {a: x}` and
`a In [x]` collapse into the same requirement, values are sorted, and
requirements are ordered consistently so equivalent spellings always map to one
subject.

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

Each policy has a single `applies-to` relationship identified by the policy
alone. When a policy's scope changes, that same relationship moves to a new
subject, showing up as a clean modification rather than a removal and an
addition.

### Text

Human-facing strings written by an extractor — conditions, actions, workload
scopes, node selectors, findings, and limitations — use
[text with inline code](../contracts.md#text-with-inline-code). Identifiers,
paths, addresses, values, and label selectors sit inside backticks while
connecting words stay outside, such as
`` `arg0` (`file`) starts with `/root/.ssh` or `/home` ``. Renderers display
these fields with the kit's `Prose` component; entity labels stay plain text.

| Item              | Prose fields                                |
| ----------------- | ------------------------------------------- |
| selector          | `conditions[].display`, `actions[].display` |
| workloads subject | `display`                                   |
| policy            | `scope`, `nodes`                            |
| any               | `findings[].message`                        |
| extraction        | `metadata.limitations`                      |

## Deployment facts

Optional extractor inputs can pull in context from other repository files that
affect how a policy behaves in practice. Because they are modeled as their own
entities, pull requests that change them show up in comparisons alongside policy
edits.

<!-- prettier-ignore -->
| Entity | What it is | ID | Fields |
| --- | --- | --- | --- |
| **agent** | The policy engine's agent configuration (Tetragon's Helm values) | `agent:<engine>` | `engine`, `path`, `policyFilter`, `persistentEnforcement`, `policyCrds` |
| **kernel** | A kernel profile of the nodes policies load on | `kernel:<name>` | `name`, `kernel` (version), `config` (option → enabled), `symbols` and `errorInjection` (`{path, count}`) |
| **workload** | A Kubernetes workload the repository deploys | `workload:<kind>:<namespace>:<name>` | `resource`, `name`, `namespace`, `labels` (the pod template's), `containers` (`{name, repo}`), `path` |

A policy's `covers` relationships map out which workloads fall inside its scope,
so a scope edit shows up as workloads gained or lost instead of just a changed
label selector.

### Findings

`data.findings` stores warnings about the revision being viewed, each shaped as
`{kind, message, profiles?}`. Because findings are facts about a single revision
rather than a diff, renderers show them at every point in a comparison.

<!-- prettier-ignore -->
| `kind` | On | Meaning |
| --- | --- | --- |
| `policy-filter-disabled` | policy | The agent's policy filter is off, so the engine rejects the policy's workload filtering and it doesn't load |
| `crds-disabled` | agent | The agent's chart doesn't install the policy CRDs |
| `hook-unavailable` | hook | A kernel profile can't attach the hook (no BPF LSM, no BTF for fentry, missing symbol) |
| `override-unavailable` | selector | A kernel profile can't run its `Override` |

## Identity across revisions

- **Policies** use the engine's own identity:
  `policy:tetragon:<kind>[:<namespace>]:<name>`. Moving a policy to another file
  only updates its `path`, while renaming it counts as a removal and addition
  unless the projection definition specifies a `correspondence`.
- **Probes** use `probe:<policy>/<hookType>:<target>`, adding `#2`, `#3`, and so
  on when one policy attaches multiple probes to the same target.
- **Selectors** use `selector:<probe>/<label>` when labeled, or
  `selector:<probe>/#<position>` otherwise (`*` denotes the implicit selector).
  Because unlabeled selectors rely on position, inserting a new selector before
  existing ones makes the later ones look modified — so recommending Tetragon's
  selector `label` is good practice.

Child IDs nest their parent's ID without the kind prefix, separated by `/`.
Every segment is percent-encoded so `/` never collides inside a part.

## Version skew

Policy engines add new fields frequently. When an extractor encounters a field
it doesn't model, it shouldn't fail (the newer engine config is still valid) and
it shouldn't silently drop it (changes to that field would slip past review).
Instead, unknown fields on a policy spec, probe, or selector are copied into
`data.unmodelled` and noted in `metadata.limitations`. Because `data.unmodelled`
is part of the extraction, editing an unknown field still marks the item as
modified. Unknown actions set the selector's effect to `unknown` unless a known
action enforces.

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

- Policies loaded or modes changed at runtime (`tetra tracingpolicy add`,
  `set-mode`).
- Whether a given kernel actually has a symbol, permits error injection, or
  supports BPF LSM; the hook's `stability` indicates how cautious to be.
- Event volume, runtime overhead, or whether a selector ever matches in
  practice.
- Precedence between policies. Tetragon has none, so coverage is simply a union;
  an engine with precedence would model it explicitly.
