# One model for agentic workflows

Status: **adopted** for GitHub Agentic Workflows. The
[`github-agentic-workflows`](../../packages/extractors/github-agentic-workflows/README.md)
extractor produces this model, and the
[`agentic-workflows` comparator](../../packages/comparators/agentic-workflows/README.md)
interprets changes to it. Rather than mirroring gh-aw's raw field names, the
vocabulary describes what an agentic workflow is allowed to do. That way, other
agent automation systems — like a coding agent's repository config or a
different workflow compiler — can target the same model.

An agentic workflow is an AI agent that runs unattended. Something triggers it,
it reaches tools, repositories, and the network, it writes through declared
outputs, and budgets keep it bounded. When a pull request edits a workflow, it
changes what that unattended agent is permitted to do. Reviewers need to see the
direction of every change at a glance: a new repository it can read, a domain it
can reach, an output it can write, a higher budget, or a guardrail it stopped
loading. This model separates each of those capabilities into its own comparable
fact.

## Ground rules

- **The declaration is the workflow.** Extractors read only what the repository
  declares in the front matter and its imports, never a live run.
- **Keep unknown fields instead of dropping them.** If the extractor encounters
  a field it doesn't recognize, it records the field under `unrecognized` and
  preserves its value so changes to it still show up in diffs.
- **Record defaults explicitly only when they are known.** When gh-aw applies a
  documented default budget, the extractor records it with `declared: false`.
  Anything else that isn't declared stays absent.
- **Stay deterministic.** Lists are always sorted (or kept in declaration order
  when order matters), regardless of the order files are discovered on disk.

## Entities

Everything here builds on ordinary `architecture/v0`
([contracts](../contracts/extractions.md)). Extractions declare
`"vocabularies": ["agentic-workflows/v0"]`, and the engine validates the fields
typed in
[`vocabularies/agentic-workflows`](../reference/schemas/vocabularies-agentic-workflows.md).
The remaining fields are documented below and left open.

### workflow

There is one workflow entity per workflow file. Its ID is `workflow:<path>`, and
its label is the file name without `.md`.

<!-- prettier-ignore -->
| Field | Meaning |
| --- | --- |
| `path`, `name`, `description` | The file path, along with the declared name and description (`null` if omitted) |
| `group` | The workflow's group, if the definition groups workflows together |
| `triggers` | `[{event, detail?, filters?}]` grouped by event — for example `schedule` with `weekly on monday`, or `pull_request` with `types: opened`. `filters` maps each setting that narrows when the event fires (`branches`, `paths-ignore`, `types`, `draft`, …) to a list of strings. A string `on` becomes a single trigger as written |
| `activation` | `{roles, rolesDeclared, settings}`: who can trigger the workflow (defaulting to gh-aw's `admin`, `maintainer`, `write` when undeclared) plus any other activation settings (reactions, skip conditions, manual approval) as written |
| `engine` | `{id, model?, version?, declared}`, defaulting to `copilot` when undeclared |
| `tools` | The tools the agent is allowed to use (`github`, `bash`, `edit`, `web-fetch`, `cache-memory`, …) |
| `github` | `{toolsets, repos, settings}`: the GitHub tool's toolsets (`default` when none are named), its `allowed-repos` guard (`null` when absent), and `readOnly`, `lockdown`, `minIntegrity`, `mode`, `allowed` |
| `bash` | Allowed shell commands (`*` for any), or `null` when bash is disabled |
| `mcpServers` | Custom MCP servers by name |
| `network` | `{allowed, blocked, declared}`: allowed and blocked domains or ecosystems (`defaults`, `python`), falling back to `defaults` when undeclared |
| `permissions` | Scope mapped to `read`, `write`, or `none` (with `read-all` and `write-all` recorded under scope `all`), or `null` when undeclared |
| `safeOutputs` | `{handlers, jobs, staged, allowedDomains, sources}`: each handler has `{kind, max?, maxDeclared?, target?, targetRepo?, allowedRepos?, allowed?, workflows?, draft?, staged?}`, using gh-aw's documented default `max` (with `maxDeclared: false`) when none is set |
| `secrets` | Secret names referenced in the front matter and its imports |
| `imports` | `[{path, resolved?, found, classes, via?, agent?}]`, resolved transitively. `via` points to the import that pulled it in, and `agent` flags a custom agent file (`.github/agents/*.md`), whose front matter follows Copilot's agent format instead of gh-aw's |
| `skills` | `[{ref, name, classes}]` in declaration order, where `name` is the reference without its `@ref` |
| `limits` | `{timeoutMinutes, maxTurns?, maxToolCalls?, maxAiCredits, maxDailyAiCredits}`, each shaped as `{value, declared}`, where the value is a number, `unlimited`, or an expression as written |
| `custom` | `{jobs, steps}`: custom job names and counts of custom steps by location |
| `concurrency`, `strict` | The concurrency group and whether strict mode is enabled |
| `sources` | Maps `section:item` to the imports that contribute an item the workflow didn't declare directly (for example `network:*.sentry.io`) |
| `lock` | `{path, status, compiler?, body?, reason?}`, where status is `current`, `stale`, `missing`, or `unverified` |
| `unrecognized`, `unrecognizedValues` | Fields the pinned schema doesn't define in the workflow or its imports, recorded as dotted paths (import fields are prefixed with their path and a colon, such as `shared/x.md: tools.github.telepathy`), paired with each value as `{field, value, via?}` so value-only edits still register as changes |
| `deprecated` | Renamed fields read under their current names as `{field, now, codemod, via?}`, with `via` naming the import that uses them |
| `findings` | `[{kind, message}]` warnings for this revision (`lock-stale`, `lock-missing`, `lock-unverified`, `newer-compiler`, `unrecognized`, `deprecated`, `invalid`), where `message` is text with inline code |

### group

A `group` represents workflows that operate together. Its ID is `group:<name>`,
its `workflows` field lists the member names, and it has a `contains`
relationship to each member.

## Relationships

<!-- prettier-ignore -->
| Kind | From → to | Meaning |
| --- | --- | --- |
| `contains` | group → workflow | The workflow belongs to the group |
| `dispatches` | workflow → workflow | The workflow's `dispatch-workflow` or `call-workflow` safe output can trigger the target workflow |

## Direction of change

With unattended agents, risk comes down to direction. A change **widens** what
an agent can do when it adds a trigger, role, tool, toolset, repository (or
removes the `allowed-repos` guard), bash command, MCP server, network domain,
permission (or elevates an existing one), safe output (or raises its limit or
adds a target repository), secret, or higher budget. It also widens access when
it lowers `min-integrity`, turns off `read-only`, `lockdown`, `strict`, or
`staged`, or stops loading a classified import or skill that acted as a
guardrail.

Doing the opposite **narrows** what the agent can do. The
[comparator file](../../packages/comparators/agentic-workflows/README.md)
determines the direction of every change using only these fields.
