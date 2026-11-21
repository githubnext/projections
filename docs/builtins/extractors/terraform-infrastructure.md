# Terraform infrastructure

This extractor turns a Terraform (or OpenTofu) plan into a dependency graph of
your infrastructure: every resource and data source, the references connecting
them, their enclosing modules, and the action Terraform plans for each one.
Compared across a pull request, it shows which resources will be created,
updated, replaced, destroyed, or moved—and what depends on them.

<!-- generated: facts -->

- ID: `terraform-infrastructure`
- Extraction schema:
  [`architecture/v0`](../../reference/schemas/architecture.md)
- Drawn by default with: [`infrastructure`](../renderers/graph.md)
- Needs `--trust`: When it runs ecosystem tools or repository code
  (`when-executing-tools`)
- Suggested when the repository has: `*.tf`, `**/*.tf`

<!-- end generated: facts -->

## When to use it

Use this extractor alongside the plan output your pull requests already post in
any repository deploying with Terraform or OpenTofu. Text plans list resources
and attribute diffs, whereas this view highlights blast radius: you can
immediately see that replacing a database affects six resources referencing it.
Replaced resources stay in place with their edges intact, so downstream
dependencies remain easy to trace.

Because it reads Terraform's actual plan rather than parsing `.tf` files, it
always reflects what Terraform decided to do. It complements rather than
replaces the text plan—you can inspect attribute values here, while still
checking the raw plan for full details. For Azure Resource Manager templates and
Bicep, see [`azure-what-if`](azure-what-if.md).

## What it reads

The extractor reads plan JSON (from `terraform show -json`) in one of three
ways:

| Inputs         | What runs                                                                                  | Trust     |
| -------------- | ------------------------------------------------------------------------------------------ | --------- |
| `planJsonPath` | Nothing: it reads a plan JSON (or a state's) that CI or you exported                       | None      |
| `planPath`     | `terraform show -json` on a saved binary plan                                              | `--trust` |
| Neither        | `terraform plan` in `directory` (default the repository root), then `terraform show -json` | `--trust` |

When running plans directly, it uses **your** Terraform binary (`terraformPath`,
which also supports OpenTofu's `tofu`), your backend, and your cloud
credentials. Because planning reads state and refreshes against cloud APIs, pass
the required variables via `execution.environment` (such as `AWS_PROFILE`,
`ARM_CLIENT_ID`, `GOOGLE_APPLICATION_CREDENTIALS`, or `TF_VAR_…`) and increase
`execution.timeoutMs`.

It invokes plan with `-input=false -lock=false` plus any `planArguments` (which
cannot specify a plan file, directory, or destroy plan), reusing the providers
and modules already installed in your checkout's `.terraform` directory. It
never runs `init` or `apply`, and never persists the plan or its JSON to disk
since they can contain variable values. When using `planJsonPath`, the file is
read from each extracted revision, so every compared revision needs its own.

Each extraction represents the infrastructure **after applying that revision's
plan**, tagging every surviving resource with its planned `action` (`create`,
`update`, `replace`, `read`, `import`, or `forget`). Destroyed resources are
omitted from the post-apply graph and listed in `metadata.destroyed`.

- **Entities** cover `resource`, `data-source`, and `module` (a module call),
  each identified by its Terraform address. Cards show the resource name with
  its `count` or `for_each` index (`api[0]`) and its resource type
  (`aws_db_instance`).
- **Relationships** include `contains` edges from modules to their contents,
  `references` edges between resources (recording the referring attributes), and
  `dependsOn` edges for explicit `depends_on` declarations. References are
  traced through module outputs and input variables to the underlying resource.
- **Values** capture each managed resource's planned attributes. Anything
  Terraform marks sensitive—plus any string containing a sensitive value—is
  redacted to `(sensitive value)`, and values not known until apply appear as
  `(known after apply)`. Data sources don't store values since they're re-read
  on every plan.

## Options

<!-- generated: inputs -->

| Input           | Meaning                                                                                                          |
| --------------- | ---------------------------------------------------------------------------------------------------------------- |
| `directory`     | Terraform working directory to plan when neither file is given (requires --trust; default: the repository root). |
| `planArguments` | Extra `terraform plan` arguments, for example ["-var-file=prod.tfvars"].                                         |
| `planJsonPath`  | Pre-exported `terraform show -json` of a saved plan (or of the state); read without running Terraform.           |
| `planPath`      | Saved binary plan, read with `terraform show -json` (requires --trust).                                          |
| `terraformPath` | Terraform (or OpenTofu) executable; default `terraform`.                                                         |

<!-- end generated: inputs -->

## What a comparison shows

When the base revision is already applied, its plan is a no-op—so comparing base
to head shows your current infrastructure against the state after the pull
request applies. The graph renderer's [`infrastructure`](../renderers/graph.md)
presentation labels every change with its planned action badge:

- **Create** (or **Import**) for added resources, and **Destroy** for removed
  ones.
- **Update in place**, **Replace** (or **Replace, create first** when
  create-before-destroy is active), **Read**, or **Forget** for modified
  resources. Replacements are shown as modifying the same resource rather than a
  separate removal and addition.
- **Moved** for resources renamed via a `moved` block, preserving their incoming
  and outgoing references.

Modules frame the resources they contain. In **Diff** mode, modified resource
cards show inline attribute diffs with old values struck through—listing
attributes that force replacement first and `(known after apply)` values last
(showing three, plus a count of any remaining).

The summary bar tallies resources, data sources, and modules with their deltas,
followed by Terraform's familiar plan summary
(`2 to add · 3 to change · 1 to replace · 1 to destroy · 1 to move`), where each
count filters the graph. Viewing a single revision appends each resource's
pending action to its type (`aws_db_instance · Replace`) and summarizes those
actions in the bar.

With **Dependents** enabled (`dependents` in `presentation.rendererOptions`, on
by default), clicking a resource highlights everything that transitively
references it and notes the total number of dependents in the caption.

## Start from this definition

<!-- generated: definition -->

```json
{
  "extractor": "terraform-infrastructure",
  "id": "terraform-infrastructure",
  "inputs": {
    "planJsonPath": ".projections/inputs/terraform.json"
  },
  "renderer": "infrastructure",
  "title": "Terraform infrastructure"
}
```

<!-- end generated: definition -->

## Limitations

- Terraform's plan JSON omits locals, so references passing through a `local`
  can't be resolved (they are counted in `metadata.unresolvedReferences`).
- References to a `count` or `for_each` resource connect to all of its instances
  because configuration references the block as a whole—meaning it may
  over-report an edge, but will never hide a real dependency.
- Redaction relies on Terraform's own sensitivity markers, so make sure
  sensitive variables and outputs are declared as sensitive.
- Cross-state or cross-workspace references stop at the data source reading
  them; provider configurations and outputs aren't drawn.
- Because plans reflect live state at the time they run, re-planning the same
  revision later can produce different results.
- Requires plan JSON format 1.x and a checkout whose `.terraform` directory
  already has the needed providers and modules installed.
- The graph renders up to 500 entities and notes when any are omitted; for
  larger plans, scope to a single root module with `directory` or switch to the
  table view.

## Related

- [`graph`](../renderers/graph.md) — draws this graph using its `infrastructure`
  presentation.
- [`azure-what-if`](azure-what-if.md) — the same model for Azure Resource
  Manager and Bicep.
- [The infrastructure model](../../models/infrastructure-model.md) — the shared
  schema both extractors emit and why replacements are modeled as modifications.
- [The default comparator](../comparators/default.md) — supports ordering steps
  by dependent count (`order.by: dependents`).

## How it works

See the
[package README](../../../packages/extractors/terraform-infrastructure/README.md)
for details on plan parsing, reference resolution, and value redaction.

## Build your own

Consider writing a custom extractor if Terraform plans aren't what you want to
review:

- **Other IaC tools**, such as Pulumi, AWS CDK, CloudFormation, Crossplane, or
  Kubernetes manifests. Emit the same
  [infrastructure model](../../models/infrastructure-model.md) and the
  `infrastructure` presentation will render it automatically.
- **Extra operational data**, like cost estimates, resource ownership, policy
  check results, or live drift.
- **A different perspective**, such as module interfaces instead of individual
  resources, or network reachability instead of config references.

Check the built-in options first: `planArguments` forwards var files and flags,
`directory` targets a root module, and `planJsonPath` consumes plans your CI
already produces without running Terraform. To flag high-risk changes (like a
replaced database or destroyed bucket), add a comparator file; to change the
layout, toggle **Dependents** or write a custom renderer.

**In VS Code**, open the Projections view, select **+ New Projection…**, choose
**Write a custom extractor, renderer or comparator** › **Custom extractor** (or
**Custom extractor and renderer**), and pick a language. That creates the
definition and a starter extractor (`extract.mjs`, `extract.py`, or
`extract.go`) under `.github/projections/<id>/`, paired with the built-in graph
renderer. You can also choose **Ask an agent to write it** and describe what you
want to see.

**With the CLI**, keep this graph's renderer:

```sh
projections init <id> --language node --renderer infrastructure
```

An extractor can be any program that prints an extraction; to use the
`infrastructure` presentation, emit an `architecture/v0` extraction declaring
the
[`infrastructure/v0` vocabulary](../../reference/schemas/vocabularies-infrastructure.md).
Test changes as you go with `projections show -p <id> --trust`. An open
projection tab picks up your uncommitted edits ("Your edits") and flags stale
results, and the Testing view runs your projection's checks.
[Write your first extractor](../../guides/first-extractor.md) walks through a
complete example, and
[Extraction schema](../../guides/schemas.md#extraction-schema) documents the
output format.
