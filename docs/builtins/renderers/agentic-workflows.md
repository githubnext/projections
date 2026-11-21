# Agentic workflows

This renderer lays out agentic workflows the way a reviewer actually reads them:
one card per workflow, organized by group, showing what triggers it, which tools
and repositories it can reach, its network access, permissions, safe outputs,
budgets, loaded skills and imports, referenced secrets, engine, and lock file
status. Across a pull request, it answers the question that matters most: "what
can this agent do now that it couldn't do before?"

<!-- generated: facts -->

- Name: `agentic-workflows`
- Draws: [`architecture/v0`](../../reference/schemas/architecture.md) with the
  `agentic-workflows/v0` vocabulary
- Comparison modes: Diff, Side by side; a comparison opens in Diff
- Package: `@githubnext/projections-renderer-agentic-workflows`

<!-- end generated: facts -->

## When to use it

Use this renderer to review changes to GitHub Agentic Workflows or any
extraction written in the
[agentic workflow model](../../models/agentic-workflow-model.md). It surfaces
capability changes immediately—such as a new domain in the network allowlist,
another repository the GitHub tool can reach, `bash: true`, a higher AI credit
budget, or a guardrail that is no longer loaded. It only draws that model; for
other `architecture/v0` extractions, use [`graph`](graph.md).

Built-in extractors that use it by default:

<!-- generated: extractors -->

| Built-in extractor                                                      | Its default `renderer` |
| ----------------------------------------------------------------------- | ---------------------- |
| [`github-agentic-workflows`](../extractors/github-agentic-workflows.md) | `agentic-workflows`    |

<!-- end generated: extractors -->

## What it draws

Workflows are organized into one panel per group (from the extractor's
`groups`), followed by any ungrouped workflows. Each workflow is a card with
three parts:

- **Header.** Shows the workflow's name (or file name), path, engine and model,
  lock file state (`Lock current`, or `Lock stale` and `Lock missing` with a
  warning icon), and a notice when strict mode is off.
- **Capability rows.** Each section gets its own row:
  - **Starts on** lists triggers and any declared roles.
  - **Tools** lists tools, GitHub toolsets, MCP servers, and guards such as
    `min-integrity`.
  - **Repositories** shows the GitHub tool's `allowed-repos`, or notes when its
    token can reach any repository.
  - **Bash**, **Network**, and **Permissions** cover shell, network, and token
    access. **Permissions** shows `none` for `permissions: {}` (granting
    nothing) and is omitted when the workflow inherits GitHub's defaults.
  - **Writes** lists safe outputs with their `max`, target repository, and other
    limits, along with custom jobs.
  - **Budgets** lists timeout, turns, tool calls, and AI credits per run and per
    day when declared. In a comparison, it also shows the default a declared
    budget moves to or from, marked `(default)`.
  - **Loads** lists skills and imports along with their classes (such as
    `guardrail`), and **Secrets** lists referenced secrets. **Starts on**,
    **Network**, and **Writes** always appear; the other rows appear only when
    they have entries. Imported items note where they came from
    (`*.sentry.io via shared/otlp.md`), and gh-aw defaults are marked explicitly
    (`max 1 (default)`).
- **Warnings.** Listed at the bottom of the card for stale or missing lock
  files, fields unknown to the pinned gh-aw schema, and renamed fields along
  with the `gh aw fix` codemod that migrates them.

You can also switch to the **Matrix** view (see below), which lays out the same
workflows in a single table—one row per workflow under its group, and one column
per capability across the set (loaded items with gates first, tools, writes, and
network access).

## Options

| Control | `presentation.rendererOptions` | Values                        |
| ------- | ------------------------------ | ----------------------------- |
| View    | `view`                         | `cards` (default) or `matrix` |

## What a comparison shows

Comparisons open in Diff mode and also support Side by side.

In **Diff** mode:

- **Entries** that are added or removed appear as pills with `+` or `−` in the
  change's color. An entry that changes in place reads old → new
  (`timeout 60 min` → `timeout 30 min`), or splits into a removed pill and an
  added pill when it is too long for one line. Card-level changes like engine,
  strict mode, and lock state follow the same pattern.
- **Cards and groups** are filled and bordered in their change color and labeled
  in words (`Modified`, `Added`). In the matrix view, added or removed
  capabilities show their sign in color, and each row states its change.
- **Scope directions** appear when paired with the
  [`agentic-workflows` comparator](../../../packages/comparators/agentic-workflows/README.md).
  Any section that expands the agent's reach is marked **Widened** with a
  warning icon at the end of its title; a section that tightens it is marked
  **Narrowed**.

In **Side by side** mode, each pane renders its own revision and tints entries
that differ from the other side whenever the host's change highlighting is on.

The summary bar counts workflows, groups, and dispatches, followed by any
out-of-date lock files. With the comparator enabled, it also lists widenings
from most severe to least, each acting as a filter—for example,
`1 gate removed`, `1 repository scope widened`, and `2 outputs widened`.

## Start from this definition

<!-- generated: definition -->

```json
{
  "extractor": "github-agentic-workflows",
  "id": "github-agentic-workflows",
  "renderer": "agentic-workflows",
  "title": "Agentic workflows"
}
```

<!-- end generated: definition -->

## Screenshot

![The agentic-workflows renderer's diff of the docs-bot pull request with the comparator: docs-bot's sections marked Widened, its check-links guardrail removed and octo-org/docs-site added](../../images/comparators/agentic-workflows.png)

## Limitations

- It only shows what the extraction declares; gh-aw's compiled workflow (the
  jobs and steps inside the lock file) isn't drawn.
- Long sections wrap inside their card, and the matrix view scrolls horizontally
  when there are more capabilities than fit on screen.
- Without the comparator, added and removed entries are still marked, but
  nothing indicates whether a change widens or narrows the agent's scope.

## Related

- [`github-agentic-workflows`](../extractors/github-agentic-workflows.md) — the
  extractor that targets this renderer.
- [The agentic workflow model](../../models/agentic-workflow-model.md) and the
  [`agentic-workflows` comparator](../../../packages/comparators/agentic-workflows/README.md).
- [`runtime-policy`](runtime-policy.md) — another document-style renderer for a
  security model.

## How it works

See the
[package README](../../../packages/renderers/agentic-workflows/README.md) for
details on the view and how it's tested.

## Build your own

Build a custom renderer when workflow cards aren't the view you need—for
example, a graph of which workflows dispatch one another, a schedule timeline,
or a breakdown of a single workflow's compiled jobs. Start from the
[minimal template](../../../examples/renderers/minimal/README.md) or follow
[develop a renderer](../../guides/develop-a-renderer.md) with the
[renderer kit](../../guides/renderer-kit.md), and declare that it accepts
`architecture/v0` with the `agentic-workflows/v0` vocabulary.
