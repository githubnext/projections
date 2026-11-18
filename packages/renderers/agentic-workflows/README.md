---
description: "Built-in agentic workflows renderer: triggers, scope, outputs, budgets and the direction of each change"
---

# Agentic workflows renderer

`@githubnext/projections-renderer-agentic-workflows` presents agentic workflows,
or a comparison of two revisions of them, written in the
[agentic workflow model](../../../docs/models/agentic-workflow-model.md): one
card per workflow, in its group, with what a reviewer asks of an unattended
agent. It handles the definition renderer name `agentic-workflows` and is
composed from the [renderer kit](../kit/README.md)'s groups, cards and change
pills. The
[`github-agentic-workflows`](../../extractors/github-agentic-workflows/README.md)
extractor targets it; any extractor writing the model can.

## What it shows

- **A summary in the host's summary bar**: workflows, groups and dispatches,
  then how many lock files are out of date (stale or missing), in every view.
  With the
  [`agentic-workflows` comparator](../../comparators/agentic-workflows/README.md),
  a comparison also counts its widenings, most severe first, each filtering to
  its workflows: `1 gate removed`, `1 repository scope widened`,
  `2 outputs widened`. The view draws no summary of its own.
- **Groups**: a panel per group of workflows (the extractor's `groups`), then
  the workflows no group holds.
- **A card per workflow**: its name (or file name) and path, its engine and
  model, its lock file's state (`Lock stale`, with a warning icon) and whether
  strict mode is off, then a row per section: **Starts on** (triggers and
  declared roles), **Tools** (tools, GitHub toolsets, MCP servers and guards
  such as `min-integrity`), **Repositories**, **Bash**, **Network**,
  **Permissions**, **Writes** (safe outputs with their limits and target
  repositories), **Budgets**, **Loads** (skills and imports, with their classes,
  such as `guardrail`) and **Secrets**. An item an import added says so
  (`*.sentry.io via shared/otlp.md`); a default says so (`max 1 (default)`), and
  a budget left at its default shows only when the other revision declares it.
  `permissions: {}` reads `none`. The extractor's warnings close the card.
- **The matrix**, with the `view` control set to **Matrix**: a row per workflow
  under its group and a column per capability any workflow has (what it loads,
  gates first, its tools, what it writes and the network it reaches), and in a
  comparison each workflow's change.

## Comparisons

Diff (the default) and Side by side. In the diff each entry that arrives or
leaves is a pill with its sign, `+` or `−`, in its change's hue; one that
changes in place reads old → new, or, when that's too long for a line, as the
old pill leaving and the new one arriving; so does a card's engine, strict mode
or lock state. Each card and group carries its change, filled and edged as a kit
region, and states it in words. With the comparator, a section whose change it
interpreted says **Widened** (a warning icon) or **Narrowed** (an info icon) at
the end of its title. Side by side, each pane draws its own revision, tinting
the entries that differ from the other (arriving, leaving or changed in place)
while the host highlights the change. Change decoration never moves anything:
the same entries are laid out at every emphasis, and the direction labels sit
out of the flow.

## Development

```sh
npm run build -w @githubnext/projections-renderer-agentic-workflows
npm test -w @githubnext/projections-renderer-agentic-workflows    # model, summary and markup, with the comparator in the rules runtime
npm run test:browser -w @githubnext/projections-renderer-harness -- agentic-workflows/ --project chromium-desktop
```

[`scenarios.json`](scenarios.json) holds the gallery's scenarios: the docs-bot
and `repo-ask` pull requests from the extractor's fixtures, with and without the
comparator, the matrix, and one revision of public workflows.
