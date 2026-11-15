---
description: "Tetragon tracing policies' hooks and effects (architecture/v0)"
---

# Tetragon policies — `architecture/v0`

`tetragon-policies` reads Tetragon
[`TracingPolicy` and `TracingPolicyNamespaced`](https://tetragon.io/docs/concepts/tracing-policy/)
resources checked into a repository and describes which hooks they attach to,
under which conditions they act, what they do (observe, deny, kill) and which
workloads they apply to. It writes the shared
[runtime policy model](../../../docs/models/runtime-policy-model.md), which the
[`runtime-policy` renderer](../../renderers/runtime-policy/README.md) presents.
Add the [runtime policy comparator](../../comparators/runtime-policy/README.md)
to have changes interpreted (newly enforced, scope broadened, coverage lost).

```json
{
  "id": "runtime-policies",
  "title": "Runtime security policies",
  "extractor": "tetragon-policies",
  "renderer": "runtime-policy",
  "inputs": {"paths": ["deploy/tetragon/**/*.yaml"]}
}
```

<!-- prettier-ignore -->
| Input | Meaning |
| --- | --- |
| `paths` | Globs selecting YAML files. Default: every `.yaml` and `.yml` file (none when `helm` or `kustomize` is set). A file is parsed only if it mentions `TracingPolicy`; other documents in it (a `ConfigMap`, say) are ignored. Explicit `paths` that match no file fail |
| `exclude` | Globs to skip |
| `namespace` | The namespace of `TracingPolicyNamespaced` resources and workloads that name none; otherwise namespaced policies apply to "the namespace the policy is applied to" and workloads to `default` |
| `renderedManifestsPath` | One file of already rendered manifests (for example `helm template` output that CI wrote) to read instead of everything else |
| `helm` | `{chart, values?, releaseName?, namespace?, helmPath?}`: render a chart in the repository with `helm template` (**requires trust**) |
| `kustomize` | `{path, kustomizePath?}`: render a kustomization in the repository with `kustomize build` (**requires trust**) |
| `crdPath` | A file, or a list of files, holding the `TracingPolicy` CRDs the repository deploys |
| `agentValuesPath` | The values file the repository deploys the Tetragon Helm chart with |
| `kernelProfilesPath` | Kernel profiles of the nodes policies load on (below) |
| `workloadPaths` | Globs selecting Kubernetes workload manifests |

Reading YAML runs nothing and needs **no trust**, so a base-defined projection
can examine an untrusted fork's pull request. Only `helm` and `kustomize` run a
tool: the user's own `helm` or `kustomize`, without a shell, in the examined
revision, never `helm dependency update` or anything that installs. Chart
dependencies must be in the repository (`charts/`). Grant tool settings such as
`HELM_CACHE_HOME` through `execution.environment`. Helm post-renderers and
Kustomize plugins execute code, which is why both need `--trust`.

## What it reads

- Multi-document YAML streams and `kind: List` items.
- `kprobes`, `fentries`, `tracepoints`, `lsmhooks`, `uprobes` (one probe per
  symbol, offset or address), `usdts` and `loader`.
- `lists`, expanded into one probe per value (`call: list:dups`); generated
  lists (`generated_syscalls`, `generated_ftrace`) stay one `generated` hook,
  because only the running kernel knows their contents.
- `selectorsMacros`, appended to the selectors that name them, as Tetragon does.
- Every selector filter, `matchActions` and `matchReturnActions`, with each
  selector's effect (`enforce`, `respond`, `observe`, `track`, `silent` or
  `unknown`) and whether its enforcement is active or elided by
  `policy-mode: monitor`.
- Workload scope (`podSelector`, `containerSelector`, `hostSelector`, the
  namespace and per-selector `matchWorkloads`) after Tetragon's
  [filtering truth table](https://tetragon.io/docs/concepts/tracing-policy/k8s-filtering/#filtering-semantics),
  and `nodeSelector`.

Fields it doesn't model are kept in `data.unmodelled` and listed in the
extraction's limitations, so a newer Tetragon is read without failing and a
change to a new field is still reported. An unknown action makes its selector's
effect `unknown`. `${…}` placeholders, as in Tetragon's own `envsubst` examples,
are read as literal text and the policy is marked `templated`. `matchCEL` is
shown as text.

## Deployment facts

Optional inputs read more files from the repository, never a cluster, and add
what changes what a policy means in practice. Each is described in the
[model](../../../docs/models/runtime-policy-model.md#deployment-facts).

- **`crdPath`.** Each policy is checked against the structural schema of the
  repository's own copy of the CRDs (types, required fields, enums, patterns,
  limits and unknown fields), so the check follows the Tetragon version the
  repository deploys. Violations become the policy's `data.invalid`, shown as
  warnings, rather than failing the extraction: a pull request that adds an
  invalid policy is exactly what a reviewer should see. CEL rules
  (`x-kubernetes-validations`) aren't evaluated. Projections ships no copy of
  the CRDs.
- **`agentValuesPath`.** A `Tetragon agent` entity with the settings that change
  what policies do, using the chart's defaults: `tetragon.enablePolicyFilter`
  (when off, Tetragon rejects namespace, pod and container filtering, so such
  policies don't load; each gets a finding), `tetragon.enableKeepSensorsOnExit`
  and `tetragonOperator.tracingPolicy.enabled`.
- **`kernelProfilesPath`.** One `kernel` entity per profile, and findings where
  a profile can't support a hook or action: BPF LSM missing or older than 5.7,
  fentry without BTF, a probed function missing from the profile's symbols, and
  `Override` without `CONFIG_BPF_KPROBE_OVERRIDE`, on a function the profile's
  error injection list lacks, or on `security_` functions before 5.7. The format
  is Projections' own:

  ```yaml
  profiles:
    - name: general
      kernel: "6.1"                  # optional
      config:                        # optional; true/false or y/m/n
        CONFIG_BPF_LSM: y
        CONFIG_BPF_KPROBE_OVERRIDE: y
        CONFIG_DEBUG_INFO_BTF: y
      symbols: kernels/general.kallsyms              # optional: /proc/kallsyms or one name per line
      errorInjection: kernels/general.error_injection  # optional: /sys/kernel/debug/error_injection/list
  ```

- **`workloadPaths`.** One `workload` entity per `Deployment`, `StatefulSet`,
  `DaemonSet`, `ReplicaSet`, `Job`, `CronJob` or `Pod`, with its pod template
  labels and containers, and a `covers` relationship from every policy whose
  scope includes it, following Tetragon's own label semantics (including the
  `k8s:io.kubernetes.pod.namespace` label) and container selectors on `name` and
  `repo`. Coverage is `derived`.

## What fails

Rather than guessing, extraction fails on malformed YAML, duplicate keys, two
policies with one identity, a reference to an undefined list or selector macro,
more than five selectors on a probe or three actions on a selector (Tetragon's
[limits](https://tetragon.io/docs/concepts/tracing-policy/selectors/#limitations)),
duplicate selector labels, an invalid `policy-mode`, an invalid label selector,
a non-null `hostSelector` in a `TracingPolicyNamespaced`, a deployment input
that names no CRD, a malformed values flag or kernel version, workload paths
that match nothing, a `helm` chart or `kustomize` path outside the repository,
`helm` or `kustomize` without trust, and a file that mentions `TracingPolicy`
but doesn't parse because it is a template. Render templates in CI and set
`renderedManifestsPath`.

## What it can't show

Policies loaded over gRPC or `tetra`, modes changed at run time, whether a
node's kernel has a probed symbol or supports `Override` and BPF LSM, and
whether a selector ever matches. See the
[model](../../../docs/models/runtime-policy-model.md#not-modelled).

## Tests

```sh
cargo test -p projections-extractor-tetragon-policies
```

Golden extractions live beside their fixtures in `tests/fixtures`; regenerate
them with `PROJECTIONS_UPDATE_GOLDEN=1`. Helm and Kustomize are tested through a
recording tool runner. To check the fixtures against Tetragon's own published
CRDs, point `PROJECTIONS_TETRAGON_CRDS` at
`pkg/k8s/apis/cilium.io/client/crds/v1alpha1` in a cilium/tetragon checkout:
only the fields and actions invented to test version skew fail. The fixtures
were checked with Tetragon's own validation (`pkg/tracingpolicy.FromYAML`),
apart from the fields and actions deliberately invented to test version skew.
