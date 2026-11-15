# Runtime security policy comparator

[`runtime-policy.comparator.yaml`](runtime-policy.comparator.yaml) is the custom
comparator for projections written in the
[runtime policy model](../../../docs/models/runtime-policy-model.md), such as
the `tetragon-policies` extractor's. It keeps the default comparator's
correspondence and statuses and adds what a security reviewer asks about:

- **Interpretations** of each change, recorded in
  `metadata.runtimePolicy.interpretations` (change ID → names, most severe
  first) for renderers:

  <!-- prettier-ignore -->
  | Name | Meaning |
  | --- | --- |
  | `newly-enforced` | A rule now kills, signals or denies, and its policy enforces |
  | `enforcement-removed` | A rule that enforced no longer does, or is gone |
  | `enforcement-elided` | A rule's enforcement is elided because its policy is in monitor mode |
  | `scope-broadened`, `scope-narrowed` | A policy's workloads provably include, or are included in, the old ones |
  | `scope-changed` | A policy applies to different workloads and neither contains the other provably |
  | `mode-changed`, `nodes-changed` | A policy's mode, or the nodes that load it, changed |
  | `warning-added` | An item gains a warning: a CRD violation or a finding such as a hook a kernel profile can't support |
  | `agent-changed` | The agent's configuration changed |
  | `coverage-lost`, `newly-covered` | No policy attaches to a hook any more, or one now does |
  | `newly-observed`, `observation-removed` | A rule that reports events arrived or left |
  | `binaries-changed`, `condition-changed`, `action-changed` | A rule applies to other binaries, acts under other conditions, or does something else of the same effect |
  | `policy-added`, `policy-removed`, `capture-changed` | A policy arrived or left; a probe captures different arguments or messages |

- **Summaries**: one sentence per interpreted change and per step, for example
  `protect-credentials rule token-read-by-downloader at security_file_permission now enforces: Kill (Sigkill) when …`.
- **Order**: steps are presented by their most severe change, enforcement first,
  then scope and mode, then coverage, then the rest; ties keep the default
  order.

Scope containment is decided only where it is sound: label requirements are
compared as sets (`In`, `NotIn`, `Exists`, `DoesNotExist`), a namespaced scope
covers only its own namespace, and anything it can't prove is `scope-changed`.

## Use it

Copy `runtime-policy.comparator.yaml` into your repository and name it in the
projection definition. It takes no options.

```json
{
  "id": "runtime-policies",
  "title": "Runtime security policies",
  "extractor": "tetragon-policies",
  "comparator": ".github/projections/runtime-policy.comparator.yaml",
  "renderer": "runtime-policy",
  "inputs": {"paths": ["deploy/tetragon/**/*.yaml"]}
}
```

Rules run sandboxed and need no trust, everywhere comparisons are viewed,
including hosted views; see
[where custom comparators run today](../../../docs/guides/comparators.md#where-custom-comparators-run-today).

## Tests

[`runtime-policy.comparator.test.yaml`](runtime-policy.comparator.test.yaml)
states what a reviewer should read in the `tetragon-policies` extractor's
fixtures: interpretations, summaries and the order of steps. Copy it beside the
comparator file (with fixtures of your own) and
`projections check -p <id> --no-render` runs it; here:

```sh
cargo test -p projections-cli --test comparator_tests   # every *.comparator.test.yaml in the repository
npm test -w @githubnext/projections-comparator-runtime     # its functions, in the interpreter's Worker (test/runtime-policy.test.mjs)
cargo test --release -p projections-comparator-rules --test custom   # the rules against the JavaScript comparator they replaced, recorded in packages/comparators/rules/tests/golden
```
