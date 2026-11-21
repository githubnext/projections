# Runtime security policies

This renderer presents runtime security policies the way a reviewer evaluates
them: first what each policy targets, then every kernel or user-space hook a
policy attaches to, along with the rules acting there, whether each rule
observes or enforces (killing or blocking), and which binaries or workloads it
matches. Across a pull request, it answers "what will this change start or stop
enforcing, and on what?"

<!-- generated: facts -->

- Name: `runtime-policy`
- Draws: [`architecture/v0`](../../reference/schemas/architecture.md) with the
  `runtime-policy/v0` vocabulary
- Comparison modes: Diff, Side by side; a comparison opens in Diff
- Package: `@githubnext/projections-renderer-runtime-policy`

<!-- end generated: facts -->

## When to use it

Use this renderer to review changes to Tetragon tracing policies or any
extraction using the
[runtime policy model](../../models/runtime-policy-model.md). It makes
high-stakes policy shifts obvious—a rule switching from observe to kill, a
selector widening to more workloads, or a hook losing coverage altogether. It
only draws that model; for other `architecture/v0` extractions, use
[`graph`](graph.md).

Built-in extractors that use it by default:

<!-- generated: extractors -->

| Built-in extractor                                        | Its default `renderer` |
| --------------------------------------------------------- | ---------------------- |
| [`tetragon-policies`](../extractors/tetragon-policies.md) | `runtime-policy`       |

<!-- end generated: extractors -->

## What it draws

Policies are organized into titled panels, each containing one table with a
muted icon beside the title (a server for agent and kernels, a shield for
policies, a box for workloads, and an icon for each hook category):

- **Agent and kernels** (shown when deployment facts are present) lists the
  Tetragon agent configuration and the kernel profiles of the nodes where
  policies load.
- **Policies** lists each policy's name, resource kind, namespace, mode
  (`enforce` or `monitor`), target nodes, and scope (such as
  `pods in namespace checkout`).
- **Workloads** (shown when present) lists each deployed workload, the policies
  covering it (**Covered by**), whether each enforces or observes, and which
  containers it applies to.
- **Hook panels** group hooks by subsystem: Credentials, Processes, Files,
  Network, Kernel modules, BPF, Namespaces and mounts, User space, and Other.
  Each hook (`kprobe security_file_permission · kernel internal`) starts its own
  lane, listing every attached policy and its rules in order. Each rule row
  shows its trigger conditions (for example, "`arg0` (file) starts with
  `/root/.ssh`", or "every call"), its **Effect** (with an icon for enforcing
  actions like **Kill**, or **elided in `monitor` mode** when suppressed by the
  policy's mode), and what it **Applies to**.

In the **Applies to** column, **binaries** appear as code chips
(`/usr/bin/curl`) prefixed by how they match (**except** for exclusions,
**under** for path prefixes, **ending** for suffixes, **launched by** for parent
binaries), or **any binary** when unconstrained. Policy and workload scopes use
the same chip style.

**Warnings** appear directly below the affected item labeled "Warning"—for
instance, a policy rejected by the repository's CRD, a policy that won't load
because the agent's policy filter is off, or a hook or `Override` unsupported by
a node's kernel. Because warnings describe the revision being viewed, they stay
visible throughout a comparison.

Identifiers, paths, values, and label selectors use monospace, while prose uses
sans-serif. Below 640 px, table columns stack vertically under each row.

## Options

This renderer has no controls or zoom. Comparisons support Diff and Side by side
(set the default with `presentation.mode`). Animated and Swipe modes aren't
offered since scrubbing between tables would just pop rows in and out.

## What a comparison shows

- **Diff** merges every policy, hook, rule, and subject from both revisions in
  place, with `+`, `−`, or `~` in the gutter. Changed rows are filled and
  bordered in their change color, with an icon and status word in the **Change**
  column. Modified values—rule conditions, effects, policy modes, or
  nodes—strike through the old value before the new one. Scope changes show the
  old chip struck through beside the new one, and added or removed binaries
  appear as `+` or `−` chips. Added or removed hooks and probes mark their whole
  region once.
- **Side by side** renders each revision in its own pane and marks its changes
  when the host's highlighting is on.

All marks follow the host's highlighting toggle (Before, After, and
unhighlighted views render plain), and the **Change** column reserves space on
changed rows so toggling status never shifts the layout.

The **summary bar** counts policies, hooks, and rules—plus workloads, kernel
profiles, and agent configurations when present—along with their deltas and the
number of enforcing rules
(`2 policies ~1 · 2 hooks −1 · 3 rules +1 −1 · 1 enforcing rule +1`). Probes and
matched subjects are treated as structure rather than summary figures.

**With the
[`runtime-policy`](../../../packages/comparators/runtime-policy/README.md)
comparator file**, changes also get security interpretations:

- The **Change** column appends an outline icon and verdict after the status
  (`Removed · No longer covered`, `Added · Newly enforced`,
  `Modified · Scope broadened`).
- The summary bar totals those verdicts from most severe to least, each acting
  as a filter: `1 newly enforced`, `1 no longer enforced`, `1 scope broadened`,
  `1 mode changed`, `1 new warning`, `1 hook no longer covered`,
  `1 hook newly covered`, and more.

Without the comparator file, every change still shows its old and new values;
only the security verdicts and their summary counts are omitted.

Policies, hooks, probes, rules, and chips are all selectable, syncing selection
across panes and with the host's table.

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

## Screenshot

Here is a Diff using the default comparator: `protect-credentials` now covers
two namespaces, and a new rule kills `/usr/bin/curl` and `/usr/bin/wget` when
they read a service-account token.

![The runtime policy renderer in Diff: protect-credentials marked Modified with its old scope struck through, and the token-read-by-downloader rule marked Added with Kill and two binary chips](../../images/comparators/runtime-policy-default.png)

## Limitations

- It only draws the runtime policy model (`architecture/v0` with the
  `runtime-policy/v0` vocabulary).
- It reflects declared policy configuration rather than live runtime telemetry—
  there are no events, alerts, or traces.
- Without the `runtime-policy` comparator file, changes are still marked, but
  nothing indicates whether a change broadens, narrows, or newly enforces
  anything.
- Animated and Swipe comparison modes aren't supported.

## Related

- [`tetragon-policies`](../extractors/tetragon-policies.md) — the default
  extractor.
- The [`runtime-policy`](../../../packages/comparators/runtime-policy/README.md)
  comparator file and the
  [runtime policy model](../../models/runtime-policy-model.md) shared by both.
- [`graph`](graph.md) — draws other `architecture/v0` extractions.
- [The default comparator](../comparators/default.md).

## How it works

See the [package README](../../../packages/renderers/runtime-policy/README.md)
for details on layout, typography, and change marks.

## Build your own

This renderer organizes rules by hook, the way a policy author thinks. Build a
custom renderer when reviewers need a different perspective:

- **Workload-centric views** — each service paired with every rule that observes
  or kills it, or a matrix of workloads against hooks.
- **Custom prioritization** — grouping by your threat model's categories instead
  of kernel subsystems, or floating production-enforcing rules to the top.
- **Other policy engines** — Falco rules, seccomp or AppArmor profiles, or
  KubeArmor policies rendered in their native terminology.

Check the lighter options first. If you want to classify changes in your team's
terms (such as flagging sensitive namespaces or effects that need a second
reviewer), customize the `runtime-policy` comparator file—its verdicts flow
directly into this renderer's **Change** column and summary bar. Any extractor
that emits the runtime policy model for another engine works with this renderer
out of the box, and `presentation.mode` lets you choose Diff or Side by side.

**In VS Code**, select **+ New Projection…** in the Projections view, choose
**Write a custom extractor, renderer or comparator** › **Custom renderer**, and
pick the built-in extractor it draws. VS Code scaffolds the definition
(`.github/projections/<id>.json`) and a TypeScript, Vite, and React renderer
package built on the renderer kit (`.github/projections/<id>/renderer`), then
opens both the definition and the projection tab. You can also choose **Ask an
agent to write it** and describe what you want shown.

**With the CLI**:

```sh
projections init <id> --extractor tetragon-policies --renderer custom
```

Inside the generated renderer package, run `npm install`, then use `npm run dev`
for a hot-reloading dev server, `npm run workbench` to preview your scenarios in
the browser, and `npm test` to run renderer checks across every scenario.

In VS Code, an open projection tab picks up your uncommitted definition edits
("Your edits"), and saving renderer source files automatically rebuilds and
reloads the view in a trusted workspace (using its `watch` or `build` script).
Run projection and renderer checks from the Testing view or via
`projections check -p <id>`. For a full walkthrough, see
[Develop a renderer](../../guides/develop-a-renderer.md), the
[renderer kit guide](../../guides/renderer-kit.md), and the
[renderer kit API](../../reference/renderer-kit.md).
