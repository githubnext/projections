# Proposal: a runtime security policy projection (Tetragon and eBPF)

> **Current state:** accepted and built for Tetragon (phases 1, 2 and 4). The
> "JavaScript comparator" proposed below is now the rules comparator
> [`runtime-policy.comparator.yaml`](../../packages/comparators/runtime-policy/runtime-policy.comparator.yaml);
> the rest records the research and plan as proposed.

Status: **accepted** for Tetragon. It records research into what a projection
for Tetragon, and eBPF-based runtime security more broadly, could show in a pull
request, and recommends a phased plan.

Decisions: phases 1, 2 and 4 are in scope for Tetragon. Other engines
(KubeArmor, Falco, Tracee, Cilium, seccomp and AppArmor, raw eBPF programs) are
deferred, so phase 3 is not planned yet. The model and renderer stay named and
structured around generic runtime security policies so they can be added later.
The phase 2 comparator, proposed below in JavaScript, shipped as JavaScript and
is now a comparator file,
[`runtime-policy.comparator.yaml`](../../packages/comparators/runtime-policy/runtime-policy.comparator.yaml),
since comparator files became the only custom comparators. The adopted
vocabulary is
[one model for runtime security policies](../models/runtime-policy-model.md);
where it differs from the sketch below (notably IDs), the model document is
authoritative. Phases 1, 2 and 4 are implemented: the
[`tetragon-policies`](../../packages/extractors/tetragon-policies/README.md)
extractor (with Helm and Kustomize rendering, CRD validation, agent values,
kernel profiles and workloads), the
[`runtime-policy`](../../packages/renderers/runtime-policy/README.md) renderer
and the
[runtime policy comparator](../../packages/comparators/runtime-policy/README.md).

Tetragon facts are taken from `cilium/tetragon` at commit
[`9b905a6`](https://github.com/cilium/tetragon/tree/9b905a6b2f0bf9a4f8585c37b9702a230320ac03)
(Helm chart and app version 1.8.0, 4 November 2026) and from the
[Tetragon documentation](https://tetragon.io/docs/). Links to source are pinned
to that commit. Several fields this proposal relies on (`matchWorkloads`,
`nodeSelector`, selector `label`, `fentries`, `state`) are recent, so the
extractor must tolerate policies written for older and newer Tetragon versions
(see [version skew](#version-skew)).

---

## Summary recommendation

Build a **runtime policy projection** whose first extractor statically reads
Tetragon `TracingPolicy` and `TracingPolicyNamespaced` YAML from the repository,
and whose presentation answers one question per change: **what does this pull
request newly observe, newly enforce, stop covering, or apply to a different set
of workloads?**

1. **Data model: `architecture/v0` with a documented vocabulary**, exactly as
   [dependency injection](../models/dependency-injection-model.md) did, rather
   than a new domain schema. Entities are `policy`, `probe`, `hook`, `selector`
   and `subject`; the security meaning (observe vs enforce, effective mode,
   scope) lives in `data`. A new domain schema is only justified later if the
   Engine needs to validate these fields.
2. **Extractor: a built-in Rust `tetragon-policies` extractor that parses YAML
   and needs no trust.** The checked-in YAML _is_ the policy; nothing needs to
   be compiled or executed to know what it says. Helm or Kustomize rendering is
   an optional, trusted input mode, like `terraform-infrastructure`'s native
   mode.
3. **Renderer: a new `runtime-policy` renderer**, a static diff (plus
   side-by-side) of _hook lanes_: who a rule applies to on the left, the
   condition in the middle, the effect on the right. Until it exists, the graph
   renderer's `architecture` presentation and the host's table and text views
   present the extraction adequately.
4. **Comparator: a JavaScript comparator** (phase 2; built, and now the rules
   comparator `runtime-policy.comparator.yaml`) that interprets changes in
   security terms (escalated to enforcement, scope broadened, coverage lost) and
   orders the riskiest first.
5. **Second and third extractors: KubeArmor, then Falco.** KubeArmor has the
   closest typed structure (paths, processes, network and capabilities × label
   selectors × `Allow`/`Audit`/`Block`) and stresses the model with posture
   configured outside the file. Falco stresses the _observe-only_ end and
   condition-language indirection, and has an offline, official way to resolve
   it (`falco -L` with JSON output). Cilium network policies are a sibling
   projection that reuses the scope vocabulary, not a third extractor for this
   one. Raw eBPF programs fit only as a hooks-only "eBPF programs" view.

---

## Target users and the questions it answers

- **Platform and security engineers** who own the cluster's Tetragon policies,
  typically in a GitOps repository (`clusters/…/tetragon/*.yaml`, a Helm chart
  or Kustomize overlays): Does this change kill or deny anything new? In which
  namespaces and workloads? Did someone switch a policy from `monitor` to
  `enforce`? Did we lose coverage of a hook?
- **Application teams** shipping a `TracingPolicyNamespaced` with their service,
  typically in the service repository's `deploy/` directory: Will my new binary
  or file path be killed by an existing policy? Which of my workloads does this
  policy now cover?
- **Detection engineers** curating a policy library, typically in a library of
  policies, often derived from Tetragon's
  [`examples/policylibrary`](https://github.com/cilium/tetragon/tree/9b905a6b2f0bf9a4f8585c37b9702a230320ac03/examples/policylibrary):
  Which kernel hooks and syscalls does the library observe, by category? What
  did this pull request add or remove? Are hooks portable (tracepoints, LSM) or
  kernel-specific (kprobes)?
- **Reviewers who aren't kernel experts**, typically in any of the above: A
  plain-language account of a 200-line YAML change whose effect is decided by
  `AND`/`OR` rules across nested lists.

The last group matters most. Tetragon's own documentation warns that
`TracingPolicy` is "powerful, yet low-level configuration" that "requires
knowledge about the Linux kernel and containers"
([tracing policy](https://tetragon.io/docs/concepts/tracing-policy/)). The line
diff of a policy shows that a list item moved; it doesn't show that a `Sigkill`
now applies to every pod labelled `checkout`.

---

## 1. What's in a repository

### TracingPolicy and TracingPolicyNamespaced

Both kinds are `cilium.io/v1alpha1` custom resources with the same spec; the
namespaced kind applies only to pods in its namespace and rejects a non-null
`hostSelector`
([`tracing_policy_types.go`](https://github.com/cilium/tetragon/blob/9b905a6b2f0bf9a4f8585c37b9702a230320ac03/pkg/k8s/apis/cilium.io/v1alpha1/tracing_policy_types.go#L56-L140),
[Kubernetes filtering](https://tetragon.io/docs/concepts/tracing-policy/k8s-filtering/)).
The spec contains:

- **Hooks**: `kprobes`, `fentries`, `tracepoints`, `lsmhooks`, `uprobes`,
  `usdts` (at most 128 each). _Where_ in the kernel or in user binaries the
  policy attaches
  ([hooks](https://tetragon.io/docs/concepts/tracing-policy/hooks/)).
- **Selectors** per hook: at most 5, **OR**ed; within a selector, filters are
  **AND**ed
  ([selector semantics](https://tetragon.io/docs/concepts/tracing-policy/selectors/#selector-semantics)).
  _When_ it acts: `matchArgs`, `matchData`, `matchReturnArgs`, `matchCmdArgs`,
  `matchBinaries`, `matchParentBinaries`, `matchPIDs`, `matchNamespaces`,
  `matchNamespaceChanges`, `matchCapabilities`, `matchCapabilityChanges`,
  `matchWorkloads`, `matchUserCallers`, `matchStates`, `matchCEL`, `macros`
  ([`KProbeSelector`](https://github.com/cilium/tetragon/blob/9b905a6b2f0bf9a4f8585c37b9702a230320ac03/pkg/k8s/apis/cilium.io/v1alpha1/types.go#L155-L230)).
- **Actions** per selector: `matchActions` (at most 3), `matchReturnActions`:
  `Post`, `NoPost`, `Sigkill`, `Signal`, `Override`, `NotifyEnforcer`, `GetUrl`,
  `DnsLookup`, `TrackSock`, `UntrackSock`, `Set`, `UpdateState`,
  `CleanupEnforcerNotification`
  ([`ActionSelector`](https://github.com/cilium/tetragon/blob/9b905a6b2f0bf9a4f8585c37b9702a230320ac03/pkg/k8s/apis/cilium.io/v1alpha1/types.go#L384-L386)).
  _What happens_. Without actions a hook posts an event: `Post` is the default
  ([Post action](https://tetragon.io/docs/concepts/tracing-policy/selectors/#post-action)).
- **Workload scope**: `podSelector`, `containerSelector`, `hostSelector` (`null`
  or `{}` only), and per selector `matchWorkloads`. _Who_ it applies to, with an
  eight-row truth table; all three omitted means every host and pod workload
  ([filtering semantics](https://tetragon.io/docs/concepts/tracing-policy/k8s-filtering/#filtering-semantics)).
- **Node scope**: `nodeSelector`. _Where_ the agent loads the policy at all;
  fails open; a relabelled node can unload an enforcement policy
  ([node filtering](https://tetragon.io/docs/concepts/tracing-policy/k8s-filtering/#node-filtering)).
- **Mode**: `options: [{name: policy-mode, value: enforce | monitor}]`. In
  `monitor` mode "enforcement operations are elided"
  ([enforcement mode](https://tetragon.io/docs/concepts/tracing-policy/mode/)).
- **Indirection**: `lists` (`call: "list:dups"`), `selectorsMacros`,
  `enforcers`, `state`. Lists expand to one hook per value; `generated_syscalls`
  and `generated_ftrace` lists are generated from the running kernel
  ([lists](https://tetragon.io/docs/concepts/tracing-policy/hooks/#lists),
  [selector macros](https://tetragon.io/docs/concepts/tracing-policy/hooks/#selectors-macros)).

### Where policies come from

- **Plain manifests** applied with `kubectl` or a GitOps controller. This is the
  common case and the one Tetragon's guides use.
- **Policy libraries.** Tetragon's curated
  [policy library](https://tetragon.io/docs/policy-library/) and its broader
  [`examples/tracingpolicy`](https://github.com/cilium/tetragon/tree/9b905a6b2f0bf9a4f8585c37b9702a230320ac03/examples/tracingpolicy)
  directory are what teams copy and adapt.
- **Helm charts and Kustomize overlays** that wrap policies, often to vary scope
  or mode per environment.
- **`envsubst`-style templates.** Tetragon's own enforcement quick start pipes a
  policy containing `${PODCIDR}` and `${SERVICECIDR}` through `envsubst`
  ([policy enforcement](https://tetragon.io/docs/getting-started/enforcement/)).
- **Static files for non-Kubernetes hosts**, loaded at startup from
  `/etc/tetragon/tetragon.tp.d/` or `--tracing-policy-dir`
  ([daemon configuration](https://tetragon.io/docs/reference/daemon-configuration/#configure-tracing-policies-location)),
  typically laid down by configuration management. Same YAML; Kubernetes scope
  fields don't apply.
- **Tetragon's Helm values** (`tetragon.enablePolicyFilter`, export allow and
  deny lists). `enablePolicyFilter` "is required for K8s namespace and pod-label
  filtering"
  ([`values.yaml`](https://github.com/cilium/tetragon/blob/9b905a6b2f0bf9a4f8585c37b9702a230320ac03/install/kubernetes/tetragon/values.yaml#L305-L306)),
  so agent configuration can change what a policy's scope means.

Policies are **not** always in the repository: `tetra tracingpolicy add` loads
them over gRPC, and `tetra tracingpolicy set-mode` changes a loaded policy's
mode at runtime with higher priority than the file's own `policy-mode`
([enforcement mode](https://tetragon.io/docs/concepts/tracing-policy/mode/)). A
projection reviews what the repository declares, never what a cluster runs.

---

## 2. Which eBPF artifacts are reviewable from source

- **Tetragon TracingPolicy**. Stable, parseable structure: Yes: a CRD with an
  OpenAPI schema
  ([CRD](https://github.com/cilium/tetragon/blob/9b905a6b2f0bf9a4f8585c37b9702a230320ac03/pkg/k8s/apis/cilium.io/client/crds/v1alpha1/cilium.io_tracingpolicies.yaml)).
  Hooks: Explicit, typed. Scope: Explicit (label selectors, namespaces,
  binaries). Actions and enforcement: Explicit, plus a mode. Verdict: **Primary
  source**.
- **KubeArmor** `KubeArmorPolicy`, `KubeArmorHostPolicy`,
  `KubeArmorClusterPolicy` (`security.kubearmor.com/v1`). Stable, parseable
  structure: Yes: CRD with an `Allow`/`Audit`/`Block` enum
  ([CRD](https://github.com/kubearmor/KubeArmor/blob/main/deployments/CRD/KubeArmorPolicy.yaml),
  [spec](https://docs.kubearmor.io/kubearmor/documentation/security_policy_specification)).
  Hooks: Implicit (LSM-backed process, file, network, capability, syscall
  rules). Scope: Explicit labels; `fromSource` binaries. Actions and
  enforcement: Explicit, but the default posture is set per namespace or
  globally, outside the file
  ([default posture](https://docs.kubearmor.io/kubearmor/documentation/default_posture)).
  Verdict: **Best second extractor**.
- **Falco rules**. Stable, parseable structure: Partly: YAML of `rule`, `macro`,
  `list`; the hook and scope live inside a `condition` expression
  ([rules](https://falco.org/docs/concepts/rules/),
  [overriding](https://falco.org/docs/concepts/rules/overriding/)). Hooks: Event
  types, resolved only after macro expansion. Scope: Inside the condition.
  Actions and enforcement: Observe and alert only (`priority`); response is a
  separate system. Verdict: **Good third extractor**, through the user's own
  Falco ([below](#multiple-extractors)).
- **Aqua Tracee** `Policy` (`tracee.aquasec.com/v1beta1`). Stable, parseable
  structure: Yes, but the CRD types actions as free strings
  ([CRD](https://github.com/aquasecurity/tracee/blob/main/deploy/helm/tracee/crds/tracee.aquasec.com_policies.yaml)).
  Hooks: Events. Scope: `scope`. Actions and enforcement: `log`, `forward`,
  `webhook`: detection only
  ([actions](https://aquasecurity.github.io/tracee/v0.16/docs/policies/actions/)).
  Verdict: Possible later; adds little over Falco.
- **Cilium** `CiliumNetworkPolicy`, `CiliumClusterwideNetworkPolicy`, Kubernetes
  `NetworkPolicy`. Stable, parseable structure: Yes: CRDs
  ([policy](https://docs.cilium.io/en/stable/network/kubernetes/policy/)).
  Hooks: None: L3/L4/L7 peers and ports, not kernel hooks. Scope:
  `endpointSelector`. Actions and enforcement: Allow rules, explicit deny
  ([deny policies](https://docs.cilium.io/en/stable/security/policy/deny/)), and
  _emergent_ default deny once any policy selects an endpoint. Verdict:
  **Sibling projection** ("network policy"), sharing the scope vocabulary and
  scope view.
- **Seccomp profiles** (Security Profiles Operator `SeccompProfile`) and
  **AppArmor** profiles. Stable, parseable structure: Yes
  ([seccomp](https://kubernetes.io/docs/tutorials/security/seccomp/),
  [SPO example](https://github.com/kubernetes-sigs/security-profiles-operator/blob/main/examples/seccompprofile.yaml)).
  Hooks: Syscalls; files, capabilities, network. Scope: External (the pod's
  `securityContext` names the profile). Actions and enforcement: `SCMP_ACT_*`;
  `allow`/`deny`/`audit`. Verdict: Fits the model with a scope join to workload
  manifests; later.
- **libbpf C**, **cilium/ebpf** (`bpf2go`), **Aya**, **bpftrace**. Stable,
  parseable structure: Hooks only. Hooks: `SEC("kprobe/…")` section names in the
  compiled object
  ([libbpf program types](https://docs.kernel.org/bpf/libbpf/program_types.html),
  [ebpf-go section naming](https://ebpf-go.dev/concepts/section-naming/)); Aya
  attribute macros
  ([`#[lsm]`](https://docs.rs/aya-ebpf-macros/latest/aya_ebpf_macros/attr.lsm.html));
  bpftrace probe specifiers. Scope: None: filtering is program logic and map
  contents. Actions and enforcement: None: verdicts are program logic. Verdict:
  A separate hooks-only **eBPF programs** view, read from compiled objects.

For raw eBPF programs, a section name is a _default_ attach target. User-space
code can attach a program elsewhere (`link.Kprobe(sym, …)`,
`bpf_program__attach_kprobe`), choose targets conditionally, or use wildcards
(bpftrace), and CO-RE relocations are resolved against the target kernel. The
honest static fact is "this object contains a program of type kprobe whose
default target is `do_sys_openat2`". Reading it from the compiled ELF, rather
than from C or Rust source with patterns, follows the
[extractor rule](../../packages/extractors/README.md#ecosystem-extractors)
against source-regex approximations, and requires building the program (trusted)
or a checked-in object.

---

## 3. What a reviewer wants to see change

Four candidate views, in order of value:

- **Enforcement diff**: What is newly killed, denied or signalled; what stopped
  being enforced; did a policy's mode change? Highest value, smallest surface: a
  pull request that adds a `Sigkill` should never look like a routine YAML edit.
  The default view.
- **Coverage map**: Which hooks, syscalls and functions are observed or
  enforced, grouped by category (file, process, credentials, network, kernel
  modules, BPF)? What is newly covered or no longer covered? The single-revision
  view: living documentation of what a cluster watches. The same layout carries
  the enforcement diff.
- **Selector scope**: Which workloads, namespaces, binaries and nodes does each
  policy apply to, and did that broaden or narrow? Security-relevant and
  invisible in a line diff (removing one `matchLabels` line broadens a policy to
  every pod). Phase 1 shows each policy's scope as text with old → new; a
  workload × policy matrix needs concrete workloads
  ([phase 4](#effort-estimate)).
- **Event flow**: hook → selector → action, as a graph. Faithful but noisy: one
  policy with 3 hooks × 5 selectors × 3 actions is 30 edges. Useful as a
  fallback through the existing graph renderer, not as the primary view.

### Existing renderers

<!-- prettier-ignore -->
| Renderer | Fit | Gap |
|---|---|---|
| [`graph`](../../packages/renderers/graph/README.md) (`architecture`) | Works on day one for the event-flow view | Dense; no notion of effect, mode or scope |
| [`graph`](../../packages/renderers/graph/README.md) (`infrastructure`) | Wording each change as an action in the card's status footer is the right *interaction* for enforcement changes | It keys on the [infrastructure model](../models/infrastructure-model.md)'s `data.action`; reusing it would overload deployment verbs |
| `messaging` (since removed) | The closest *layout*: one lane per event, sources on the left, consumers on the right, `diff` and `side-by-side` | Kinds and semantics differ |
| `conventions` (`flags`, since removed) | Card per item with consumers | Cards don't express effect or scope |
| Host table and text views | Always available and accessible | No grouping by hook or effect |

**Recommendation: a new `runtime-policy` renderer**, built on the
[renderer kit](../../packages/renderers/kit/README.md), borrowing the former
messaging renderer's lane layout and the plan renderer's static diff
conventions. It declares `diff` (default) and `side-by-side`, and no `animated`
mode: the content is lists and cards, so a scrubbed transition would only pop
rows in and out.

---

## 4. Data model

### Schema choice

Use **`architecture/v0`**, which "places no further constraints on kinds"
([contracts](../contracts/extractions.md)), with a vocabulary document
(`docs/models/runtime-policy-model.md`) in the style of the
[dependency-injection model](../models/dependency-injection-model.md). A new
`runtime-policy/v0` domain schema would require Engine changes
([`SCHEMAS`](../../packages/engine/src/validate/mod.rs)) and a protocol
decision, and it buys only Engine-side validation of a few enums. Revisit after
the second extractor if the vocabulary has settled and validation is wanted.

### Entities

- `policy`: One policy resource. IDs: `policy:tetragon:TracingPolicy:<name>`,
  `policy:tetragon:TracingPolicyNamespaced:<ns>/<name>`. Key `data`: `engine`
  (`tetragon`), `resource`, `name`, `namespace`, `path`, `mode` (`enforce`,
  `monitor` or `unset`), `modeSource`, `nodeSelector` (canonical text), `scope`
  (canonical text), `templated`.
- `hook`: An attach point, **shared across policies** so two policies on one
  function converge. IDs: `hook:kprobe:security_file_permission`,
  `hook:tracepoint:syscalls/sys_enter_openat`, `hook:lsm:file_open`,
  `hook:uprobe:/usr/bin/bash:readline`, `hook:usdt:<path>:<provider>:<name>`.
  Key `data`: `hookType`, `target`, `syscall`, `binary` (uprobes), `stability`
  (`stable` for tracepoints, `lsm`, `kernel-internal` for kprobes and fentries,
  `user` for uprobes), `category` (derived; see below).
- `probe`: One policy's specification on one hook: a `kprobes[]` item, or one
  expanded list value. IDs: `probe:<policy>/<hookType>:<target>`, `#2` appended
  for a repeated target. Key `data`: `message`, `tags`, `args` (index, type,
  label), `return`, `viaList`, `specDigest`, `unmodelled`.
- `selector`: One selector of a probe. IDs: `selector:<probe>/<label>` when
  `label` is set, else `selector:<probe>/#<ordinal>`; a probe without selectors
  gets one `implicit` selector `…/*`. Key `data`: `label`, `conditions`
  (normalized filters as structured objects and display text), `actions` (each
  with its arguments), `effect`, `enforcement`, `macros`, `cel`.
- `subject`: Something a policy or selector applies to. IDs:
  `subject:pods:<canonical selector>`, `subject:namespace:<ns>`,
  `subject:containers:<selector>`, `subject:host`, `subject:all-workloads`,
  `subject:binary:<path>`. Key `data`: `subjectKind`, `selector` (structured),
  `display`.

`effect` is the strongest declared consequence of a selector:

| `effect`  | Actions                                                        |
| --------- | -------------------------------------------------------------- |
| `enforce` | `Sigkill`, `Signal`, `Override`, `NotifyEnforcer`              |
| `respond` | `GetUrl`, `DnsLookup` (user space, after the event)            |
| `observe` | `Post`, explicit or default                                    |
| `track`   | `TrackSock`, `UntrackSock`, `Set`, `UpdateState` with `NoPost` |
| `silent`  | `NoPost` alone                                                 |

`enforcement` is what actually happens given the policy's mode: `active`,
`elided` (an enforcing selector in a `monitor` policy) or `none`. Keeping both
lets a reviewer see a mode flip as "3 selectors start enforcing" rather than as
a single changed option.

`category` (`file`, `credentials`, `process`, `network`, `kernel-modules`,
`bpf`, `namespaces`, `other`) comes from a small built-in table of well-known
functions and syscalls (`security_file_*`, `fd_install`, `tcp_connect`,
`commit_creds`, `sys_setuid`, …) and the probe's `tags`, with
`confidence: derived`. Unknown targets are `other`.

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

- Policies are identified by kind, namespace and name, as Kubernetes identifies
  them. Moving a policy between files changes `data.path` only. Renaming one is
  a remove and an add unless the definition's `correspondence` declares it.
- Hooks are identified by type and target, independent of policy, so coverage is
  a union across policies. Tetragon allows independent policies to hook the same
  function
  ([kprobes](https://tetragon.io/docs/concepts/tracing-policy/hooks/#kprobes))
  and has no precedence between them, so union is the correct reading. (Network
  policy has precedence; that is one reason it is a sibling projection.)
- **Selectors are the weak point.** They are an ordered list with no name, so
  inserting one before others would renumber them. Tetragon's optional selector
  `label`, "used in status and metrics"
  ([`types.go`](https://github.com/cilium/tetragon/blob/9b905a6b2f0bf9a4f8585c37b9702a230320ac03/pkg/k8s/apis/cilium.io/v1alpha1/types.go#L156-L158)),
  gives stable identity; the extractor uses it when present and the
  documentation recommends it. The bound is small (at most five selectors per
  hook), and the comparator never matches selectors by content: an unlabelled
  selector that moved is reported as modified in place, which is truthful about
  ordinal identity.
- Workload subjects are identified by a canonical rendering of the selector
  (sorted keys, sorted `In` values), so equivalent spellings converge and the
  scope relationship's rewiring carries the change.

### Example extraction

The head revision of the [sample pull request](#sample-pull-request) (the
unchanged `egress-audit` policy omitted for brevity):

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

- Reads repository-relative files matching `paths` (multi-document YAML), keeps
  documents whose `apiVersion` is `cilium.io/v1alpha1` and whose kind is
  `TracingPolicy` or `TracingPolicyNamespaced`, and ignores other kinds.
- Expands `list:` references and `selectorsMacros`, recording `viaList` and
  `macros` so the source of each expanded item stays visible.
- Computes effective scope from the filtering truth table, mode from
  `policy-mode`, and `effect` and `enforcement` per selector.
- Fails, rather than guessing, on malformed YAML, duplicate keys, two policies
  with the same identity, references to undefined lists, macros or states, and
  violations of documented limits (five selectors, three actions).
- Records rather than resolves what only a running kernel knows:
  `generated_syscalls` and `generated_ftrace` lists become one hook entity with
  the pattern and a limitation; `matchCEL` is kept as opaque text.
- Treats `${VAR}` placeholders as literal values and marks the policy
  `templated`.

Reading YAML runs nothing, so it needs no trust and can examine an untrusted
fork's pull request with a base-defined extractor.

#### Version skew

Tetragon adds fields often. A field the extractor doesn't model must neither
fail the extraction (a newer Tetragon is valid) nor vanish (a change to it would
go unreviewed). The extractor therefore records unknown fields per probe in
`data.unmodelled`, includes them in `specDigest` so a change still marks the
probe modified, and lists them in `metadata.limitations`.

### Optional: validation against the repository's own CRD

Tetragon's authoritative validation is the CRD's OpenAPI schema plus CEL rules,
which `pkg/tracingpolicy.FromYAML` applies
([`k8s.go`](https://github.com/cilium/tetragon/blob/9b905a6b2f0bf9a4f8585c37b9702a230320ac03/pkg/tracingpolicy/k8s.go#L36-L58),
[`nok8s.go`](https://github.com/cilium/tetragon/blob/9b905a6b2f0bf9a4f8585c37b9702a230320ac03/pkg/tracingpolicy/nok8s.go#L169-L200)).
Two ways to use it, and why neither is the default:

- **A Go helper calling `FromYAML`** would need the `github.com/cilium/tetragon`
  module. Downloading or bundling it breaks the
  [runtime rule](../models/domain-model.md#runtime-requirements) that helpers
  use the project's toolchain and never fetch or bundle third-party code. It is
  acceptable only when the repository's own `go.mod` already requires Tetragon
  (for example, a platform team's policy tests), as a trusted mode.
- **The CRD's structural schema** is data, not code. An `inputs.crdPath`
  pointing at the repository's own copy (for example a vendored chart's
  `crds-yaml/`) lets the extractor validate against the Tetragon version the
  repository deploys, without trust. CEL rules (`x-kubernetes-validations`)
  aren't evaluated; the extractor says so. Projections should not embed a copy
  of the CRD: it would pin a version the repository may not run.

Tetragon's `tetra` CLI has no offline validation command; its `tracingpolicy`
subcommands talk to a running agent
([`tracingpolicy.go`](https://github.com/cilium/tetragon/blob/9b905a6b2f0bf9a4f8585c37b9702a230320ac03/cmd/tetra/tracingpolicy/tracingpolicy.go)).

### Optional: rendering Helm and Kustomize (trusted)

As with
[`terraform-infrastructure`](../../packages/extractors/terraform-infrastructure/README.md),
two input modes:

- `renderedManifestsPath`: import manifests CI has already rendered. No trust.
- `helm: {chart, values, helmPath}` or `kustomize: {path, kustomizePath}`: run
  the user's `helm template` (never `dependency update` or `install`) or
  `kustomize build`, without a shell, then parse the output. **Requires
  `--trust`**: templates read files, and Helm post-renderers and Kustomize
  plugins execute code.

### Multiple extractors

All extractors write the same vocabulary; only `policy.data.engine` and the hook
types differ.

- `tetragon-policies`, reading YAML: As above.
- `kubearmor-policies`, reading `KubeArmor*Policy` YAML: Implicit hooks per rule
  class (`hook:kubearmor:file`, `:process`, `:network`, `:capabilities`,
  `:syscalls`); `matchPaths`, `matchDirectories`, `fromSource` → binary and path
  subjects; `Allow`/`Audit`/`Block` → `effect`; `enforcement: posture-dependent`
  where the effective action depends on namespace or global posture, with an
  optional input naming the posture.
- `falco-rules`, reading Falco rules files (trust: **Yes**): Runs the user's
  `falco -L` with `json_output` enabled, which prints every rule, macro and list
  with resolved `details.events`, `condition_fields`, `macros` and `exceptions`
  ([`falco_engine.cpp`](https://github.com/falcosecurity/falco/blob/master/userspace/engine/falco_engine.cpp),
  [options](https://github.com/falcosecurity/falco/blob/master/userspace/falco/app/options.cpp)).
  Events become `hook:syscall:<name>` hooks; the condition is opaque text;
  `effect` is `observe` with `priority`. Trusted because Falco may load plugins
  (shared libraries) named by configuration. Parsing conditions ourselves would
  reimplement Falco's grammar and its `append`/`override` layering.

Two extractors writing one model is what tests it, as it did for dependency
injection. KubeArmor forces "effective action depends on state outside the
file". Falco forces "a hook set that is only known after resolution" and "no
enforcement at all".

---

## 6. Renderer

### Sample pull request

The samples in [`ebpf-samples/`](ebpf-samples) are a realistic pull request to a
platform repository: it kills `curl` and `wget` when they read the service
account token, extends the policy from `payments` to `payments` and `checkout`
workloads, and drops the `security_mmap_file` probe. The line diff is 30 lines
of YAML; the review questions are three sentences. The samples pass Tetragon's
own `FromYAML` validation at the pinned commit.

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

Design notes, following the existing renderers' conventions:

- **Never color alone.** Every change has a sign in a fixed gutter (`+`, `−`,
  `~`), a text badge (`ADDED`, `REMOVED`, `MODIFIED`), and, for security
  interpretation, a second text badge (`newly enforced`, `broadened`,
  `no longer covered`). Effect is always a word (`Observe`, `Kill (Sigkill)`,
  `Deny (-1)`, `Elided: monitor mode`), with the color as reinforcement.
- **Status footers are reserved.** Each selector row has a fixed footer line for
  its change and interpretation badges so badges never shift layout; with
  highlighting off or at an endpoint it is empty.
- **Mono for identifiers**: hook targets, binaries, paths, labels and policy
  names. Sans for `WHO`/`WHEN`/`EFFECT`, badges and sentences.
- **Hooks are lanes, grouped by category**; a lane holds every selector of every
  policy on that hook, so two policies on one function read together.
- **Findings are derived, quiet and sourced.** The `Sigkill` caveat comes from
  Tetragon's [enforcement](https://tetragon.io/docs/concepts/enforcement/)
  documentation; others: `Override` on a function that may not allow error
  injection, enforcement on a `kernel-internal` hook, enforcement elided by
  `monitor` mode. They describe the after state and stay visible after the
  comparison ends; they are not diff marks.
- **Arguments are shown by label when the policy gives one** (`args[].label`),
  otherwise by index (`arg 1 = 4`); the renderer doesn't guess kernel semantics
  such as `MAY_READ`.
- **Single revision** is the same layout without change marks: the coverage map.

### Interpretation (comparator)

Phase 1 uses the default comparator: IDs give correct added, removed, modified
and rewired items. Phase 2 adds a JavaScript comparator (historical: it is now
the rules comparator `runtime-policy.comparator.yaml`) that:

- classifies each change as `newly-enforced`, `enforcement-removed`,
  `enforcement-elided` (mode flip), `newly-observed`, `coverage-lost` (a hook no
  policy attaches any more), `scope-broadened`, `scope-narrowed`,
  `scope-changed` (when containment isn't decidable), or `condition-changed`;
- decides broadened or narrowed only where it is sound: added `In` values,
  removed `matchLabels` keys, a removed selector field, `hostSelector` from
  `null` to `{}`; otherwise `scope-changed`;
- orders enforcement first, then scope, then coverage, then observation details,
  and writes one sentence per step ("curl and wget are now killed when they read
  the service account token in payments and checkout pods").

---

## 7. Risks and limits

- Policies loaded at runtime (gRPC, `tetra tracingpolicy add`) or modes set at
  runtime (`set-mode` outranks the file). The repository isn't the whole truth.
  Mitigation: State it in the projection's description; the projection reviews
  declared intent.
- Agent configuration (`enablePolicyFilter`, persistent enforcement). Scope can
  mean something different from what the policy says. Mitigation: Phase 4: an
  optional `agentValues` input reads the Tetragon chart's values and adds
  findings.
- Helm, Kustomize and `envsubst` templating. Raw templates aren't policies.
  Mitigation: Rendered-manifest import (no trust), `helm template` and
  `kustomize build` (trust), `templated` marking.
- Kernel dependence: kprobe symbols differ across kernels and architectures
  ([kprobes](https://tetragon.io/docs/concepts/tracing-policy/hooks/#kprobes));
  `Override` needs `CONFIG_BPF_KPROBE_OVERRIDE` and error-injectable functions,
  and `security_` hooks need 5.7+
  ([Override](https://tetragon.io/docs/concepts/tracing-policy/selectors/#override-action));
  LSM hooks need `CONFIG_BPF_LSM`
  ([LSM BPF](https://tetragon.io/docs/concepts/tracing-policy/hooks/#lsm-bpf));
  limits differ before 5.3
  ([limitations](https://tetragon.io/docs/concepts/tracing-policy/selectors/#limitations)).
  A valid-looking policy may not load, or not enforce, on some nodes.
  Mitigation: `stability` on every hook; phase 4: an optional kernel profile
  input (symbols, error-injection list, config) per node pool, producing derived
  findings.
- `generated_*` lists, `matchCEL`, `matchStates`. Coverage or conditions known
  only at load time. Mitigation: Recorded as opaque, with limitations.
- `nodeSelector` and node labels. Where a policy loads depends on cluster state;
  relabelling can unload enforcement. Mitigation: Shown as text on the policy;
  finding when an enforcing policy is node-gated.
- Binary paths. `/usr/bin/curl` in a selector may not exist in an image, or may
  be `/bin/curl`. Mitigation: Out of scope; possible later join with image
  metadata.
- Selector identity. Unlabelled selectors are identified by position.
  Mitigation: Use `label`; recommend it in documentation.
- What a static diff can't show. Event volume, overhead, false positives,
  whether a selector ever matches. Mitigation: Out of scope; this is review of
  intent, not of behavior.

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

1. **Name.** "Runtime security policies" for the projection and `runtime-policy`
   for the renderer, or something that names eBPF? Most users think in terms of
   the tool (Tetragon, KubeArmor, Falco), not the mechanism.
2. **Vocabulary versus schema.** Is the `architecture/v0` vocabulary enough
   after two extractors, or do `effect` and `enforcement` deserve Engine
   validation in a `runtime-policy/v0` schema?
3. **Workload resolution.** Should the scope view join policies to the
   repository's own Deployments and Pods (phase 4), or would that imply a
   precision static analysis can't deliver for clusters with workloads from many
   repositories?
4. **Findings.** Derived findings (the `Sigkill` caveat, monitor-elided
   enforcement) are valuable but opinionated. Do they belong in the extractor
   (`data.findings`), the comparator (summaries), or the renderer?
5. **Falco trust.** Is running the user's `falco -L` acceptable as a trusted
   native tool, given that it may load plugins, or should Falco wait for a
   static parser of its own?
6. **Selector identity.** Should the extractor warn when a hook has several
   unlabelled selectors, since reordering them is ambiguous?
7. **Tetragon collaboration.** Tetragon has no offline validation command. Would
   upstream accept one (for example `tetra tracingpolicy validate` using
   `FromYAML`)? That would give every extractor authoritative validation through
   the user's toolchain.
