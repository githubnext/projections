# GitHub Actions jobs

This extractor turns a single GitHub Actions workflow into a pipeline graph of
its jobs and `needs` dependencies. Compared across a pull request, it shows
which jobs were added, removed, or renamed, and how execution order changed.

<!-- generated: facts -->

- ID: `github-actions-jobs`
- Extraction schema: [`dag/v0`](../../reference/schemas/dag.md)
- Drawn by default with: [`dag`](../renderers/graph.md)
- Needs `--trust`: No (`none`)
- Suggested when the repository has: `.github/workflows/*.yml`,
  `.github/workflows/*.yaml`

<!-- end generated: facts -->

## When to use it

Use this extractor for workflows where job ordering matters to reviewers—a CI
pipeline with build, test, and deploy stages, or a release workflow with
approval gates. Instead of tracing dependencies through a YAML diff, you can
immediately spot a new job and its prerequisites, a dropped `needs` entry that
lets deploy run before tests pass, or a stage split in two. Because it only
reads the workflow file, it runs safely on any pull request without `--trust`,
and edits to other files reuse the cached extraction.

Each definition tracks one workflow, so add one definition per workflow you want
to monitor. It models what the YAML declares rather than runtime execution; if
you need run timings, outcomes, or support for another CI platform, write a
custom extractor (see below).

## What it reads

You must specify `workflowPath` to point at the workflow file. Each key under
`jobs:` becomes a `job` entity, labeled with its `name` (falling back to its key
when omitted). Every `needs` entry—whether a single job or a list—becomes a
`precedes` relationship from the prerequisite job to the job waiting on it.
Entity IDs come from job keys (`job:build`), so changing a job's `name` shows as
a modification, while renaming its key appears as a removal and an addition.

Everything else inside a job—steps, runners, `if:` conditions, matrices,
environments, and secrets—is intentionally excluded from the graph.

Rather than guessing, extraction fails on malformed YAML, duplicate keys, a
workflow with no jobs, a `needs` reference to an undeclared job or expression,
or a dependency cycle (which the error spells out, such as
`build → test → build`).

## Options

<!-- generated: inputs -->

| Input          | Meaning                       |
| -------------- | ----------------------------- |
| `workflowPath` | GitHub Actions workflow path. |

<!-- end generated: inputs -->

## What a comparison shows

- **Added, removed, or renamed jobs** highlight jobs introduced, deleted, or
  given a new `name`.
- **Ordering changes** show every added or removed `needs` entry as a `precedes`
  edge arriving or disappearing, making it obvious when a job stops waiting for
  tests.

The [`dag`](../renderers/graph.md) renderer arranges jobs in layers from top to
bottom and keeps surviving jobs in their layers across changes. Its summary bar
counts jobs and dependencies (`7 jobs · 6 dependencies`) along with how many
were added, removed, or modified, without adding extra computed facts. When
viewing a single revision, jobs that share the same prerequisites route through
a single join point with a menu to inspect each dependency.

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

- The graph shows the declared workflow, not an evaluated run. Matrix jobs and
  reusable workflow calls (`uses:`) each appear as a single job, and `if:`
  conditions, expressions, and runtime scheduling are not evaluated.
- Edits inside a job (steps, runner, permissions, or conditions) do not appear
  unless the job's `name` or `needs` also changed.
- Renaming a job key shows up as a removal and an addition. If you want to track
  a known rename as one change, declare it in `correspondence` in your
  definition (for example, `{"job:test-unit": ["job:test"]}`).

## Related

- [`graph`](../renderers/graph.md) renders this extractor using its `dag`
  presentation.
- [`command-output`](command-output.md) compares CLI output rather than how a
  pipeline is declared.
- [The default comparator](../comparators/default.md) can order review steps by
  how many downstream jobs depend on each change (`order.by: dependents`).

## How it works

See the
[package README](../../../packages/extractors/github-actions-jobs/README.md) for
what the extractor parses and what validation errors it raises.

## Build your own

Consider writing a custom extractor when the declared job graph is not enough
for your reviews:

- **Another CI or build system**, such as GitLab CI stages, Azure Pipelines,
  Buildkite, Jenkins, or a task graph from Nx, Turborepo, or Bazel.
- **An evaluated pipeline**, expanding matrix jobs, inlining reusable workflows,
  or pulling actual durations and outcomes from the Actions API.
- **Extra metadata not stated plainly in YAML**, like which jobs deploy, which
  touch secrets, or which environments they target, exposed for a renderer or
  comparator.

Try the simplest path first: add one definition per workflow with its own
`workflowPath`. To change how the graph is drawn, keep this extractor and write
a custom renderer; to flag risky ordering changes (like a deploy job that no
longer waits on tests), add a comparator file.

**In VS Code**, open the Projections view, choose **+ New Projection…**, and
select **Write a custom extractor, renderer or comparator** › **Custom
extractor** (or **Custom extractor and renderer**). Pick a language to scaffold
the definition and a starter extractor (`extract.mjs`, `extract.py`, or
`extract.go`) under `.github/projections/<id>/`, paired with the built-in graph
renderer. You can also choose **Ask an agent to write it** and describe what you
want to see.

**With the CLI**, scaffold a new extractor while keeping the pipeline renderer:

```sh
projections init <id> --language node --renderer dag
```

Emit `dag/v0` with `job` entities and `precedes` relationships, and the `dag`
renderer will draw it the same way. An extractor is any program that prints an
extraction. Run `projections show -p <id> --trust` while you iterate—an open
projection tab picks up your uncommitted edits ("Your edits") and flags stale
results, and the Testing view runs your projection's checks. Walk through
[Write your first extractor](../../guides/first-extractor.md) to get started,
and check [Extraction schema](../../guides/schemas.md#extraction-schema) for the
output format.
