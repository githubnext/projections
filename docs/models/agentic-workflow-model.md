# One model for agentic workflows

Status: **adopted** for GitHub Agentic Workflows. The
[`github-agentic-workflows`](../../packages/extractors/github-agentic-workflows/README.md)
extractor writes it. The vocabulary names what an agentic workflow is allowed to
do rather than gh-aw's field names, so other agent automation (a coding agent's
repository configuration, another workflow compiler) can write the same model.

An agentic workflow is an AI agent that runs on its own: something starts it, it
reaches tools, repositories and the network, it writes through declared outputs,
and budgets bound it. A pull request that changes one changes what an unattended
agent may do, and a reviewer needs to know in which direction: a new repository
it can read, a domain it can reach, an output it can write, a higher budget, or
a guardrail it no longer loads. This model keeps each of those a separate,
comparable fact.

## Ground rules

- **The declaration is the workflow.** Extractors read what the repository
  declares (the front matter and what it imports), never a run.
- **Unknown is kept, not dropped.** A field the extractor doesn't know is listed
  in `unrecognized`, and its value still changes the item.
- **Defaults are explicit only where they are known.** A budget gh-aw defaults
  is recorded with `declared: false`; anything else absent is absent.
- **Deterministic.** Every list is sorted (or in declaration order, where order
  means something), whatever order files are listed in.

## Entities

Everything is ordinary `architecture/v0`
([contracts](../contracts/extractions.md)). Extractions declare the vocabulary,
`"vocabularies": ["agentic-workflows/v0"]`, and the engine checks the fields
[`vocabularies/agentic-workflows`](../reference/schemas/vocabularies-agentic-workflows.md)
types; the others are documented here and stay open.

### workflow

One per workflow file, ID `workflow:<path>`, labeled with its file name without
`.md`.

<!-- prettier-ignore -->
| Field | Meaning |
| --- | --- |
| `path`, `name`, `description` | The file, and the name and description it declares (`null` when none) |
| `group` | Its group, when the definition groups workflows |
| `triggers` | `[{event, detail?, filters?}]` by event: `schedule` with `weekly on monday`, `pull_request` with `types: opened`. `filters` maps each setting that restricts when the event starts it (`branches`, `paths-ignore`, `types`, `draft`, …) to a list of strings. A string `on` is one trigger as written |
| `activation` | `{roles, rolesDeclared, settings}`: who may start it (gh-aw's default `admin`, `maintainer`, `write` when undeclared) and the other activation settings (reactions, skip conditions, manual approval) as written |
| `engine` | `{id, model?, version?, declared}`; `copilot` when undeclared |
| `tools` | The tools its agent may use: `github`, `bash`, `edit`, `web-fetch`, `cache-memory`, … |
| `github` | `{toolsets, repos, settings}`: the GitHub tool's toolsets (`default` when it names none), its `allowed-repos` guard (`null` without one) and `readOnly`, `lockdown`, `minIntegrity`, `mode`, `allowed` |
| `bash` | Allowed commands (`*` for any), or `null` when bash isn't enabled |
| `mcpServers` | Custom MCP servers by name |
| `network` | `{allowed, blocked, declared}`: domains and ecosystems (`defaults`, `python`); `defaults` when undeclared |
| `permissions` | Scope to `read`, `write` or `none`; `read-all` and `write-all` as scope `all`; `null` when undeclared |
| `safeOutputs` | `{handlers, jobs, staged, allowedDomains, sources}`: each handler `{kind, max?, maxDeclared?, target?, targetRepo?, allowedRepos?, allowed?, workflows?, draft?, staged?}`, with gh-aw's documented default `max` (and `maxDeclared: false`) when it sets none |
| `secrets` | Secret names its front matter and imports reference |
| `imports` | `[{path, resolved?, found, classes, via?, agent?}]`, transitively; `via` names the import that imported it, and `agent` marks a custom agent file (`.github/agents/*.md`), whose front matter follows Copilot's agent format, not gh-aw's |
| `skills` | `[{ref, name, classes}]` in declaration order; `name` is the reference without its `@ref` |
| `limits` | `{timeoutMinutes, maxTurns?, maxToolCalls?, maxAiCredits, maxDailyAiCredits}`, each `{value, declared}`; a value is a number, `unlimited` or an expression as written |
| `custom` | `{jobs, steps}`: custom job names and how many custom steps run where |
| `concurrency`, `strict` | The concurrency group, and whether strict mode applies |
| `sources` | `section:item` to the imports that add an item the workflow doesn't declare itself (`network:*.sentry.io`) |
| `lock` | `{path, status, compiler?, body?, reason?}`: `current`, `stale`, `missing` or `unverified` |
| `unrecognized`, `unrecognizedValues` | Fields the pinned schema doesn't declare in the workflow or what it imports, as dotted paths (an import's prefixed with its path and a colon, `shared/x.md: tools.github.telepathy`), and each one's value as `{field, value, via?}`, so a change to the value alone changes the workflow |
| `deprecated` | Renamed fields read under their current names, `{field, now, codemod, via?}`; `via` names the import that uses one |
| `findings` | `[{kind, message}]`, warnings about this revision: `lock-stale`, `lock-missing`, `lock-unverified`, `newer-compiler`, `unrecognized`, `deprecated`, `invalid`. `message` is text with inline code |

### group

Workflows that work together, ID `group:<name>`, with `workflows`, the names of
its members. It `contains` each.

## Relationships

<!-- prettier-ignore -->
| Kind | From → to | Meaning |
| --- | --- | --- |
| `contains` | group → workflow | The workflow belongs to the group |
| `dispatches` | workflow → workflow | Its `dispatch-workflow` or `call-workflow` safe output can start the other |

## Direction of change

What makes a change risky is its direction. A change **widens** what an agent
may do when it adds a trigger, a role, a tool, a toolset, a repository (or drops
the `allowed-repos` guard), a bash command, an MCP server, a network domain, a
permission or a higher level of one, a safe output or a higher limit on one (or
a target repository), a secret, or a higher budget; when it lowers
`min-integrity`, turns off `read-only`, `lockdown`, `strict` or `staged`; and
when it stops loading a classified import or skill (a guardrail). The reverse
**narrows** it, and each is decidable from these fields alone.
