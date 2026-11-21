# Proposal: a runtime security policy projection (Tetragon and eBPF)

> **Current state:** accepted and built for Tetragon (phases 1, 2, and 4). The
> "JavaScript comparator" proposed below is now the rules comparator
> [`runtime-policy.comparator.yaml`](../../packages/comparators/runtime-policy/runtime-policy.comparator.yaml);
> the rest records the research and plan as originally proposed.

Status: **accepted** for Tetragon. This proposal explores what a projection for
Tetragon — and eBPF-based runtime security more broadly — can show in a pull
request, and lays out a phased plan.

We scoped phases 1, 2, and 4 to Tetragon and deferred other engines (KubeArmor,
Falco, Tracee, Cilium, seccomp, AppArmor, and raw eBPF programs), so phase 3 is
not yet scheduled. Even so, the model and renderer keep generic runtime-policy
names and structure so additional engines can plug in later. The phase 2
comparator shipped as JavaScript and later became the rules comparator
[`runtime-policy.comparator.yaml`](../../packages/comparators/runtime-policy/runtime-policy.comparator.yaml)
once comparator files replaced custom JS comparators. The adopted vocabulary
lives in
[one model for runtime security policies](../models/runtime-policy-model.md),
which is authoritative wherever it differs from the sketch below (notably IDs).
Phases 1, 2, and 4 are all implemented: the
[`tetragon-policies`](../../packages/extractors/tetragon-policies/README.md)
extractor (including Helm/Kustomize rendering, CRD validation, agent values,
kernel profiles, and workloads), the
[`runtime-policy`](../../packages/renderers/runtime-policy/README.md) renderer,
and the
[runtime policy comparator](../../packages/comparators/runtime-policy/README.md).

Tetragon details are drawn from `cilium/tetragon` at commit
[`9b905a6`](https://github.com/cilium/tetragon/tree/9b905a6b2f0bf9a4f8585c37b9702a230320ac03)
(Helm chart and app version 1.8.0, 4 November 2026) and the
[Tetragon documentation](https://tetragon.io/docs/), with source links pinned to
that commit. Because several fields we rely on (`matchWorkloads`,
`nodeSelector`, selector `label`, `fentries`, `state`) are recent, the extractor
tolerates policies written for both older and newer Tetragon versions (see
[version skew](#version-skew)).

---

## Summary recommendation

Build a **runtime policy projection** starting with a static extractor for
Tetragon `TracingPolicy` and `TracingPolicyNamespaced` YAML. Every change should
answer one practical question: **what does this pull request newly observe,
newly enforce, stop covering, or apply to a different set of workloads?**

1. **Data model: `architecture/v0` with a documented vocabulary**, following the
   pattern set by
   [dependency injection](../models/dependency-injection-model.md) instead of
   adding a new domain schema. Entities are `policy`, `probe`, `hook`,
   `selector`, and `subject`, while security semantics (observe vs. enforce,
   effective mode, scope) live in `data`. We only need a dedicated domain schema
   later if the Engine needs to validate those fields directly.
2. **Extractor: a built-in Rust `tetragon-policies` extractor that parses YAML
   with no trust required.** The checked-in YAML _is_ the policy — nothing needs
   to be compiled or executed to read it. Helm and Kustomize rendering stay
   optional, trusted input modes, just like `terraform-infrastructure`'s native
   mode.
3. **Renderer: a new `runtime-policy` renderer** presenting a static diff (plus
   side-by-side) of _hook lanes_: who a rule applies to on the left, the
   condition in the middle, and the effect on the right. Until it ships, the
   graph renderer's `architecture` presentation and the host's table/text views
   cover the extraction adequately.
4. **Comparator: a JavaScript comparator** (phase 2; built, and now the rules
   comparator `runtime-policy.comparator.yaml`) that interprets diffs in
   security terms (escalated to enforcement, scope broadened, coverage lost) and
   surfaces the riskiest changes first.
5. **Second and third extractors: KubeArmor, then Falco.** KubeArmor shares a
   close typed structure (paths, processes, network, and capabilities × label
   selectors × `Allow`/`Audit`/`Block`) and tests our model against posture
   configured outside the file. Falco tests the _observe-only_ end and
   condition-language indirection, with an official offline resolver (`falco -L`
   with JSON output). Cilium network policies belong in a sibling projection
   reusing the scope vocabulary, and raw eBPF programs fit best as a separate
   hooks-only view.

---

## Target users and the questions it answers

- **Platform and security engineers** maintaining cluster Tetragon policies in a
  GitOps repo (`clusters/…/tetragon/*.yaml`, Helm charts, or Kustomize
  overlays): Does this PR newly kill or deny anything? In which namespaces and
  workloads? Did a policy flip from `monitor` to `enforce`, or did we lose hook
  coverage?
- **Application teams** shipping a `TracingPolicyNamespaced` in their service
  repo's `deploy/` folder: Will an existing policy kill my new binary or block a
  file path? Which of my workloads does it cover now?
- **Detection engineers** curating a policy library (often adapted from
  Tetragon's
  [`examples/policylibrary`](https://github.com/cilium/tetragon/tree/9b905a6b2f0bf9a4f8585c37b9702a230320ac03/examples/policylibrary)):
  Which kernel hooks and syscalls are covered by category? What did this PR add
  or drop? Are the hooks portable (tracepoints, LSM) or kernel-specific
  (kprobes)?
- **Reviewers who aren't kernel experts** in any of those repos: What does a
  200-line YAML diff actually _do_, once you untangle nested `AND`/`OR` rules?

That last group is the real motivation. Tetragon's own docs call `TracingPolicy`
"powerful, yet low-level configuration" that "requires knowledge about the Linux
kernel and containers"
([tracing policy](https://tetragon.io/docs/concepts/tracing-policy/)). A raw
line diff shows a moved list entry; it doesn't show that a `Sigkill` now hits
every pod labelled `checkout`.

---

## 1. What's in a repository

### TracingPolicy and TracingPolicyNamespaced

Both resources have `apiVersion` set to `cilium.io/v1alpha1` and share the same
spec, except the namespaced kind only matches pods in its namespace and rejects
a non-null `hostSelector`
([`tracing_policy_types.go`](https://github.com/cilium/tetragon/blob/9b905a6b2f0bf9a4f8585c37b9702a230320ac03/pkg/k8s/apis/cilium.io/v1alpha1/tracing_policy_types.go#L56-L140),
[Kubernetes filtering](https://tetragon.io/docs/concepts/tracing-policy/k8s-filtering/)).
A spec defines:

- **Hooks** (_where_ it attaches): `kprobes`, `fentries`, `tracepoints`,
  `lsmhooks`, `uprobes`, and `usdts` — up to 128 of each
  ([hooks](https://tetragon.io/docs/concepts/tracing-policy/hooks/)).
- **Selectors** (_when_ it fires): up to 5 per hook, **OR**ed together, with
  filters inside each selector **AND**ed
  ([selector semantics](https://tetragon.io/docs/concepts/tracing-policy/selectors/#selector-semantics)):
  `matchArgs`, `matchData`, `matchReturnArgs`, `matchCmdArgs`, `matchBinaries`,
  `matchParentBinaries`, `matchPIDs`, `matchNamespaces`,
  `matchNamespaceChanges`, `matchCapabilities`, `matchCapabilityChanges`,
  `matchWorkloads`, `matchUserCallers`, `matchStates`, `matchCEL`, and `macros`
  ([`KProbeSelector`](https://github.com/cilium/tetragon/blob/9b905a6b2f0bf9a4f8585c37b9702a230320ac03/pkg/k8s/apis/cilium.io/v1alpha1/types.go#L155-L230)).
- **Actions** (_what_ happens): `matchActions` (up to 3) and
  `matchReturnActions` — `Post`, `NoPost`, `Sigkill`, `Signal`, `Override`,
  `NotifyEnforcer`, `GetUrl`, `DnsLookup`, `TrackSock`, `UntrackSock`, `Set`,
  `UpdateState`, and `CleanupEnforcerNotification`
  ([`ActionSelector`](https://github.com/cilium/tetragon/blob/9b905a6b2f0bf9a4f8585c37b9702a230320ac03/pkg/k8s/apis/cilium.io/v1alpha1/types.go#L384-L386)).
  When omitted, `Post` is the default
  ([Post action](https://tetragon.io/docs/concepts/tracing-policy/selectors/#post-action)).
- **Workload scope** (_who_ it targets): `podSelector`, `containerSelector`,
  `hostSelector` (`null` or `{}` only), plus per-selector `matchWorkloads`,
  governed by an eight-row truth table where omitting all three matches every
  host and pod workload
  ([filtering semantics](https://tetragon.io/docs/concepts/tracing-policy/k8s-filtering/#filtering-semantics)).
- **Node scope** (_where_ it loads): `nodeSelector`. This fails open —
  relabelling a node can silently unload an enforcement policy
  ([node filtering](https://tetragon.io/docs/concepts/tracing-policy/k8s-filtering/#node-filtering)).
- **Mode**: `options: [{name: policy-mode, value: enforce | monitor}]`. In
  `monitor` mode, "enforcement operations are elided"
  ([enforcement mode](https://tetragon.io/docs/concepts/tracing-policy/mode/)).
- **Indirection**: `lists` (`call: "list:dups"`), `selectorsMacros`,
  `enforcers`, and `state`. Lists expand into one hook per entry, while
  `generated_syscalls` and `generated_ftrace` lists are populated from the
  running kernel
  ([lists](https://tetragon.io/docs/concepts/tracing-policy/hooks/#lists),
  [selector macros](https://tetragon.io/docs/concepts/tracing-policy/hooks/#selectors-macros)).

### Where policies come from

- **Plain manifests** applied via `kubectl` or GitOps — the most common setup
  and the one Tetragon's guides use.
- **Policy libraries** copied and adapted from Tetragon's curated
  [policy library](https://tetragon.io/docs/policy-library/) or
  [`examples/tracingpolicy`](https://github.com/cilium/tetragon/tree/9b905a6b2f0bf9a4f8585c37b9702a230320ac03/examples/tracingpolicy).
- **Helm charts and Kustomize overlays** that vary scope or mode across
  environments.
- **`envsubst`-style templates**, as in Tetragon's enforcement quick start which
  pipes `${PODCIDR}` and `${SERVICECIDR}` through `envsubst`
  ([policy enforcement](https://tetragon.io/docs/getting-started/enforcement/)).
- **Static files on non-Kubernetes hosts**, loaded from
  `/etc/tetragon/tetragon.tp.d/` or `--tracing-policy-dir`
  ([daemon configuration](https://tetragon.io/docs/reference/daemon-configuration/#configure-tracing-policies-location))
  using the same YAML without Kubernetes scope fields.
- **Tetragon's Helm values** (`tetragon.enablePolicyFilter` and export
  allow/deny lists). Because `enablePolicyFilter` "is required for K8s namespace
  and pod-label filtering"
  ([`values.yaml`](https://github.com/cilium/tetragon/blob/9b905a6b2f0bf9a4f8585c37b9702a230320ac03/install/kubernetes/tetragon/values.yaml#L305-L306)),
  agent configuration can change what a policy's scope actually means.

Keep in mind that policies aren't _always_ in Git: `tetra tracingpolicy add`
loads them over gRPC, and `tetra tracingpolicy set-mode` overrides a file's
`policy-mode` at runtime
([enforcement mode](https://tetragon.io/docs/concepts/tracing-policy/mode/)). A
projection reviews declared repository intent, never live cluster state.

---

## 2. Which eBPF artifacts are reviewable from source

- **Tetragon TracingPolicy** (**primary source**). Has a stable CRD with an
  OpenAPI schema
  ([CRD](https://github.com/cilium/tetragon/blob/9b905a6b2f0bf9a4f8585c37b9702a230320ac03/pkg/k8s/apis/cilium.io/client/crds/v1alpha1/cilium.io_tracingpolicies.yaml)),
  explicit typed hooks, explicit scope (label selectors, namespaces, binaries),
  and explicit actions plus mode.
- **KubeArmor** (`KubeArmorPolicy`, `KubeArmorHostPolicy`,
  `KubeArmorClusterPolicy` under `security.kubearmor.com/v1`, **best second
  extractor**). Uses a typed CRD with an `Allow`/`Audit`/`Block` enum
  ([CRD](https://github.com/kubearmor/KubeArmor/blob/main/deployments/CRD/KubeArmorPolicy.yaml),
  [spec](https://docs.kubearmor.io/kubearmor/documentation/security_policy_specification)),
  implicit LSM-backed hooks (process, file, network, capability, syscall), and
  explicit label/`fromSource` scopes. The catch is that default posture is set
  per namespace or globally outside the policy file
  ([default posture](https://docs.kubearmor.io/kubearmor/documentation/default_posture)).
- **Falco rules** (**good third extractor**, run via the user's Falco — see
  [below](#multiple-extractors)). YAML of `rule`, `macro`, and `list`, where
  hooks and scope live inside a `condition` expression
  ([rules](https://falco.org/docs/concepts/rules/),
  [overriding](https://falco.org/docs/concepts/rules/overriding/)) and event
  types only resolve after macro expansion. Observe/alert only (`priority`),
  with response handled separately.
- **Aqua Tracee** (`Policy`, `tracee.aquasec.com/v1beta1`, **possible later**).
  Has a CRD, though actions are free strings
  ([CRD](https://github.com/aquasecurity/tracee/blob/main/deploy/helm/tracee/crds/tracee.aquasec.com_policies.yaml))
  and detection-only (`log`, `forward`, `webhook` —
  [actions](https://aquasecurity.github.io/tracee/v0.16/docs/policies/actions/)),
  adding little beyond Falco.
- **Cilium** (`CiliumNetworkPolicy`, `CiliumClusterwideNetworkPolicy`, and
  Kubernetes `NetworkPolicy`, **sibling "network policy" projection**). Typed
  CRDs ([policy](https://docs.cilium.io/en/stable/network/kubernetes/policy/))
  targeting L3/L4/L7 peers and ports rather than kernel hooks, with
  `endpointSelector`, allow rules, explicit deny
  ([deny policies](https://docs.cilium.io/en/stable/security/policy/deny/)), and
  _emergent_ default deny once any policy selects an endpoint. Best modeled as a
  sibling sharing the scope vocabulary.
- **Seccomp** (Security Profiles Operator `SeccompProfile`) and **AppArmor**
  profiles (**later**). Parseable profiles
  ([seccomp](https://kubernetes.io/docs/tutorials/security/seccomp/),
  [SPO example](https://github.com/kubernetes-sigs/security-profiles-operator/blob/main/examples/seccompprofile.yaml))
  covering syscalls, files, capabilities, and network (`SCMP_ACT_*` or
  `allow`/`deny`/`audit`), but scope lives externally in each pod's
  `securityContext` and requires joining against workload manifests.
- **libbpf C, cilium/ebpf (`bpf2go`), Aya, and bpftrace** (**separate hooks-only
  "eBPF programs" view**). Only default attach hooks are statically visible —
  `SEC("kprobe/…")` in compiled objects
  ([libbpf program types](https://docs.kernel.org/bpf/libbpf/program_types.html),
  [ebpf-go section naming](https://ebpf-go.dev/concepts/section-naming/)), Aya
  macros
  ([`#[lsm]`](https://docs.rs/aya-ebpf-macros/latest/aya_ebpf_macros/attr.lsm.html)),
  or bpftrace specifiers — while filtering and verdicts live in program logic
  and maps.

For raw eBPF programs, a section name is only a _default_ attach target:
user-space code can attach elsewhere (`link.Kprobe(sym, …)`,
`bpf_program__attach_kprobe`), choose targets conditionally, or use wildcards
(bpftrace), and CO-RE relocations resolve against the target kernel. The honest
static fact is "this object contains a kprobe whose default target is
`do_sys_openat2`". Reading compiled ELF objects rather than regex-scraping C or
Rust follows our
[extractor rule](../../packages/extractors/README.md#ecosystem-extractors), and
requires either building the program (trusted) or reading a checked-in object.

---

## 3. What a reviewer wants to see change

Four candidate views, ordered by usefulness:

- **Enforcement diff (default).** What is newly killed, denied, or signalled,
  what stopped being enforced, and whether a policy's mode flipped. A PR adding
  a `Sigkill` should never blend in as a routine YAML edit.
- **Coverage map.** Which hooks, syscalls, and functions are observed or
  enforced, grouped by category (file, process, credentials, network, kernel
  modules, BPF), and what was gained or lost. In single-revision mode, this
  doubles as living cluster coverage documentation using the same layout.
- **Selector scope.** Which workloads, namespaces, binaries, and nodes a policy
  covers, and whether scope broadened or narrowed — critical when deleting a
  single `matchLabels` line quietly widens a policy to every pod. Phase 1 shows
  scope as old → new text; a full workload × policy matrix waits for concrete
  workloads ([phase 4](#effort-estimate)).
- **Event flow.** A hook → selector → action graph. Faithful but dense (3 hooks
  × 5 selectors × 3 actions = 30 edges per policy), so it works as a fallback in
  the graph renderer rather than the primary view.

### Existing renderers

<!-- prettier-ignore -->
| Renderer | Fit | Gap |
|---|---|---|
| [`graph`](../../packages/renderers/graph/README.md) (`architecture`) | Works on day one for the event-flow view | Dense; no notion of effect, mode or scope |
| [`graph`](../../packages/renderers/graph/README.md) (`infrastructure`) | Wording each change as an action in the card's status footer is the right *interaction* for enforcement changes | It keys on the [infrastructure model](../models/infrastructure-model.md)'s `data.action`; reusing it would overload deployment verbs |
| `messaging` (since removed) | The closest *layout*: one lane per event, sources on the left, consumers on the right, `diff` and `side-by-side` | Kinds and semantics differ |
| `conventions` (`flags`, since removed) | Card per item with consumers | Cards don't express effect or scope |
| Host table and text views | Always available and accessible | No grouping by hook or effect |

**Recommendation: build a new `runtime-policy` renderer** on the
[renderer kit](../../packages/renderers/kit/README.md), combining the former
messaging renderer's lane layout with the plan renderer's static diff
conventions. It supports `diff` (default) and `side-by-side`, with no `animated`
mode since scrubbing lists and cards would just pop rows in and out.

---

## 4. Data model

### Schema choice

Use **`architecture/v0`**, which "places no further constraints on kinds"
([contracts](../contracts/extractions.md)), paired with a vocabulary doc
(`docs/models/runtime-policy-model.md`) modeled on the
[dependency-injection model](../models/dependency-injection-model.md). Adding a
`runtime-policy/v0` schema now would touch the Engine
([`SCHEMAS`](../../packages/engine/src/validate/mod.rs)) and protocol just to
validate a handful of enums. We can revisit that after a second extractor
settles the vocabulary.

### Entities

- `policy`: One policy resource (`policy:tetragon:TracingPolicy:<name>` or
  `policy:tetragon:TracingPolicyNamespaced:<ns>/<name>`). Key `data`: `engine`
  (`tetragon`), `resource`, `name`, `namespace`, `path`, `mode` (`enforce`,
  `monitor`, or `unset`), `modeSource`, `nodeSelector` (canonical text), `scope`
  (canonical text), and `templated`.
- `hook`: A kernel or user-space attach point, **shared across policies** so
  multiple policies on one function converge
  (`hook:kprobe:security_file_permission`,
  `hook:tracepoint:syscalls/sys_enter_openat`, `hook:lsm:file_open`,
  `hook:uprobe:/usr/bin/bash:readline`, `hook:usdt:<path>:<provider>:<name>`).
  Key `data`: `hookType`, `target`, `syscall`, `binary` (uprobes), `stability`
  (`stable` for tracepoints, `lsm`, `kernel-internal` for kprobes/fentries,
  `user` for uprobes), and `category` (derived).
- `probe`: One policy's attachment on a hook — a `kprobes[]` entry or one
  expanded list value (`probe:<policy>/<hookType>:<target>`, with `#2` appended
  for repeats). Key `data`: `message`, `tags`, `args` (index, type, label),
  `return`, `viaList`, `specDigest`, and `unmodelled`.
- `selector`: One selector on a probe (`selector:<probe>/<label>` when `label`
  is set, else `selector:<probe>/#<ordinal>`, or one `implicit` selector `…/*`
  when a probe has none). Key `data`: `label`, `conditions` (normalized filters
  plus display text), `actions` (with arguments), `effect`, `enforcement`,
  `macros`, and `cel`.
- `subject`: A target a policy or selector applies to
  (`subject:pods:<canonical selector>`, `subject:namespace:<ns>`,
  `subject:containers:<selector>`, `subject:host`, `subject:all-workloads`,
  `subject:binary:<path>`). Key `data`: `subjectKind`, `selector` (structured),
  and `display`.

`effect` captures the strongest declared consequence of a selector:

| `effect`  | Actions                                                        |
| --------- | -------------------------------------------------------------- |
| `enforce` | `Sigkill`, `Signal`, `Override`, `NotifyEnforcer`              |
| `respond` | `GetUrl`, `DnsLookup` (user space, after the event)            |
| `observe` | `Post`, explicit or default                                    |
| `track`   | `TrackSock`, `UntrackSock`, `Set`, `UpdateState` with `NoPost` |
| `silent`  | `NoPost` alone                                                 |

`enforcement` records what actually happens given the policy's mode: `active`,
`elided` (an enforcing selector inside a `monitor` policy), or `none`. Storing
both lets a mode flip surface as "3 selectors start enforcing" rather than one
quietly changed option.

`category` (`file`, `credentials`, `process`, `network`, `kernel-modules`,
`bpf`, `namespaces`, `other`) is derived from a small built-in lookup table of
common functions/syscalls (`security_file_*`, `fd_install`, `tcp_connect`,
`commit_creds`, `sys_setuid`, …) and the probe's `tags` (`confidence: derived`),
defaulting to `other`.

### Relationships

<!-- prettier-ignore -->
| Kind | From → to | Notes |
|---|---|---|
| `declares` | policy → probe | |
| `attaches` | probe → hook | |
| `filters` | probe → selector | `data.ordinal` |
| `applies-to` | policy → subject (workload) | **One per policy, ID `applies-to:<policy>`**, so a changed scope is the same relationship rewired to a new subject: a modification, not a removal and an addition |
| `applies-to` | selector → subject (workload) | From `matchWorkloads`, ID `applies-to:<selector>` |
| `matches`, `excludes` | selector → subject (binary) | `data.operator` (`In`, `Prefix`, `Postfix`, or the `Not` forms), `followChildren`, `parent` for `matchParentBinaries` |

### Identity across revisions

- **Policies** are identified by kind, namespace, and name (matching
  Kubernetes), so moving a file only changes `data.path`. Renaming a policy is a
  remove + add unless `correspondence` declares the rename.
- **Hooks** are identified by type and target across all policies, so coverage
  forms a union. Tetragon lets independent policies attach to the same function
  with no precedence between them
  ([kprobes](https://tetragon.io/docs/concepts/tracing-policy/hooks/#kprobes)),
  making union the accurate model (unlike network policies, which have
  precedence).
- **Selectors are the weak point.** Because selectors are an unnamed ordered
  list, inserting one at the front renumbers the rest. Tetragon's optional
  selector `label` ("used in status and metrics",
  [`types.go`](https://github.com/cilium/tetragon/blob/9b905a6b2f0bf9a4f8585c37b9702a230320ac03/pkg/k8s/apis/cilium.io/v1alpha1/types.go#L156-L158))
  provides stable identity, so we use it when present and recommend it in docs.
  There are at most five selectors per hook, and we never match selectors by
  content — a moved unlabelled selector reports as modified in place, staying
  honest about ordinal identity.
- **Workload subjects** use a canonical string of the selector (sorted keys and
  sorted `In` values), so equivalent spellings converge and scope edits show up
  as rewiring the policy's `applies-to` relationship.

### Example extraction

Here is the head revision of the [sample pull request](#sample-pull-request)
(omitting the unchanged `egress-audit` policy for brevity):

```json
{
  "protocolVersion": 0,
  "schema": "architecture/v0",
  "entities": [
    {"id": "policy:tetragon:TracingPolicy:protect-credentials", "kind": "policy", "label": "protect-credentials",
     "confidence": "authoritative",
     "data": {"engine": "tetragon", "resource": "TracingPolicy", "name": "protect-credentials",
              "path": "deploy/tetragon/protect-credentials.yaml", "mode": "enforce", "modeSource": "spec.options",
              "scope": "pods where app.kubernetes.io/part-of in (checkout, payments)", "nodeSelector": "all nodes"},
     "evidence": [{"kind": "tetragon-tracing-policy", "source": "deploy/tetragon/protect-credentials.yaml", "location": {"line": 9}}]},
    {"id": "subject:pods:app.kubernetes.io/part-of in (checkout,payments)", "kind": "subject",
     "label": "app.kubernetes.io/part-of in (checkout, payments)",
     "data": {"subjectKind": "pods", "selector": {"matchExpressions": [
       {"key": "app.kubernetes.io/part-of", "operator": "In", "values": ["checkout", "payments"]}]}}},
    {"id": "hook:kprobe:security_file_permission", "kind": "hook", "label": "security_file_permission",
     "data": {"hookType": "kprobe", "target": "security_file_permission", "syscall": false,
              "stability": "kernel-internal", "category": "file"}},
    {"id": "probe:policy:tetragon:TracingPolicy:protect-credentials/kprobe:security_file_permission", "kind": "probe",
     "label": "security_file_permission",
     "data": {"message": "Credential file read", "tags": ["credentials", "file"], "return": true,
              "args": [{"index": 0, "type": "file"}, {"index": 1, "type": "int"}],
              "specDigest": "sha256:5c1e…"}},
    {"id": "selector:probe:policy:tetragon:TracingPolicy:protect-credentials/kprobe:security_file_permission/token-read-by-downloader",
     "kind": "selector", "label": "token-read-by-downloader",
     "data": {"label": "token-read-by-downloader",
              "conditions": [
                {"filter": "matchArgs", "index": 0, "type": "file", "operator": "Prefix",
                 "values": ["/var/run/secrets/kubernetes.io/serviceaccount"],
                 "display": "file starts with /var/run/secrets/kubernetes.io/serviceaccount"},
                {"filter": "matchArgs", "index": 1, "type": "int", "operator": "Equal", "values": ["4"],
                 "display": "arg 1 = 4"}],
              "actions": [{"action": "Sigkill"}],
              "effect": "enforce", "enforcement": "active"},
     "evidence": [{"kind": "tetragon-tracing-policy", "source": "deploy/tetragon/protect-credentials.yaml", "location": {"line": 44}}]},
    {"id": "subject:binary:/usr/bin/curl", "kind": "subject", "label": "/usr/bin/curl", "data": {"subjectKind": "binary"}},
    {"id": "subject:binary:/usr/bin/wget", "kind": "subject", "label": "/usr/bin/wget", "data": {"subjectKind": "binary"}}
  ],
  "relationships": [
    {"id": "applies-to:policy:tetragon:TracingPolicy:protect-credentials", "kind": "applies-to",
     "from": "policy:tetragon:TracingPolicy:protect-credentials",
     "to": "subject:pods:app.kubernetes.io/part-of in (checkout,payments)"},
    {"id": "declares:…/kprobe:security_file_permission", "kind": "declares",
     "from": "policy:tetragon:TracingPolicy:protect-credentials",
     "to": "probe:policy:tetragon:TracingPolicy:protect-credentials/kprobe:security_file_permission"},
    {"id": "attaches:…/kprobe:security_file_permission", "kind": "attaches",
     "from": "probe:policy:tetragon:TracingPolicy:protect-credentials/kprobe:security_file_permission",
     "to": "hook:kprobe:security_file_permission"},
    {"id": "filters:…/token-read-by-downloader", "kind": "filters",
     "from": "probe:policy:tetragon:TracingPolicy:protect-credentials/kprobe:security_file_permission",
     "to": "selector:probe:policy:tetragon:TracingPolicy:protect-credentials/kprobe:security_file_permission/token-read-by-downloader",
     "data": {"ordinal": 1}},
    {"id": "matches:…/token-read-by-downloader→/usr/bin/curl", "kind": "matches",
     "from": "selector:probe:policy:tetragon:TracingPolicy:protect-credentials/kprobe:security_file_permission/token-read-by-downloader",
     "to": "subject:binary:/usr/bin/curl", "data": {"operator": "In", "followChildren": false}},
    {"id": "matches:…/token-read-by-downloader→/usr/bin/wget", "kind": "matches",
     "from": "selector:probe:policy:tetragon:TracingPolicy:protect-credentials/kprobe:security_file_permission/token-read-by-downloader",
     "to": "subject:binary:/usr/bin/wget", "data": {"operator": "In", "followChildren": false}}
  ],
  "metadata": {"policies": 1, "limitations": []}
}
```

(`…` abbreviates repeated ID prefixes here only; real IDs are written out.)

---

## 5. Extraction feasibility and trust

### Recommended: static YAML (no trust)

A built-in Rust extractor, `tetragon-policies`, in the style of
[`github-actions-jobs`](../../packages/extractors/github-actions-jobs/README.md):

```json
{
  "id": "runtime-policies",
  "title": "Runtime security policies",
  "extractor": "tetragon-policies",
  "renderer": "runtime-policy",
  "inputs": {"paths": ["deploy/tetragon/**/*.yaml"]}
}
```

- Reads repository-relative files matching `paths` (supporting multi-document
  YAML), keeping `cilium.io/v1alpha1` `TracingPolicy` and
  `TracingPolicyNamespaced` resources and ignoring other kinds.
- Expands `list:` references and `selectorsMacros`, preserving `viaList` and
  `macros` so reviewers can still trace where expanded items came from.
- Computes effective scope from the filtering truth table, mode from
  `policy-mode`, and `effect`/`enforcement` for each selector.
- Fails loudly rather than guessing on malformed YAML, duplicate keys, duplicate
  policy identities, undefined lists/macros/states, or limit violations (more
  than five selectors or three actions).
- Records kernel-dependent items without pretending to resolve them:
  `generated_syscalls` and `generated_ftrace` lists become one hook entity with
  their pattern and a limitation note, and `matchCEL` stays opaque text.
- Keeps `${VAR}` placeholders literal and flags the policy as `templated`.

Because reading YAML executes no code, it requires no trust and safely inspects
untrusted fork pull requests using a base-defined extractor.

#### Version skew

Tetragon adds new spec fields frequently. Unrecognized fields shouldn't fail
extraction (a newer Tetragon version is valid), nor silently vanish (edits to
them would escape review). The extractor captures unknown fields per probe in
`data.unmodelled`, folds them into `specDigest` so changes still show up as
modifications, and notes them in `metadata.limitations`.

### Optional: validation against the repository's own CRD

Tetragon's authoritative validator is the CRD's OpenAPI schema plus CEL rules,
run by `pkg/tracingpolicy.FromYAML`
([`k8s.go`](https://github.com/cilium/tetragon/blob/9b905a6b2f0bf9a4f8585c37b9702a230320ac03/pkg/tracingpolicy/k8s.go#L36-L58),
[`nok8s.go`](https://github.com/cilium/tetragon/blob/9b905a6b2f0bf9a4f8585c37b9702a230320ac03/pkg/tracingpolicy/nok8s.go#L169-L200)).
There are two ways to tap into it, neither suitable as a default:

- **A Go helper calling `FromYAML`** requires the `github.com/cilium/tetragon`
  module. Fetching or bundling it violates our
  [runtime rule](../models/domain-model.md#runtime-requirements) against
  bundling third-party code, so it only makes sense as a trusted mode when the
  repository's own `go.mod` already depends on Tetragon.
- **The CRD's structural schema** is pure data. Setting `inputs.crdPath` to the
  repo's vendored CRD (such as a chart's `crds-yaml/`) validates against the
  exact Tetragon version deployed there with no trust needed. CEL rules
  (`x-kubernetes-validations`) aren't evaluated, and the extractor notes that.
  We shouldn't embed a copy of the CRD inside Projections, as it would pin the
  wrong version for most clusters.

Tetragon's `tetra` CLI currently lacks an offline validation command — its
`tracingpolicy` subcommands talk to a live agent
([`tracingpolicy.go`](https://github.com/cilium/tetragon/blob/9b905a6b2f0bf9a4f8585c37b9702a230320ac03/cmd/tetra/tracingpolicy/tracingpolicy.go)).

### Optional: rendering Helm and Kustomize (trusted)

Following
[`terraform-infrastructure`](../../packages/extractors/terraform-infrastructure/README.md),
we support two input modes:

- `renderedManifestsPath`: reads manifests already rendered by CI, requiring no
  trust.
- `helm: {chart, values, helmPath}` or `kustomize: {path, kustomizePath}`: runs
  the user's `helm template` (never `dependency update` or `install`) or
  `kustomize build` directly without a shell, then parses the output. This
  **requires `--trust`**, since templates can read files and Helm
  post-renderers/Kustomize plugins execute code.

### Multiple extractors

Every extractor emits the same vocabulary, differing only in
`policy.data.engine` and hook types:

- `tetragon-policies` (YAML): as described above.
- `kubearmor-policies` (`KubeArmor*Policy` YAML): creates implicit hooks per
  rule class (`hook:kubearmor:file`, `:process`, `:network`, `:capabilities`,
  `:syscalls`), maps `matchPaths`, `matchDirectories`, and `fromSource` to
  binary/path subjects, maps `Allow`/`Audit`/`Block` to `effect`, and sets
  `enforcement: posture-dependent` whenever effective behavior depends on
  namespace or global posture (with an optional input to supply that posture).
- `falco-rules` (Falco rules files, **trusted**): runs the user's `falco -L`
  with `json_output` enabled to dump every rule, macro, and list with resolved
  `details.events`, `condition_fields`, `macros`, and `exceptions`
  ([`falco_engine.cpp`](https://github.com/falcosecurity/falco/blob/master/userspace/engine/falco_engine.cpp),
  [options](https://github.com/falcosecurity/falco/blob/master/userspace/falco/app/options.cpp)).
  Events become `hook:syscall:<name>`, conditions stay opaque text, and `effect`
  is `observe` with `priority`. Trust is required because Falco configs can load
  shared-library plugins; parsing conditions ourselves would mean reimplementing
  Falco's grammar and `append`/`override` layering.

Validating one vocabulary across multiple extractors is what keeps it honest —
just as with dependency injection. KubeArmor forces us to handle external
posture, while Falco forces us to handle post-resolution hook sets and
observe-only rules.

---

## 6. Renderer

### Sample pull request

The files in [`ebpf-samples/`](ebpf-samples) model a realistic platform PR: it
kills `curl` and `wget` when they read the service account token, widens the
policy from `payments` to both `payments` and `checkout`, and removes the
`security_mmap_file` probe. That's 30 lines of YAML diff distilled into three
review sentences, and the samples pass Tetragon's `FromYAML` check at the pinned
commit.

### Diff view (default)

```
 Runtime security policies · base main ← head add-token-guard                [Diff] [Side by side]
 ─────────────────────────────────────────────────────────────────────────────────────────────────
 ▲ 1 newly enforced   ⇱ 1 scope broadened   − 1 hook no longer covered   · 1 unchanged hook
 ─────────────────────────────────────────────────────────────────────────────────────────────────
 POLICY  protect-credentials   TracingPolicy · mode enforce · all nodes
   applies to  pods where app.kubernetes.io/part-of = payments
           →   pods where app.kubernetes.io/part-of in (checkout, payments)          ⇱ BROADENED
 ─────────────────────────────────────────────────────────────────────────────────────────────────
 FILE · CREDENTIALS
 ┌ kprobe  security_file_permission                                       kernel-internal ────────┐
 │  WHO                          WHEN                                          EFFECT             │
 │  protect-credentials          file starts with /root/.ssh or /home          Observe            │
 │  any binary                   and arg 1 = 4                                                    │
 │+ protect-credentials          file starts with                               Kill (Sigkill) ▲  │
 │+ /usr/bin/curl, /usr/bin/wget   /var/run/secrets/kubernetes.io/serviceaccount                  │
 │                               and arg 1 = 4                                                    │
 │  ADDED · newly enforced · token-read-by-downloader                                           │
 │  ⚠ Sigkill without Override kills the process but doesn't guarantee the call is blocked.     │
 └───────────────────────────────────────────────────────────────────────────────────────────────┘
 ┌ kprobe  security_mmap_file                                             kernel-internal ────────┐
 │− protect-credentials          file starts with                               Observe            │
 │− any binary                     /var/run/secrets/kubernetes.io/serviceaccount                  │
 │  REMOVED · no longer covered by any policy                                                    │
 └───────────────────────────────────────────────────────────────────────────────────────────────┘
 NETWORK
 ┌ kprobe  tcp_connect                                                    kernel-internal ────────┐
 │  egress-audit (checkout)      destination not in 10.0.0.0/8, 127.0.0.1        Observe            │
 └───────────────────────────────────────────────────────────────────────────────────────────────┘
```

Design notes, consistent with our existing renderers:

- **Never rely on color alone.** Every change gets a gutter sign (`+`, `−`,
  `~`), a status badge (`ADDED`, `REMOVED`, `MODIFIED`), and a security
  interpretation badge (`newly enforced`, `broadened`, `no longer covered`).
  Effects are always spelled out (`Observe`, `Kill (Sigkill)`, `Deny (-1)`,
  `Elided: monitor mode`), with color as reinforcement.
- **Reserved status footers.** Each selector row reserves a fixed footer line
  for change and interpretation badges so nothing shifts when highlighting is
  toggled.
- **Typography.** Monospace for identifiers (hook targets, binaries, paths,
  labels, policy names); sans-serif for `WHO`/`WHEN`/`EFFECT`, badges, and
  prose.
- **Hook lanes grouped by category.** Each lane collects every selector from
  every policy attached to that hook so overlapping policies read side by side.
- **Quiet, sourced findings.** The `Sigkill` caveat comes straight from
  Tetragon's [enforcement](https://tetragon.io/docs/concepts/enforcement/) docs,
  alongside checks for `Override` on functions that may not support error
  injection, enforcement on `kernel-internal` hooks, and enforcement elided by
  `monitor` mode. Findings describe the after state (not diff marks) and stay
  visible at rest.
- **Argument display.** Uses `args[].label` when provided, otherwise falls back
  to `arg 1 = 4` without guessing kernel constants like `MAY_READ`.
- **Single-revision view** uses the exact same layout without diff marks to
  serve as a coverage map.

### Interpretation (comparator)

Phase 1 relies on the default comparator, where stable IDs already produce
accurate adds, removals, edits, and rewirings. Phase 2 adds a JavaScript
comparator (now the rules comparator `runtime-policy.comparator.yaml`) that:

- classifies changes as `newly-enforced`, `enforcement-removed`,
  `enforcement-elided` (mode flip), `newly-observed`, `coverage-lost` (no policy
  left on a hook), `scope-broadened`, `scope-narrowed`, `scope-changed` (when
  containment can't be proved), or `condition-changed`;
- marks scope broadened or narrowed only when provably sound — added `In`
  values, removed `matchLabels` keys, a dropped selector field, or
  `hostSelector` moving from `null` to `{}` — and falls back to `scope-changed`
  otherwise;
- orders enforcement changes first, then scope, coverage, and observation
  details, summarizing each step in one clear sentence ("curl and wget are now
  killed when they read the service account token in payments and checkout
  pods").

---

## 7. Risks and limits

- **Runtime-loaded policies and modes** (gRPC, `tetra tracingpolicy add`, or
  `set-mode` overriding the file). The repository isn't the whole runtime truth,
  so the projection's description makes clear it reviews declared intent.
- **Agent configuration** (`enablePolicyFilter`, persistent enforcement) can
  alter what a policy's scope means. Phase 4 adds an optional `agentValues`
  input to inspect the Tetragon chart's values and surface findings.
- **Helm, Kustomize, and `envsubst` templating.** Raw templates aren't valid
  policies on their own; we handle them via rendered-manifest import (no trust),
  `helm template`/`kustomize build` (trusted), and `templated` flags.
- **Kernel dependence.** Kprobe symbols vary across kernels and architectures
  ([kprobes](https://tetragon.io/docs/concepts/tracing-policy/hooks/#kprobes)),
  `Override` requires `CONFIG_BPF_KPROBE_OVERRIDE` and error-injectable
  functions (`security_` hooks need 5.7+ —
  [Override](https://tetragon.io/docs/concepts/tracing-policy/selectors/#override-action)),
  LSM hooks need `CONFIG_BPF_LSM`
  ([LSM BPF](https://tetragon.io/docs/concepts/tracing-policy/hooks/#lsm-bpf)),
  and selector limits differ before 5.3
  ([limitations](https://tetragon.io/docs/concepts/tracing-policy/selectors/#limitations)).
  A valid policy might fail to load or enforce on some nodes; we surface
  `stability` on every hook and, in phase 4, support an optional kernel profile
  input per node pool for derived findings.
- **`generated_*` lists, `matchCEL`, and `matchStates`** resolve only at load
  time, so we record them opaquely alongside explicit limitations.
- **`nodeSelector` and node labels** depend on live cluster state, and
  relabelling a node can unload enforcement. We display the selector on the
  policy and flag node-gated enforcement policies.
- **Binary paths** like `/usr/bin/curl` might not exist or might live at
  `/bin/curl` inside an image. Out of scope for now, though a future join with
  image metadata could check this.
- **Unlabelled selectors** fall back to positional identity; we use `label` when
  present and recommend it in docs.
- **Runtime behavior** (event volume, overhead, false positives, whether a
  selector ever triggers) is out of scope — static projections review intent,
  not live telemetry.

---

## Effort estimate

<!-- prettier-ignore -->
| Phase | Scope | Estimate |
|---|---|---|
| 0 | This proposal and samples | Done |
| 1 | `tetragon-policies` extractor (static YAML, lists, macros, scope, mode, effect, version skew), the vocabulary document, fixtures (our own, modelled on Tetragon's examples), engine conformance; presented by `architecture` and the host views | 1.5–2 weeks |
| 2 | `runtime-policy` renderer (diff, side-by-side, single revision, `scenarios.json`, browser suites in Chromium and WebKit, accessibility review) and the JavaScript comparator (now the rules comparator) | 2–3 weeks |
| 3 | `kubearmor-policies` (static) and `falco-rules` (trusted, the user's Falco); vocabulary revisions they force | 2–3 weeks |
| 4 | Enrichment: rendered Helm/Kustomize, `crdPath` validation, agent values, kernel profiles, and a workload × policy matrix from the repository's own workload manifests | 2–3 weeks |
| Later | Sibling projections: Cilium network policy (shared scope view), seccomp/AppArmor, and a hooks-only eBPF programs view from compiled objects | Separate proposals |

---

## Open questions

1. **Naming.** Should the projection be "Runtime security policies" with
   `runtime-policy`, or mention eBPF? Most engineers search by tool name
   (Tetragon, KubeArmor, Falco) rather than the underlying kernel mechanism.
2. **Vocabulary vs. schema.** Will `architecture/v0` still be enough after two
   extractors, or will `effect` and `enforcement` warrant Engine validation in a
   dedicated `runtime-policy/v0` schema?
3. **Workload resolution.** Should phase 4 join policies to in-repo Deployments
   and Pods, or does that imply a precision static analysis can't deliver when a
   cluster runs workloads from many repositories?
4. **Where findings live.** Derived findings (like the `Sigkill` caveat or
   monitor-elided enforcement) are useful but opinionated. Should they live in
   the extractor (`data.findings`), the comparator (summaries), or the renderer?
5. **Falco trust.** Is running the user's `falco -L` acceptable as a trusted
   native tool (since configs can load plugins), or should Falco wait for a
   dedicated static parser?
6. **Selector identity.** Should the extractor warn whenever a hook has multiple
   unlabelled selectors, since reordering them is ambiguous?
7. **Tetragon collaboration.** Since Tetragon has no offline validation CLI,
   would upstream accept something like `tetra tracingpolicy validate` backed by
   `FromYAML`? That would give every extractor authoritative validation via the
   user's own toolchain.
