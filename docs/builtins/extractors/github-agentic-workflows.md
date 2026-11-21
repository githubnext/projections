# Agentic workflows

This extractor summarizes the unattended agent workflows a repository runs with
[GitHub Agentic Workflows](https://github.com/github/gh-aw) (gh-aw) around the
questions reviewers actually ask: what triggers each agent, what it can access
(tools, repositories, bash, network, permissions), what and how much it may
write, what budgets limit its cost, what shared files it loads, and whether its
compiled lock file still matches its source. Compared across a pull request, it
shows whether a change lets an agent reach further, write more, spend more, or
drop a guardrail.

<!-- generated: facts -->

- ID: `github-agentic-workflows`
- Extraction schema:
  [`architecture/v0`](../../reference/schemas/architecture.md)
- Drawn by default with:
  [`agentic-workflows`](../renderers/agentic-workflows.md)
- Needs `--trust`: No (`none`)
- Suggested when the repository has: `.github/workflows/*.md`

<!-- end generated: facts -->

## When to use it

Use this extractor in repositories running gh-aw workflows
(`.github/workflows/*.md` alongside their `.lock.yml` files) when you want to
review workflow changes by capability rather than combing through front matter
diffs. In raw YAML, an extra network domain, a second repository in
`allowed-repos`, or `bash: true` is easy to miss—and a widened allowlist can
even sneak in through a shared import without touching the workflow file at all.
Because this extractor only parses checked-in Markdown and lock headers, it
executes nothing and needs no `--trust`, so a projection defined on the base
branch can safely inspect pull requests from forks.

It models what the repository declares rather than what happened in a specific
run: actual tool calls, outputs written, and credits spent belong to run
telemetry rather than the workflow definition.

## What it reads

- **Workflows** include every `.md` file under `.github/workflows` (customized
  with `paths` and `exclude`) whose front matter declares `on`. Shared
  components and `README.md` are skipped automatically.
- **Front matter** covers triggers and activation (roles, bots, reactions, skip
  conditions), engine and model, tools and scope (GitHub toolsets,
  `allowed-repos`, `min-integrity`, bash commands, MCP servers), network
  allowlists, permissions, safe outputs with their limits and target
  repositories, referenced secrets, imports and skills, budgets (timeout, turns,
  tool calls, and per-run/per-day AI credits), custom jobs and steps,
  concurrency, and strict mode.
- **Imports** are resolved transitively and merged into each workflow the same
  way gh-aw merges them, preserving provenance so a domain introduced by a
  shared file shows as added _via_ that file.
- **Lock files** verify the hashes gh-aw writes into each `.lock.yml` by
  recomputing them from source. A lock file that no longer matches its workflow
  is flagged `stale`, and a missing one is flagged `missing`.

Use `groups` to cluster related workflows—either `"prefix"` (grouping `docs-bot`
with `docs-bot-links` and `docs-bot-examples`) or a map of globs. Use `classes`
to tag imports and skills by glob, such as `guardrail` for `skills/check-*`.

### gh-aw's changing front matter

Because gh-aw's front matter schema is evolving, this extractor pins one gh-aw
release (v1.3.0) and records it in every extraction (`metadata.ghAw`). Fields
not declared in that release are reported as unrecognized rather than failing or
being silently dropped. Fields renamed by gh-aw (`timeout_minutes`,
`on.command`, `tools.github.repos`, …) are read under their current names and
reported as deprecated alongside the `gh aw fix` codemod that migrates them. A
lock file compiled by a newer version of gh-aw produces a notice. See the
[package README](../../../packages/extractors/github-agentic-workflows/README.md#gh-aws-changing-front-matter)
for how the schema pin advances.

## Options

<!-- generated: inputs -->
<!-- prettier-ignore -->
| Input | Meaning |
|---|---|
| `classes` | An object of class name (such as guardrail) to globs of import paths and skill references; the comparator warns when a classified import or skill is removed. |
| `exclude` | Array of globs to skip. |
| `groups` | "prefix" to group each workflow with the workflows named after it and a dash, or an object of group name to globs of workflow paths or names. |
| `paths` | Array of globs selecting workflow markdown; default .github/workflows/*.md. Files without `on` (shared components) and README.md are skipped. |

<!-- end generated: inputs -->

## What a comparison shows

The [`agentic-workflows`](../renderers/agentic-workflows.md) renderer displays
one card per workflow inside its group, with a row for each section, in either
Diff or Side by side view. Because each workflow is one entity, any change to
its triggers, scope, outputs, budgets, imports, or lock state marks that
workflow as modified:

- **Section entries** added or removed (domains, repositories, toolsets, safe
  outputs, skills) appear as signed pills, while in-place updates show old → new
  (`max 1` → `max 3`).
- **Structure changes** highlight added or removed workflows, group membership
  changes, and `dispatches` between workflows.
- **Warnings** surface stale or missing lock files and unrecognized or renamed
  fields for the revision where they occur.

The summary bar tallies workflows, groups, and dispatches, followed by any out
of date lock files (`1 lock file out of date`). Switch to the **Matrix** view
(via the renderer's `view` control) to see all workflows cross-referenced
against what they load, use, write, and reach.

### Interpreting changes: the agentic-workflows comparator

The default comparator tells you _that_ a workflow changed. The
[`agentic-workflows` comparator file](../../../packages/comparators/agentic-workflows/README.md)
shipped with Projections tells you which direction it moved—flagging changes
that widen an unattended agent's authority as warnings, and changes that narrow
it as notes. Copy
`packages/comparators/agentic-workflows/agentic-workflows.comparator.yaml` into
your repository and reference it in your definition:

```json
"comparator": {"file": ".github/projections/agentic-workflows.comparator.yaml", "options": {"gates": ["guardrail"]}}
```

It keeps the default comparator's matching and statuses while adding:

- **Directional interpretations** for each change, labeling widenings as
  warnings and narrowings as notes: `gate-removed` (a classified import or skill
  like a `check-*` guardrail was dropped), `repos-widened`,
  `permissions-widened`, `bash-widened`, `network-widened`, `outputs-widened` (a
  new safe output, higher `max`, or additional target repo), `tools-widened` (a
  new tool, MCP server, or toolset, or a lower `min-integrity`),
  `secrets-added`, `strict-disabled`, `triggers-widened`, `budget-raised`,
  `workflow-added`, `lock-stale`, and `unrecognized-field`.
- **Plain-English summaries**, one sentence per change based on its most severe
  finding—for example, "`docs-bot` no longer loads `skills/check-links`
  (`guardrail`)." or "`repo-ask` can reach more of the network:
  `*.readthedocs.io`, `python`."
- **Risk-first ordering**, sorting steps by their widest change with dropped
  gates at the top.

Comparator rules run sandboxed without requiring trust in the CLI, VS Code, and
hosted views. In hosted views, the comparator file is loaded from the pull
request's base branch, so a PR cannot alter the rules judging it.

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

![The agentic-workflows renderer's diff view of the docs-bot pull request with the agentic-workflows comparator: docs-bot's sections marked Widened, a removed check-links guardrail and an added octo-org/docs-site repository](../../images/comparators/agentic-workflows.png)

## Limitations

- gh-aw's compiler does not run during extraction. Natural-language triggers
  (`on: daily`, `push to main`) remain as written, and gh-aw defaults are filled
  in only for network (`defaults`), GitHub toolsets (`default`), roles, engine
  (`copilot`), timeout (20 minutes), and AI credits (1,000 per run, with no
  daily limit).
- Imports from external repositories are listed but not fetched (gh-aw fetches
  them at compile time). Runtime imports (`{{#runtime-import}}`) participate in
  the lock-hash check, though their contents are not modeled.
- The workflow's prompt (its Markdown body) is not modeled beyond whether it
  changed since the lock file was compiled.
- Renaming a workflow file appears as a removal and an addition unless you
  declare a `correspondence` entry in your definition.

## Related

- [`agentic-workflows`](../renderers/agentic-workflows.md) is the renderer that
  displays these workflows.
- [`github-actions-jobs`](github-actions-jobs.md) graphs the jobs of standard
  Actions workflows, including compiled lock files.
- [One model for agentic workflows](../../models/agentic-workflow-model.md)
  documents the vocabulary this extractor emits, alongside the
  [`agentic-workflows` comparator file](../../../packages/comparators/agentic-workflows/README.md)
  that interprets it.
- [The default comparator](../comparators/default.md) is the foundation the
  comparator file builds on.

## How it works

See the
[package README](../../../packages/extractors/github-agentic-workflows/README.md)
for details on parsing, gh-aw schema evolution, and how lock verification
matches gh-aw.

## Build your own

Consider writing a custom extractor when gh-aw's declarations are not what you
need to review:

- **Another agent platform**, such as a coding agent's repository config or a
  different workflow compiler's source files. Emit the same
  [agentic workflow model](../../models/agentic-workflow-model.md) to reuse this
  renderer.
- **Actual run behavior**, pulling the tools an agent called, outputs it wrote,
  and credits it spent from the Actions API or gh-aw logs.

Check the built-in options first: `paths` and `exclude` select which workflows
to include, `groups` organizes them into units, and `classes` tags important
imports and skills. If you only want to tune what counts as widening or how
summaries are phrased, edit your copy of the comparator file instead of writing
a new extractor.

**In VS Code**, open the Projections view, choose **+ New Projection…**, and
select **Write a custom extractor, renderer or comparator** › **Custom
extractor** (or **Custom extractor and renderer**), then pick a language. You
can also choose **Ask an agent to write it** and describe what you want to see.

**With the CLI**, scaffold a new extractor while keeping the `agentic-workflows`
renderer:

```sh
projections init <id> --language node --renderer agentic-workflows
```

An extractor is any program that prints an extraction—in this case, an
`architecture/v0` extraction declaring the
[`agentic-workflows/v0` vocabulary](../../reference/schemas/vocabularies-agentic-workflows.md).
Run `projections show -p <id> --trust` as you iterate. Walk through
[Write your first extractor](../../guides/first-extractor.md) to get started,
and check [Extraction schema](../../guides/schemas.md#extraction-schema) for the
output format.
