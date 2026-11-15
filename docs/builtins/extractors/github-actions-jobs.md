# GitHub Actions jobs

The jobs one GitHub Actions workflow declares and the order `needs` puts them
in, as a pipeline graph. Compared across a pull request, it answers "which jobs
did this change add, remove or rename, and what now waits for what?"

<!-- generated: facts -->

- ID: `github-actions-jobs`
- Extraction schema: [`dag/v0`](../../reference/schemas/dag.md)
- Drawn by default with: [`dag`](../renderers/graph.md)
- Needs `--trust`: No (`none`)
- Suggested when the repository has: `.github/workflows/*.yml`,
  `.github/workflows/*.yaml`

<!-- end generated: facts -->

## When to use it

Use it for a workflow whose shape matters to reviewers: a CI pipeline with
build, test and deploy stages, a release workflow with gates. It shows a new job
and what it waits for, a dropped `needs` that lets deploy run before the tests
finish, or a stage split in two, without reading the YAML diff. It reads the
workflow file and nothing else, so it runs on any pull request without
`--trust`, and a change to any other file reuses its cached extraction.

One definition covers one workflow; define one per workflow you want to watch.
It shows what the workflow declares, not what ran: for a run's timing or
results, or for another CI system, write your own extractor (below).

## What it reads

The workflow file at `workflowPath`, which is required. Each key under `jobs:`
is a `job` entity, labeled with the job's `name` (or its key when it has none).
Each job a job `needs`, one or a list, is a `precedes` relationship from that
job to the one that waits for it. IDs are the job keys (`job:build`), so
changing a job's `name` modifies it, while changing its key removes it and adds
another.

Nothing else about a job is read: its steps, runner, `if:` conditions, matrix,
environment and secrets aren't in the graph.

The extraction fails, rather than guessing, on malformed YAML, duplicate keys, a
workflow with no jobs, `needs` that names a job the workflow doesn't declare or
uses an expression, and a cycle of `needs`, which the error names
(`build → test → build`).

## Options

<!-- generated: inputs -->

| Input          | Meaning                       |
| -------------- | ----------------------------- |
| `workflowPath` | GitHub Actions workflow path. |

<!-- end generated: inputs -->

## What a comparison shows

- **Jobs** added or removed, and jobs modified because their `name` changed.
- **Ordering** added or removed: each `needs` entry that appears or goes is a
  `precedes` relationship added or removed, so a job that no longer waits for
  the tests shows its edge leaving.

The [`dag`](../renderers/graph.md) renderer lays the jobs out in layers, first
jobs at the top, and keeps survivors in their layers through the change. Its
summary bar counts the jobs and their dependencies (`7 jobs · 6 dependencies`),
and how many of each were added, removed and modified; it adds no facts of its
own. One revision alone routes each set of jobs sharing the same prerequisites
through one join point, with a menu to inspect each dependency.

## Start from this definition

<!-- generated: definition -->

```json
{
  "extractor": "github-actions-jobs",
  "id": "github-actions-jobs",
  "inputs": {
    "workflowPath": ".github/workflows/ci.yml"
  },
  "renderer": "dag",
  "title": "GitHub Actions jobs"
}
```

<!-- end generated: definition -->

## Limitations

- It is the declared graph, not an evaluated run: a matrix job is one job, a job
  that calls a reusable workflow (`uses:`) is one job, and `if:` conditions,
  expressions and runtime scheduling aren't evaluated.
- Changes inside a job (its steps, runner, permissions or conditions) don't
  show: the job is unchanged unless its `name` or `needs` changed.
- Renaming a job's key is a removal and an addition. Declare known renames in
  the definition's `correspondence` (`{"job:test-unit": ["job:test"]}`) to
  compare them as one change.

## Related

- [`graph`](../renderers/graph.md), whose `dag` presentation draws it.
- [`command-output`](command-output.md), to compare what a CLI prints rather
  than how a pipeline is declared.
- [The default comparator](../comparators/default.md), which can order steps by
  how many jobs each one needs (`order.by: dependents`).

## How it works

The [package README](../../../packages/extractors/github-actions-jobs/README.md)
covers what the extractor reads and rejects.

## Build your own

Write your own extractor when the declared job graph isn't the pipeline you need
to review:

- **Another CI system**: GitLab CI stages, Azure Pipelines, Buildkite or
  Jenkins, or a build tool's task graph (Nx, Turborepo, Bazel).
- **The evaluated pipeline**: matrix jobs expanded, reusable workflows inlined,
  or what actually ran, with durations and results from the Actions API.
- **Facts the YAML doesn't state plainly**: which jobs deploy, which use secrets
  or which environments they target, as data a renderer or comparator can use.

Try the lighter option first: one definition per workflow, each with its own
`workflowPath`. To draw the same graph differently, keep this extractor and
write a renderer; to flag changes that matter (a deploy job that no longer waits
for the tests), add a comparator file.

**In VS Code**, choose **+ New Projection…** in the Projections view, then
**Write a custom extractor, renderer or comparator** › **Custom extractor** (or
**Custom extractor and renderer**), and pick its language. It writes the
definition and a starter extractor (`extract.mjs`, `extract.py` or `extract.go`)
under `.github/projections/<id>/`, drawn by the built-in graph renderer. Or
choose **Ask an agent to write it** and describe what the projection should
show.

**With the CLI**, keep the pipeline renderer:

```sh
projections init <id> --language node --renderer dag
```

Emit `dag/v0` with `job` entities and `precedes` relationships, and the `dag`
renderer draws it the same way. An extractor is any program that prints an
extraction. Run it with `projections show -p <id> --trust` as you change it; an
open projection tab uses your uncommitted edits ("Your edits") and says when its
results are out of date, and the Testing view runs the projection's checks.
[Write your first extractor](../../guides/first-extractor.md) walks through one,
and [Extraction schema](../../guides/schemas.md#extraction-schema) describes
what it prints.
