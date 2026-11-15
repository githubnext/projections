---
description: "A GitHub Actions workflow's job graph (dag/v0)"
---

# GitHub Actions jobs — `dag/v0`

`github-actions-jobs` describes the job graph a GitHub Actions workflow
**declares**: one `job` entity per job, labeled with its `name` (otherwise its
ID), and a `precedes` relationship from each job to every job that `needs` it.

```json
{
  "id": "ci-jobs",
  "extractor": "github-actions-jobs",
  "renderer": "dag",
  "inputs": { "workflowPath": ".github/workflows/ci.yml" }
}
```

- `workflowPath` (required): the repository-relative workflow file.

Reading the workflow runs nothing and needs no trust. Job IDs are the workflow's
job keys (`job:<id>`), so renaming a job's `name` modifies it while renaming its
key replaces it. `needs` may be one job or a list.

It is a declaration graph, not the evaluated run: matrix expansion, reusable
workflows (a `uses:` job is one job), expressions, `if:` conditions and runtime
scheduling are not evaluated. Steps, environment values and secrets are not
copied into the graph.

The extraction fails, rather than guessing, on malformed YAML, duplicate keys, a
missing or empty `jobs` mapping, `needs` that name an undeclared job or use an
expression, and `needs` cycles, which it reports as a path such as
`build → test → build`.

For an evaluated pipeline (another CI system, or what actually ran), write a
custom extractor that emits `dag/v0` jobs and `precedes` relationships.
