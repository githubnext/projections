# Runtime security policies

This extractor reads the Tetragon tracing policies in your repository and
organizes them the way a security reviewer inspects them: which kernel and
user-space hooks they attach to, when each rule fires, what action it takes
(observe, deny, or kill), and which binaries and workloads are in scope.
Compared across a pull request, it shows whether a change enforces something
new, drops enforcement, widens a policy's scope, or leaves a hook unwatched.

<!-- generated: facts -->

- ID: `tetragon-policies`
- Extraction schema:
  [`architecture/v0`](../../reference/schemas/architecture.md)
- Drawn by default with: [`runtime-policy`](../renderers/runtime-policy.md)
- Needs `--trust`: When it runs ecosystem tools or repository code
  (`when-executing-tools`)
- Never suggested by `projections explore`: add it yourself

<!-- end generated: facts -->

## When to use it

Use this extractor in repositories that deploy Tetragon `TracingPolicy` or
`TracingPolicyNamespaced` resources so you can review policy changes by their
security impact rather than hunting through YAML diffs where a new `Sigkill` or
a removed `podSelector` label blends into the noise.

When reading checked-in YAML, nothing executes and no `--trust` is needed, so a
projection on your base branch can safely inspect pull requests from forks. You
only need `--trust` if you ask it to render a Helm chart or kustomization.

Keep in mind that it reflects what is declared in Git, not a live cluster:
policies loaded dynamically (via `tetra` or gRPC), runtime mode changes, and
actual rule hit counts aren't visible here. Pair it with the
[`runtime-policy` comparator file](#interpreting-changes-the-runtime-policy-comparator)
to automatically classify changes in security terms.

## What it reads

- **Policies.** By default, it scans every `.yaml` and `.yml` file mentioning
  `TracingPolicy` (narrowed by `paths` and `exclude`, ignoring non-policy YAML
  documents). You can instead read pre-rendered manifests from
  `renderedManifestsPath`, or render charts on the fly with `helm`
  (`helm template`) or `kustomize` (`kustomize build`)—both run your local tool
  without a shell and require `--trust`.
- **Hooks.** Covers `kprobes`, `fentries`, `tracepoints`, `lsmhooks`, `uprobes`,
  `usdts`, and `loader`, creating one shared hook per function, tracepoint, LSM
  hook, or binary symbol across all policies that attach to it. `lists` expand
  to one hook per entry, while generated lists (`generated_syscalls`,
  `generated_ftrace`) stay a single hook because only the live kernel knows
  their members. Hooks are grouped by domain (credentials, processes, files,
  network, kernel modules, BPF, namespaces, user space, and other).
- **Rules.** Each selector (with `selectorsMacros` expanded) becomes a rule
  recording its conditions (`arg0` (`file`) starts with `/etc`), binary filters
  (`matchBinaries` and `matchParentBinaries`, with `followChildren`), actions,
  and resulting effect (`enforce`, `respond`, `observe`, `track`, `silent`, or
  `unknown`). When a policy sets `policy-mode: monitor`, enforcement is elided
  and the rule notes that.
- **Scope.** Captures targeted workloads (`podSelector`, `containerSelector`,
  `hostSelector`, and namespace following Tetragon's filtering semantics),
  per-rule `matchWorkloads`, and target nodes (`nodeSelector`). The `namespace`
  input supplies a default namespace for namespaced policies and workloads that
  omit one.

Optional repository-file inputs enrich the view with deployment context without
touching a live cluster:

- `crdPath` validates each policy against the `TracingPolicy` CRDs your
  repository deploys, matching your Tetragon version and surfacing violations as
  warnings rather than hard failures.
- `agentValuesPath` reads your Tetragon Helm chart values and warns on any
  policy filtering by namespace, pod, or container if
  `tetragon.enablePolicyFilter` is disabled (since Tetragon will refuse to load
  it).
- `kernelProfilesPath` checks hooks against your nodes' kernel profiles and
  flags hooks a kernel can't attach (missing BPF LSM, fentry without BTF,
  missing symbols) or where `Override` isn't supported.
- `workloadPaths` reads your Kubernetes workload manifests to show which
  policies cover which workloads and containers.

Any fields the extractor doesn't explicitly model are preserved in
`data.unmodelled`, so newer Tetragon schema fields won't break extraction and
changes to them still show up as modifications.

## Options

<!-- generated: inputs -->
<!-- prettier-ignore -->
| Input | Meaning |
|---|---|
| `agentValuesPath` | The Tetragon Helm chart values file the repository deploys the agent with. |
| `crdPath` | A file, or array of files, holding the TracingPolicy CRDs the repository deploys; policies are checked against them. |
| `exclude` | Array of globs to skip. |
| `helm` | {chart, values?, releaseName?, namespace?, helmPath?}: render a chart in the repository with helm template (requires trust). |
| `kernelProfilesPath` | A YAML or JSON file of kernel profiles ({profiles: [{name, kernel?, config?, symbols?, errorInjection?}]}) of the nodes policies load on. |
| `kustomize` | {path, kustomizePath?}: render a kustomization in the repository with kustomize build (requires trust). |
| `namespace` | Namespace for TracingPolicyNamespaced resources and workloads that name none. |
| `paths` | Array of globs selecting YAML files to read; default every .yaml and .yml file (none when helm or kustomize is set). Files that don't mention TracingPolicy are skipped. |
| `renderedManifestsPath` | A file of already rendered manifests (for example helm template output from CI) to read instead of paths. |
| `workloadPaths` | Array of globs selecting Kubernetes workload manifests, to show which policies cover which workloads. |

<!-- end generated: inputs -->

## What a comparison shows

The [`runtime-policy`](../renderers/runtime-policy.md) renderer lists policies
and their target workloads, followed by one lane per hook containing every rule
attached there—showing when it triggers, what it does, and which binaries or
workloads it matches (such as `/usr/bin/curl`, except `/usr/bin/kmod`, launched
by `/usr/bin/bash` and children, or any binary). You can view comparisons side
by side or as a unified Diff with old values struck through beside new ones:

- **Policies** added, removed, or modified (mode changes, node changes, or
  updated workload scopes with old chips struck through).
- **Rules** added, removed, or modified (updated conditions, actions, effects,
  or binary filters).
- **Hooks** gaining their first policy or losing their last one.
- **Warnings** (CRD violations, unloadable policies, or unsupported kernel
  hooks), shown throughout the comparison since they describe each revision
  rather than just the diff.

The summary bar counts policies, hooks, and rules (plus workloads, kernel
profiles, and agent config when provided) with their deltas, followed by the
enforcing rule total (`1 enforcing rule +1`).

### Interpreting changes: the runtime-policy comparator

While the default comparator tells you _that_ a rule changed, the
[`runtime-policy` comparator file](../../../packages/comparators/runtime-policy/README.md)
explains what the change means for security. Because it isn't built in, copy
`packages/comparators/runtime-policy/runtime-policy.comparator.yaml` into your
repository and point your definition at it (no extra options needed):

```json
"comparator": ".github/projections/runtime-policy.comparator.yaml"
```

It preserves the default comparator's matching and statuses while adding:

- **Security interpretations** for every change: `newly-enforced`,
  `enforcement-removed`, `enforcement-elided` (monitor mode), `scope-broadened`
  and `scope-narrowed` (when containment is provable; otherwise
  `scope-changed`), `mode-changed`, `nodes-changed`, `warning-added`,
  `agent-changed`, `coverage-lost` and `newly-covered` (hooks losing or gaining
  policy coverage), `newly-observed` and `observation-removed`,
  `binaries-changed`, `condition-changed`, `action-changed`, `policy-added`,
  `policy-removed`, and `capture-changed`. The renderer appends key labels to
  the status badge (`Added · Newly enforced`, `Removed · No longer covered`).
- **Clickable summary facts**, ordered by severity: `1 newly enforced`,
  `1 scope broadened`, `1 hook no longer covered`.
- **Plain-English change summaries** naming the affected binaries—for example,
  "`block-modules` rule `not-kmod` at `kernel_module_request` now enforces: Deny
  (`Override` returns `-1`) for binaries other than `/usr/bin/kmod`." or "… now
  enforces: Kill (`Sigkill`) for `/usr/bin/curl` or `/usr/bin/wget` when …".
  Binary filter edits are tagged `binaries-changed` ("applies to different
  binaries").
- **Severity-first ordering**, putting enforcement changes at the top.

Comparator rules run in a sandbox with no trust required across the CLI, VS
Code, and hosted views. Hosted views always load the comparator from the pull
request's base branch so a PR can't weaken its own review rules. Without this
comparator, all diffs still appear with old and new values—only the security
classifications and summary facts are omitted.

## Start from this definition

<!-- generated: definition -->

```json
{
  "extractor": "tetragon-policies",
  "id": "tetragon-policies",
  "inputs": {
    "paths": [
      "**/*.yaml",
      "**/*.yml"
    ]
  },
  "renderer": "runtime-policy",
  "title": "Runtime security policies"
}
```

<!-- end generated: definition -->

![The runtime-policy renderer's diff view with the runtime-policy comparator: protect-credentials marked Modified with its scope broadened, a new rule for /usr/bin/curl and /usr/bin/wget marked Added and newly enforced, and the summary bar reading 1 enforcing rule +1, 1 newly enforced, 1 scope broadened and 1 hook no longer covered](../../images/comparators/runtime-policy.png)

## Limitations

- Unrendered templates fail rather than being guessed at: any file mentioning
  `TracingPolicy` that isn't valid YAML (such as a raw Helm template) causes
  extraction to fail. Render manifests in CI and pass `renderedManifestsPath`,
  or use `helm` with `--trust`. `${…}` placeholders are kept as literal text and
  the policy is tagged `templated`.
- Unlabeled selectors are matched by position, so inserting one shifts the
  remaining selectors and marks them modified—add a `label` to selectors to
  avoid noisy diffs. Renaming a policy shows up as a removal and addition unless
  you map it in `correspondence`.
- Without `kernelProfilesPath`, the extractor can't verify whether your nodes'
  kernels expose a probed symbol or support `Override` and BPF LSM; each hook's
  stability rating (`stable`, `syscall`, `kernel-internal`, `user`, `generated`)
  gives a rough risk signal instead.
- `matchCEL` expressions are shown as raw text, generated lists aren't expanded,
  and event volume, overhead, and policy precedence aren't modeled (Tetragon has
  no precedence—coverage is the union of matching policies).
- Extraction fails on invalid manifests that Tetragon itself would reject, such
  as more than five selectors on a probe, more than three actions on a selector,
  undefined lists or macros, or duplicate policy identities.

## Related

- [`runtime-policy`](../renderers/runtime-policy.md) — the renderer that
  displays policies and hook lanes.
- [The runtime policy model](../../models/runtime-policy-model.md) — the
  engine-neutral vocabulary this extractor emits, paired with the
  [`runtime-policy` comparator file](../../../packages/comparators/runtime-policy/README.md).
- [The default comparator](../comparators/default.md) — the base comparator that
  the comparator file extends.
- [Custom comparators: what they make possible](../../guides/comparators.md) —
  shows this comparison with and without the comparator file.

## How it works

See the
[package README](../../../packages/extractors/tetragon-policies/README.md) for
details on manifest parsing, deployment checks, and error conditions.

## Build your own

Consider writing a custom extractor if Tetragon YAML isn't what you need to
review:

- **Another runtime security engine**, such as KubeArmor, Falco rules, Tracee,
  seccomp, or AppArmor profiles. Emit the same
  [runtime policy model](../../models/runtime-policy-model.md) and both the
  `runtime-policy` renderer and comparator file work unchanged.
- **Runtime telemetry or ownership**, like which rules actually fire and how
  often, alert routing, or team ownership per policy.
- **External policy sources**, such as policies loaded via `tetra` or an
  operator from a database, or generated outside the repository.

Check the built-in options first: `paths`, `exclude`, `helm`, `kustomize`, and
`renderedManifestsPath` locate policies however your repo stores them, while
`crdPath`, `agentValuesPath`, `kernelProfilesPath`, and `workloadPaths` supply
deployment context. To tweak risk classifications or wording, edit your copy of
the comparator file instead of rewriting the extractor; to change the layout,
keep this extractor and write a custom renderer.

**In VS Code**, open the Projections view, select **+ New Projection…**, choose
**Write a custom extractor, renderer or comparator** › **Custom extractor** (or
**Custom extractor and renderer**), and pick a language. That creates the
definition and a starter extractor (`extract.mjs`, `extract.py`, or
`extract.go`) under `.github/projections/<id>/`, paired with the built-in graph
renderer. You can also choose **Ask an agent to write it** and describe what you
want to see.

**With the CLI**, keep this extractor's renderer:

```sh
projections init <id> --language node --renderer runtime-policy
```

An extractor can be any program that prints an extraction; to use the
`runtime-policy` renderer, emit an `architecture/v0` extraction declaring the
[`runtime-policy/v0` vocabulary](../../reference/schemas/vocabularies-runtime-policy.md).
Test changes as you go with `projections show -p <id> --trust`. An open
projection tab picks up your uncommitted edits ("Your edits") and flags stale
results, and the Testing view runs your projection's checks.
[Write your first extractor](../../guides/first-extractor.md) walks through a
complete example, and
[Extraction schema](../../guides/schemas.md#extraction-schema) documents the
output format.
