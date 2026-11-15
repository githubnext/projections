# Azure infrastructure

The Azure resources an Azure Resource Manager (ARM) or Bicep deployment leaves
in its scope, as a graph: each resource, contained by its resource group and
parent resource, joined by the resource IDs its properties refer to, with the
change ARM's **what-if** predicts for it. Compared across a pull request, it
answers "what does this deployment change do to the system: which resources are
created, modified or deleted, and what depends on them?"

<!-- generated: facts -->

- ID: `azure-what-if`
- Extraction schema:
  [`architecture/v0`](../../reference/schemas/architecture.md)
- Drawn by default with: [`infrastructure`](../renderers/graph.md)
- Needs `--trust`: When it runs ecosystem tools or repository code
  (`when-executing-tools`)
- Suggested when the repository has: `*.bicep`, `**/*.bicep`

<!-- end generated: facts -->

## When to use it

Use it in a repository that deploys Bicep or ARM templates, beside the what-if
output your pull requests may already get. What-if prints a list of resources
and property changes; this shows how they fit together (a virtual network around
its subnets, a network interface in a subnet behind a network security group, a
private endpoint pointing at a Key Vault), so a change's reach is visible.

It reads ARM's own prediction, never the template's source text, so what it
shows is what ARM evaluated against the live scope. For Terraform and OpenTofu
use [`terraform-infrastructure`](terraform-infrastructure.md).

## What it reads

The result of `az deployment <scope> what-if --no-pretty-print`, in one of two
ways:

<!-- prettier-ignore -->
| Inputs | What runs | Trust |
|---|---|---|
| `whatIfJsonPath` (and optionally `templateJsonPath`) | Nothing: it reads a what-if result that CI or you saved | None |
| `templateFile` | `az deployment <scope> what-if` for a `.bicep` or `.json` template, then `az bicep build` for a Bicep file's dependencies | `--trust` and an Azure CLI login |

What-if never deploys, but it does call Azure: it reads the live resources in
the scope with **your** Azure CLI login (`azPath`, default `az`), which needs
read access and `Microsoft.Resources/deployments/whatIf/action` there. Run
`az login` first and grant the CLI's configuration through the definition's
`execution.environment` (for example `HOME` and `AZURE_CONFIG_DIR`). The scope
is `group` (with `resourceGroup` and optionally `mode`), `sub`, `mg` (with
`managementGroupId`) or `tenant`; the last three need `location`. `parameters`
are repository-relative `.json` or `.bicepparam` files or `name=value` pairs; a
pair in a definition is visible to anyone who can read it, so supply secure
parameters through a file CI writes or Key Vault references. A `whatIfJsonPath`
file is read from the revision being extracted, so each revision you compare
needs its own; CI can run what-if with its own identity and save the result.

One extraction is the scope **after that revision's deployment**, each resource
with what-if's change: `create`, `update` (ARM's Modify, with the
`changedProperties`), `deploy` (ARM will redeploy it but can't tell whether
anything changes), or none. Objects in the scope the template doesn't mention
(ARM's Ignore) are included with `managed: false`, because managed resources
often refer to them. Resources a complete-mode deployment deletes are left out
and listed in `metadata.destroyed`.

- **Entities**: `resource` and `resource-group`, identified by their resource
  ID, lower-cased because ARM IDs are case-insensitive (`data.address` keeps
  ARM's spelling). A card's label is the resource name, and its kind line the
  resource type without its namespace (`virtualNetworks/subnets`).
- **Containment**: a child resource is contained by its parent (a subnet by its
  virtual network), an extension resource by the resource it extends, and a
  top-level resource by its resource group.
- **References**: every resource ID in a resource's properties is a reference to
  that resource (or to its nearest listed ancestor, for a sub-resource such as a
  load balancer's backend pool), with the property path
  (`ipConfigurations.subnet`). With a compiled template (`templateJsonPath`, or
  the `bicep build` that `templateFile` runs), `dependsOn` entries whose names
  are literal add `dependsOn` to their reference.
- **Values**: `location`, `kind`, `sku`, `zones`, `tags` and `properties`,
  without bookkeeping such as `etag` and `provisioningState`. Properties whose
  names say they hold a secret (`password`, `key`, `connectionString`, …) become
  `(sensitive value)`, and template expressions ARM can't evaluate before
  deploying become `(known after deployment)`.

## Options

<!-- generated: inputs -->

| Input               | Meaning                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| `azPath`            | Azure CLI executable; default `az`.                                                              |
| `location`          | Deployment location (scopes sub, mg and tenant).                                                 |
| `managementGroupId` | Management group (scope mg).                                                                     |
| `mode`              | Incremental (default) or Complete (scope group).                                                 |
| `parameters`        | Parameter files (repository-relative) or name=value pairs.                                       |
| `resourceGroup`     | Resource group (scope group).                                                                    |
| `scope`             | Deployment scope for templateFile: group (default), sub, mg or tenant.                           |
| `subscription`      | Subscription name or ID; default the CLI's current subscription.                                 |
| `templateFile`      | Bicep or ARM template to run what-if for (requires --trust and an Azure CLI login).              |
| `templateJsonPath`  | Optional compiled ARM template (`bicep build` output) whose dependsOn adds dependencies.         |
| `whatIfJsonPath`    | Pre-exported `az deployment … what-if --no-pretty-print` result; read without running Azure CLI. |

<!-- end generated: inputs -->

## What a comparison shows

When the base revision is deployed, its what-if changes nothing, so its
extraction is the scope as it is now and the head's is the scope after the pull
request. The [`infrastructure`](../renderers/graph.md) presentation of the graph
renderer words each change as its planned action, as a badge and a word:
**Create** for an added resource, **Destroy** for a removed one, and **Update in
place** or **Redeploy** for a modified one. ARM never predicts replacement, so
nothing reads Replace.

Resource groups and parent resources that only contain others are boundaries
around them. In **Diff** mode a changed resource's card lists its attribute
changes down to the setting that changed (`properties.hardwareProfile.vmSize`),
old value struck through before the new one (three, then a count of the rest).

The summary bar counts resources and resource groups, each with its changes,
then states the plan (`2 to add · 3 to change · 1 to redeploy · 1 to destroy`),
each filtering to its resources. A single revision shows each resource's pending
action after its type and counts those actions in the bar.

With the **Dependents** control (`dependents` in `presentation.rendererOptions`,
on by default), selecting a resource brings forward everything with a path of
references to it, and the caption says how many resources depend on it.

## Start from this definition

<!-- generated: definition -->

```json
{
  "extractor": "azure-what-if",
  "id": "azure-what-if",
  "inputs": {
    "whatIfJsonPath": ".projections/inputs/what-if.json"
  },
  "renderer": "infrastructure",
  "title": "Azure infrastructure"
}
```

<!-- end generated: definition -->

## Limitations

- What-if predicts; it doesn't promise. A resource ARM can't predict carries
  `unsupportedReason`, and **Redeploy** means ARM couldn't tell.
- Deletions appear only in complete mode. In incremental mode a resource removed
  from the template stays in the scope, so it reads as modified to
  `managed: false` rather than destroyed.
- It can redact only secrets whose property names say so, and parameters ARM
  never returns; other secrets in property values aren't detected.
- References to resources outside the deployment's scope aren't drawn;
  `metadata.externalReferences` counts them. `dependsOn` entries whose names are
  built at deploy time (`uniqueString`) can't be matched, and
  `metadata.unmatchedTemplateDependencies` counts them.
- Subscription IDs are part of resource IDs, so the same template in another
  subscription has different IDs.
- Results depend on the live scope at what-if time, so running the same revision
  later can give another extraction.
- The graph draws at most 500 entities and says when it leaves some out; for a
  larger scope, use a narrower projection or the table view.

## Related

- [`graph`](../renderers/graph.md), whose `infrastructure` presentation draws
  it.
- [`terraform-infrastructure`](terraform-infrastructure.md), the same model for
  Terraform and OpenTofu.
- [The infrastructure model](../../models/infrastructure-model.md), which both
  write, and how ARM maps onto it.
- [The default comparator](../comparators/default.md), which can order steps by
  how many resources depend on each (`order.by: dependents`).

## How it works

The [package README](../../../packages/extractors/azure-what-if/README.md)
covers how the what-if result is read, references derived and values redacted.

## Build your own

Write your own extractor when the what-if result isn't what you want to review:

- **Another deployment tool**: Pulumi, Crossplane, or scripts that call the
  Azure CLI (Terraform's `azurerm` provider is already covered by
  [`terraform-infrastructure`](terraform-infrastructure.md)). Write the same
  [infrastructure model](../../models/infrastructure-model.md) and the
  `infrastructure` presentation draws it as it draws this one.
- **Facts what-if doesn't have**: cost estimates, Azure Policy results, the team
  that owns each resource, or role assignments as access paths.
- **Another grain**: Bicep modules and their parameters rather than resources,
  or network reachability rather than references.

Try the lighter options first: `scope`, `resourceGroup`, `mode` and `parameters`
pick the deployment, `templateJsonPath` adds template dependencies to a saved
result, and `whatIfJsonPath` reads a result CI already made without running
anything. To draw the same graph differently, keep this extractor and write a
renderer, or turn off **Dependents**; to say which changes are risky (a deleted
storage account, a public network access setting turned on), add a comparator
file.

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
