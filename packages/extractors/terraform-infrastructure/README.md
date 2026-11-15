---
description: "A Terraform configuration's resources (architecture/v0)"
---

# Terraform infrastructure — `architecture/v0`

The resources a revision's Terraform configuration describes, as a graph: each
resource and data source, the references between them, and module boundaries,
with the action the plan takes to get each resource there (create, update in
place, replace, read or import). It is presented by the `infrastructure`
presentation of the [graph renderer](../../renderers/graph/README.md). The data
model, shared with [`azure-what-if`](../azure-what-if/README.md), is in
[the infrastructure model](../../../docs/models/infrastructure-model.md).

## Inputs

| Input          | Mode                                                                                            | Trust              |
| -------------- | ----------------------------------------------------------------------------------------------- | ------------------ |
| `planJsonPath` | Reads an existing `terraform show -json <plan>` (or `terraform show -json` of a state)          | None: no tool runs |
| `planPath`     | Runs only `terraform show -json <plan>` on a saved binary plan                                  | `--trust`          |
| _(neither)_    | Runs `terraform plan` in `directory` (default the repository root), then `terraform show -json` | `--trust`          |

`terraformPath` names the executable (default `terraform`; OpenTofu's `tofu`
works too). `planArguments` adds arguments to `terraform plan`, for example
`["-var-file=prod.tfvars", "-refresh=false"]`; it may not choose the plan file,
the directory or a destroy plan.

No extractor path runs `init` or `apply`. Planning uses **your** Terraform, your
backend and your provider credentials: `terraform plan` reads state and
refreshes it from the cloud APIs, so grant the variables it needs through
`execution.environment` (for example `AWS_PROFILE`, `ARM_CLIENT_ID`,
`GOOGLE_APPLICATION_CREDENTIALS`, `TF_VAR_…`) and raise `execution.timeoutMs`.
Plans are run with `-lock=false -input=false`. Materialized revisions omit
ignored files, so the working checkout's initialized `.terraform` directory
(providers and modules) is used through `TF_DATA_DIR` unless the definition
grants its own `TF_DATA_DIR`; a module or provider the checkout hasn't installed
fails with Terraform's own error. The binary plan is written to a private
directory that is removed afterwards; plan JSON is never recorded, because it
contains variable values.

## Before and after

One extraction is the infrastructure **after applying that revision's plan**:
the resources in `planned_values` (resources the plan destroys are left out and
listed in `metadata.destroyed`), each with its planned `action`. Comparing two
revisions uses the standard comparator: when the base revision is applied, its
plan changes nothing, so its extraction is the current infrastructure, and the
head's is the infrastructure after the pull request's plan. Created resources
are additions, destroyed ones removals, updates modifications, and a
**replacement keeps the resource's identity**: the same address, modified, with
`action: "replace"`. Moved resources (`moved` blocks) carry `previousIds`, and
so do their relationships (under the former address), so the comparison shows
them, and the references to and from them, as renamed rather than removed and
added.

## What is extracted

- **Entities:** `resource` (managed), `data-source` and `module` (a nested
  module call; the root module is not an entity). IDs are Terraform addresses.
  Labels are the resource name with its `count`/`for_each` key; `data.type` is
  the resource type (`aws_db_instance`).
- **Relationships:** `contains` from a module to its resources and child
  modules; `references` from a resource to each resource its configuration
  refers to, with the referring `attributes`, or `dependsOn: true` for
  `depends_on`. Module outputs and input variables are followed to the resources
  behind them, so a reference to `module.database.endpoint` is a reference to
  `module.database.aws_db_instance.main`. A `depends_on` on a whole module
  depends on every resource in it. References are **derived** from the
  configuration and conservatively connect every `count`/`for_each` instance;
  `metadata.unresolvedReferences` counts the ones that could not be resolved
  (locals are not part of Terraform's JSON).
- **Values:** managed resources carry their planned `values`. Values Terraform
  marks sensitive become `(sensitive value)`, and so does any other string
  containing a value Terraform marked sensitive elsewhere in the document
  (sensitivity is lost when values are copied through some attributes). Values
  unknown until apply become `(known after apply)`. Values Terraform never
  marked as sensitive cannot be detected: declare sensitive variables and
  outputs. Data sources carry no values, because every plan reads them again.

Requires JSON format 1.x. Shared input, path and trust rules for native
ecosystem extractors are in
[the extractors overview](../README.md#ecosystem-extractors).

## Tests

`cargo test -p projections-extractor-terraform-infrastructure` reads real
Terraform 1.14 and OpenTofu 1.12 output of the configurations in
`tests/fixtures/terraform`, and a production-like AWS change whose extractions
are goldens and the graph renderer's Terraform scenario. The native suite plans
those configurations with your Terraform or OpenTofu:

```sh
PROJECTIONS_NATIVE_ECOSYSTEMS=1 PROJECTIONS_TERRAFORM=$(command -v tofu) \
  cargo test -p projections-cli --test native_tools native_terraform
```
