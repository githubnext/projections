# Runtime security policies

The Tetragon tracing policies a repository deploys, as what a security reviewer
asks of them: which kernel and user-space hooks they attach to, under which
conditions each rule acts, what it does there (observe, deny, kill), and which
binaries and workloads it applies to. Compared across a pull request, it answers
"does this change enforce something new, stop enforcing something, widen who a
policy applies to, or leave a hook unwatched?"

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

Use it in a repository that deploys Tetragon `TracingPolicy` or
`TracingPolicyNamespaced` resources, to review policy changes by their effect
rather than as YAML diffs, where a new `Sigkill` or a dropped `podSelector`
label is one line among many. It reads the checked-in YAML, so it runs nothing
and needs no `--trust`, unless you ask it to render a Helm chart or a
kustomization: a projection defined on the base branch can examine a fork's pull
request safely.

It describes what the repository declares, not a running cluster: policies
loaded at run time (with `tetra` or over gRPC), mode changes made at run time
and whether a rule ever matches aren't part of it. Add the
[`runtime-policy` comparator file](#interpreting-changes-the-runtime-policy-comparator)
to have changes interpreted in security terms.

## What it reads

- **Policies**: by default every `.yaml` and `.yml` file that mentions
  `TracingPolicy` (`paths` and `exclude` narrow it; other documents in a file
  are ignored). `renderedManifestsPath` reads one file of manifests CI already
  rendered instead; `helm` runs `helm template` on a chart in the repository,
  and `kustomize` runs `kustomize build`, each with your own tool and without a
  shell, which is why those two need `--trust`.
- **Hooks**: `kprobes`, `fentries`, `tracepoints`, `lsmhooks`, `uprobes`,
  `usdts` and `loader`, one hook per function, tracepoint, LSM hook or binary
  symbol, shared by every policy that attaches to it. `lists` expand to one hook
  per value; generated lists (`generated_syscalls`, `generated_ftrace`) stay one
  hook, since only the running kernel knows their contents. Hooks are grouped by
  what they watch (credentials, processes, files, network, kernel modules, BPF,
  namespaces, user space, other).
- **Rules**: each selector, with `selectorsMacros` expanded, is a rule: its
  conditions (`arg0` (`file`) starts with `/etc`), its binary filters
  (`matchBinaries` and `matchParentBinaries`, with `followChildren`), its
  actions, and its effect: `enforce`, `respond`, `observe`, `track`, `silent` or
  `unknown`. A policy in `policy-mode: monitor` has its enforcement elided, and
  the rule says so.
- **Scope**: the workloads a policy applies to (`podSelector`,
  `containerSelector`, `hostSelector` and its namespace, after Tetragon's own
  filtering rules), a rule's `matchWorkloads`, and the nodes that load it
  (`nodeSelector`). `namespace` names the namespace of namespaced policies and
  workloads that don't name one.

Optional inputs read more files from the repository, never a cluster, and add
the deployment facts that change what a policy means in practice:

- `crdPath`: the `TracingPolicy` CRDs the repository deploys. Each policy is
  checked against their schema, so the check follows the Tetragon version you
  deploy, and violations become warnings rather than failures.
- `agentValuesPath`: the Tetragon chart's values. An agent configuration
  appears, and when `tetragon.enablePolicyFilter` is off, every policy that
  filters by namespace, pod or container gets a warning, since Tetragon won't
  load it.
- `kernelProfilesPath`: profiles of the kernels your nodes run, and warnings
  where one can't attach a hook (no BPF LSM, fentry without BTF, a missing
  symbol) or run an `Override`.
- `workloadPaths`: the Kubernetes workloads the repository deploys, and which
  policies cover each, on which containers.

Fields the extractor doesn't model are kept in `data.unmodelled`, so a newer
Tetragon field is read rather than failing, and changing it still marks the item
modified.

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

The [`runtime-policy`](../renderers/runtime-policy.md) renderer draws the
policies and the workloads they apply to, then one lane per hook holding every
policy's rules there, each with when it acts, what it does and which binaries or
workloads it applies to (`/usr/bin/curl`, except `/usr/bin/kmod`, launched by
`/usr/bin/bash` and children, or any binary). It shows a comparison Side by side
or as one Diff view, with each changed item marked and its old value struck
through before the new one:

- **Policies** added, removed or modified: a new mode, other nodes, or a scope
  change (the old workloads chip struck, the new one beside it).
- **Rules** added, removed or modified: new conditions, actions, effect or
  binaries.
- **Hooks** that gain their first policy or lose their last.
- **Warnings** (a CRD violation, a policy that won't load, a hook a kernel can't
  support), shown at every point of the comparison because they describe the
  revision, not the change.

The summary bar counts policies, hooks and rules (and workloads, kernel profiles
and the agent configuration when present), each with its changes, then how many
rules enforce, with its change (`1 enforcing rule +1`).

### Interpreting changes: the runtime-policy comparator

The default comparator says _that_ a rule changed. The
[`runtime-policy` comparator file](../../../packages/comparators/runtime-policy/README.md)
that ships with Projections says what the change means to a security reviewer.
It isn't built in: copy
`packages/comparators/runtime-policy/runtime-policy.comparator.yaml` into your
repository and name it in the definition (it takes no options):

```json
"comparator": ".github/projections/runtime-policy.comparator.yaml"
```

It keeps the default comparator's matching and statuses and adds:

- **Interpretations** of each change: `newly-enforced`, `enforcement-removed`,
  `enforcement-elided` (monitor mode), `scope-broadened` and `scope-narrowed`
  (only where containment is provable, otherwise `scope-changed`),
  `mode-changed`, `nodes-changed`, `warning-added`, `agent-changed`,
  `coverage-lost` and `newly-covered` (a hook no policy watches any more, or one
  now does), `newly-observed` and `observation-removed`, `binaries-changed`,
  `condition-changed`, `action-changed`, `policy-added`, `policy-removed` and
  `capture-changed`. The renderer writes the main ones after the change's status
  (`Added · Newly enforced`, `Removed · No longer covered`).
- **Summary facts**, most severe first, each filtering to its changes:
  `1 newly enforced`, `1 scope broadened`, `1 hook no longer covered`.
- **One sentence per change**, naming the binaries a rule applies to, for
  example "`block-modules` rule `not-kmod` at `kernel_module_request` now
  enforces: Deny (`Override` returns `-1`) for binaries other than
  `/usr/bin/kmod`." or "… now enforces: Kill (`Sigkill`) for `/usr/bin/curl` or
  `/usr/bin/wget` when …". A rule whose binary filters change is
  `binaries-changed` ("applies to different binaries").
- **Order**: steps by their most severe change, enforcement first.

Rules run sandboxed and need no trust, in the CLI, VS Code and hosted views; a
hosted view runs the comparator file from the pull request's base, so a pull
request can't change how it is judged. Without it, every change is still marked
with its old and new values; only the interpretations and their facts are
absent.

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

- Templates fail rather than being guessed at: a file that mentions
  `TracingPolicy` but isn't valid YAML (a Helm template) fails the extraction.
  Render it in CI and set `renderedManifestsPath`, or use `helm` with `--trust`.
  `${…}` placeholders are read as literal text and the policy is marked
  `templated`.
- Selectors without a `label` are identified by position, so inserting one
  reports the later ones as modified; give selectors labels. Renaming a policy
  is a removal and an addition unless the definition declares a
  `correspondence`.
- Without `kernelProfilesPath`, whether a node's kernel has a probed symbol or
  supports `Override` and BPF LSM isn't known; each hook's stability (`stable`,
  `syscall`, `kernel-internal`, `user`, `generated`) says how much to worry.
- `matchCEL` is shown as text, generated lists aren't expanded, and event
  volume, overhead and precedence between policies aren't modelled (Tetragon has
  no precedence: coverage is the union).
- Extraction fails on what Tetragon would reject: more than five selectors on a
  probe or three actions on a selector, an undefined list or macro, two policies
  with one identity.

## Related

- [`runtime-policy`](../renderers/runtime-policy.md), the renderer that draws
  it.
- [The runtime policy model](../../models/runtime-policy-model.md), the
  engine-neutral vocabulary it writes, and the
  [`runtime-policy` comparator file](../../../packages/comparators/runtime-policy/README.md)
  that interprets it.
- [The default comparator](../comparators/default.md), which the comparator file
  builds on.
- [Custom comparators: what they make possible](../../guides/comparators.md),
  with this comparison shown with and without the comparator file.

## How it works

The [package README](../../../packages/extractors/tetragon-policies/README.md)
details what it reads, the deployment facts and what fails.

## Build your own

Write your own extractor when Tetragon's declared policies aren't what you want
to review:

- **Another runtime policy engine**: KubeArmor, Falco rules, Tracee, seccomp or
  AppArmor profiles. Write the same
  [runtime policy model](../../models/runtime-policy-model.md) and both the
  `runtime-policy` renderer and the comparator file work unchanged.
- **Facts the YAML doesn't have**: which rules actually fire and how often, the
  alerts each one routes to, or the team that owns each policy.
- **Policies that live elsewhere**: loaded with `tetra` or an operator from a
  database, or generated by a tool whose output isn't in the repository.

Try the lighter options first: `paths`, `exclude`, `helm`, `kustomize` and
`renderedManifestsPath` find policies wherever the repository keeps them, and
`crdPath`, `agentValuesPath`, `kernelProfilesPath` and `workloadPaths` add the
deployment facts. To change what counts as risky or how a change is worded, edit
your copy of the comparator file rather than the extractor. To draw the policies
differently, keep this extractor and write a renderer.

**In VS Code**, choose **+ New Projection…** in the Projections view, then
**Write a custom extractor, renderer or comparator** › **Custom extractor** (or
**Custom extractor and renderer**), and pick its language. It writes the
definition and a starter extractor (`extract.mjs`, `extract.py` or `extract.go`)
under `.github/projections/<id>/`, drawn by the built-in graph renderer. Or
choose **Ask an agent to write it** and describe what the projection should
show.

**With the CLI**, keep this extractor's renderer:

```sh
projections init <id> --language node --renderer runtime-policy
```

An extractor is any program that prints an extraction; for the `runtime-policy`
renderer, an `architecture/v0` extraction that declares the
[`runtime-policy/v0` vocabulary](../../reference/schemas/vocabularies-runtime-policy.md).
Run it with `projections show -p <id> --trust` as you change it; an open
projection tab uses your uncommitted edits ("Your edits") and says when its
results are out of date, and the Testing view runs the projection's checks.
[Write your first extractor](../../guides/first-extractor.md) walks through one,
and [Extraction schema](../../guides/schemas.md#extraction-schema) describes
what it prints.
