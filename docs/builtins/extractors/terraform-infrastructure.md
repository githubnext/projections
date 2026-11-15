# Terraform infrastructure

The infrastructure a Terraform (or OpenTofu) configuration describes, as a
graph: each resource and data source, the references between them, the modules
around them, and the action the plan takes to get each resource there. Compared
across a pull request, it answers "what does this change do to the system: which
resources are created, updated, replaced, destroyed or moved, and what depends
on them?"

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

Use it in a repository that deploys with Terraform or OpenTofu, beside the plan
output your pull requests already get. A plan lists resources and attribute
diffs; this shows the change in the system's structure, where the consequential
part is often not the resource that changes but what depends on it: "this
replaces the database, and six resources reference it." A replacement keeps the
resource's place and its arrows, so you see its dependents keep depending on it
through the replacement.

It reads Terraform's own plan, never the `.tf` source text, so what it shows is
what Terraform decided. It isn't a better plan diff: attribute values are there
to inspect, but a reviewer still reads the plan for the exact values. For Azure
Resource Manager templates and Bicep use [`azure-what-if`](azure-what-if.md).

## What it reads

The JSON of a plan, `terraform show -json`, in one of three ways:

| Inputs         | What runs                                                                                  | Trust     |
| -------------- | ------------------------------------------------------------------------------------------ | --------- |
| `planJsonPath` | Nothing: it reads a plan JSON (or a state's) that CI or you exported                       | None      |
| `planPath`     | `terraform show -json` on a saved binary plan                                              | `--trust` |
| Neither        | `terraform plan` in `directory` (default the repository root), then `terraform show -json` | `--trust` |

Planning uses **your** Terraform (`terraformPath`; OpenTofu's `tofu` works too),
your backend and your provider credentials: it reads state and refreshes it from
the cloud APIs, so grant the variables it needs through the definition's
`execution.environment` (for example `AWS_PROFILE`, `ARM_CLIENT_ID`,
`GOOGLE_APPLICATION_CREDENTIALS`, `TF_VAR_…`) and raise `execution.timeoutMs`.
It plans with `-input=false -lock=false`, adds `planArguments` (which may not
choose the plan file, the directory or a destroy plan), and uses the providers
and modules your checkout's `.terraform` directory already has installed.
Nothing ever runs `init` or `apply`, and the plan and its JSON are never saved,
since they contain variable values. A `planJsonPath` file is read from the
revision being extracted, so each revision you compare needs its own.

One extraction is the infrastructure **after applying that revision's plan**:
every resource that will exist, each with its planned `action` (`create`,
`update`, `replace`, `read`, `import` or `forget`). Resources the plan destroys
are left out and listed in `metadata.destroyed`.

- **Entities**: `resource`, `data-source` and `module` (a module call),
  identified by their Terraform address. A card's label is the resource name
  with its `count` or `for_each` key (`api[0]`), and its kind line the resource
  type (`aws_db_instance`).
- **Relationships**: `contains` from a module to what it holds, and `references`
  from a resource to each resource its configuration refers to, with the
  referring attributes, or `dependsOn` for `depends_on`. References are followed
  through module outputs and input variables to the resource behind them.
- **Values**: each managed resource's planned values. Values Terraform marks
  sensitive, and any other string containing one, become `(sensitive value)`;
  values unknown until apply become `(known after apply)`. Data sources carry no
  values, since every plan reads them again.

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

When the base revision is applied, its plan changes nothing, so its extraction
is the infrastructure as it is now and the head's is the infrastructure after
the pull request. The [`infrastructure`](../renderers/graph.md) presentation of
the graph renderer words each change as its planned action, as a badge and a
word:

- **Create** (or **Import**) for an added resource, **Destroy** for a removed
  one.
- **Update in place**, **Replace** (or **Replace, create first** when the new
  object is created before the old one is destroyed), **Read** or **Forget** for
  a modified one: a replacement is the same resource, modified, never a removal
  and an addition.
- **Moved** for a resource a `moved` block renamed, with the references to and
  from it, rather than a removal and an addition.

Modules are boundaries around their resources. In **Diff** mode a changed
resource's card lists its attribute changes, old value struck through before the
new one, with what forces a replacement first and values known only after apply
last (three, then a count of the rest).

The summary bar counts resources, data sources and modules, each with its
changes, then states the plan in Terraform's order and words
(`2 to add · 3 to change · 1 to replace · 1 to destroy · 1 to move`), each
filtering to its resources. A single revision shows each resource's pending
action after its type (`aws_db_instance · Replace`) and counts those actions in
the bar, as a plan's summary line does.

With the **Dependents** control (`dependents` in `presentation.rendererOptions`,
on by default), selecting a resource brings forward everything with a path of
references to it, and the caption says how many resources depend on it.

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

- Terraform's JSON omits locals, so references through a `local` aren't
  resolved; `metadata.unresolvedReferences` counts them.
- A reference to a `count` or `for_each` resource connects every instance, since
  the configuration describes the block, not each instance: it can show a
  dependency that doesn't exist, never hide one that does.
- It can only redact what Terraform marks sensitive: declare sensitive variables
  and outputs.
- References into another state or workspace end at the data source that reads
  them; provider configurations and outputs aren't drawn.
- Results depend on the state at plan time, so planning the same revision later
  can give another extraction.
- It needs plan JSON format 1.x, and a checkout whose `.terraform` directory
  already has the providers and modules the plan needs.
- The graph draws at most 500 entities and says when it leaves some out; for a
  larger plan, use a narrower projection (one root module or `directory`) or the
  table view.

## Related

- [`graph`](../renderers/graph.md), whose `infrastructure` presentation draws
  it.
- [`azure-what-if`](azure-what-if.md), the same model for Azure Resource Manager
  and Bicep.
- [The infrastructure model](../../models/infrastructure-model.md), which both
  write, and why a replacement is a modification.
- [The default comparator](../comparators/default.md), which can order steps by
  how many resources depend on each (`order.by: dependents`).

## How it works

The
[package README](../../../packages/extractors/terraform-infrastructure/README.md)
covers how the plan is read, references resolved and values redacted.

## Build your own

Write your own extractor when Terraform's plan isn't what you want to review:

- **Another deployment tool**: Pulumi, AWS CDK or CloudFormation, Crossplane, or
  Kubernetes manifests. Write the same
  [infrastructure model](../../models/infrastructure-model.md) and the
  `infrastructure` presentation draws it as it draws this one.
- **Facts the plan doesn't have**: cost estimates, the team that owns each
  resource, policy results, or drift found in the live environment.
- **Another grain**: modules and the interfaces between them rather than
  resources, or network reachability rather than references.

Try the lighter options first: `planArguments` passes var files and flags,
`directory` picks a root module, and `planJsonPath` reads a plan CI already made
without running anything. To draw the same graph differently, keep this
extractor and write a renderer, or turn off **Dependents**; to say which changes
are risky (a replaced database, a destroyed bucket), add a comparator file.

**In VS Code**, choose **+ New Projection…** in the Projections view, then
**Write a custom extractor, renderer or comparator** › **Custom extractor** (or
**Custom extractor and renderer**), and pick its language. It writes the
definition and a starter extractor (`extract.mjs`, `extract.py` or `extract.go`)
under `.github/projections/<id>/`, drawn by the built-in graph renderer. Or
choose **Ask an agent to write it** and describe what the projection should
show.

**With the CLI**, keep this graph's renderer:

```sh
projections init <id> --language node --renderer infrastructure
```

An extractor is any program that prints an extraction; for the `infrastructure`
presentation, an `architecture/v0` extraction that declares the
[`infrastructure/v0` vocabulary](../../reference/schemas/vocabularies-infrastructure.md).
Run it with `projections show -p <id> --trust` as you change it; an open
projection tab uses your uncommitted edits ("Your edits") and says when its
results are out of date, and the Testing view runs the projection's checks.
[Write your first extractor](../../guides/first-extractor.md) walks through one,
and [Extraction schema](../../guides/schemas.md#extraction-schema) describes
what it prints.
