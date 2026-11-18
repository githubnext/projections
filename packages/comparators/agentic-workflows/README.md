# Agentic workflow comparator

[`agentic-workflows.comparator.yaml`](agentic-workflows.comparator.yaml) is the
custom comparator for projections written in the
[agentic workflow model](../../../docs/models/agentic-workflow-model.md), such
as the `github-agentic-workflows` extractor's. It keeps the default comparator's
correspondence and statuses and says, for each workflow that changes, in which
direction the change moves what its unattended agent may do: **widening** is a
warning, **narrowing** a note.

- **Interpretations** of each change, recorded in
  `metadata.agenticWorkflows.interpretations` (change ID → list of
  `{name, level, items}`, most severe first): `level` is `warning` or `note`,
  and `items` says what moved, as text with inline code
  (`` `octo-org/docs-site` ``, ``max `1` → `3` ``).

  <!-- prettier-ignore -->
  | Warning | Note | What moved |
  | --- | --- | --- |
  | `gate-removed` | `gate-added` | An import or skill of a gate class (the extractor's `classes`; every class unless `gates` says) is no longer, or now, loaded |
  | `repos-widened` | `repos-narrowed` | The GitHub tool's `allowed-repos` gains (or loses) a repository; dropping the guard widens, adding one narrows |
  | `permissions-widened` | `permissions-narrowed` | A permission scope's level rises or falls (`all` applies to scopes not named) |
  | `bash-widened` | `bash-narrowed` | Bash is enabled, allows any command or more commands, or the reverse |
  | `network-widened` | `network-narrowed` | A domain or ecosystem is allowed (or no longer blocked), or the reverse |
  | `outputs-widened` | `outputs-narrowed` | A safe output is added, or its `max` rises, it targets another repository, allows more repositories, labels or workflows (one value or a list), or stops being staged or a draft; custom safe-output jobs; or the reverse |
  | `tools-widened` | `tools-narrowed` | A tool, MCP server or GitHub toolset is added, `min-integrity` is lowered (or dropped), `read-only` or `lockdown` is turned off, or the reverse |
  | `secrets-added` | `secrets-removed` | The front matter references more, or fewer, secrets |
  | `strict-disabled` | `strict-enabled` | Strict mode is turned off, or on |
  | `triggers-widened` | `triggers-narrowed` | A trigger event or a role that may start it is added, or removed; or a trigger's filters loosen (a filter dropped, an inclusion filter such as `branches` given more values, an exclusion filter such as `paths-ignore` fewer), or tighten |
  | `budget-raised` | `budget-lowered` | The timeout, turn, tool call or AI credit limit rises (or is dropped), or falls |
  | `workflow-added` | `workflow-removed` | A workflow arrives (with the safe outputs it can write) or leaves |
  | `lock-stale` | `lock-current` | The compiled lock file becomes stale or missing, or current again |
  | `unrecognized-field` | | The front matter gains a field the extractor's pinned gh-aw schema doesn't know |
  | | `engine-changed`, `triggers-changed`, `loads-changed`, `group-changed` | Another engine or model; a trigger that changes in no clear direction (a schedule, a command's name, `draft`); other (unclassified) imports or skills; workflows joining or leaving a group |

- **Summaries**: one sentence per interpreted change and per step, from its most
  severe interpretation, for example
  ``"`docs-bot` no longer loads `skills/check-links` (`guardrail`)."`` or
  ``"`repo-ask` can reach more of the network: `*.readthedocs.io`, `python`."``
- **Order**: steps are presented by their widest change, a dropped gate first,
  then repositories, permissions, bash, network, outputs, tools, secrets and
  budgets; ties keep the default order.

A limit gh-aw defaults (a safe output's `max`, the timeout, AI credits) is
compared at its default, which the extractor records; a limit dropped back to
gh-aw's default, or to no limit, counts as raised. An expression (`${{ … }}`) is
compared only for equality.

A workflow whose front matter can't be read on either side (the extractor's
`invalid` finding) isn't interpreted: the extractor's finding says why, and
comparing what little it has would report false widenings. Splits and merges (an
extraction's `previousIds`) keep the default comparison too.

## Use it

Copy `agentic-workflows.comparator.yaml` into your repository and name it in the
projection definition. Its one option, `gates`, lists the classes whose removal
is a warning (default `["*"]`, every class the extractor's `classes` input
defines):

```json
{
  "id": "agentic-workflows",
  "extractor": "github-agentic-workflows",
  "comparator": {
    "file": ".github/projections/agentic-workflows.comparator.yaml",
    "options": {"gates": ["guardrail"]}
  },
  "inputs": {"groups": "prefix", "classes": {"guardrail": ["skills/check-*"]}}
}
```

Rules run sandboxed and need no trust, everywhere comparisons are viewed,
including hosted views, which run the comparator file from the pull request's
base, so a pull request can't change how it is judged; see
[where custom comparators run today](../../../docs/guides/comparators.md#where-custom-comparators-run-today).

## Tests

[`agentic-workflows.comparator.test.yaml`](agentic-workflows.comparator.test.yaml)
states what a reviewer should read in the extractor's fixtures (the `docs-bot`
and `repo-ask` pull requests, each direction) and in
[hand-made edges](fixtures/), one workflow per decision. Together they cover
every function, expression and branch of the rules, which
`npm run test:rust:rules-coverage` holds at 100%. Copy the test file beside the
comparator file (with fixtures of your own) and
`projections check -p <id> --no-render` runs it; here:

```sh
cargo test -p projections-cli --test comparator_tests   # every *.comparator.test.yaml in the repository
UPDATE_COMPARATOR_TESTS=1 cargo test -p projections-cli --test comparator_tests   # rewrite the snapshots
```
