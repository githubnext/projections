# Azure infrastructure

This extractor turns an Azure Resource Manager (ARM) or Bicep deployment into a
graph of the Azure resources in its scope. Each resource sits inside its
resource group and parent resource, connects to other resources through the
resource IDs in its properties, and carries the change ARM's **what-if**
predicts. Compared across a pull request, it shows what a deployment change
actually does to your system—which resources will be created, modified, or
deleted, and what depends on them.

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

Use this extractor in any repository that deploys Bicep or ARM templates,
alongside the text what-if output your pull requests might already post. While
what-if gives you a flat list of resources and property changes, this graph
shows how they fit together—a virtual network around its subnets, a network
interface inside a subnet behind a network security group, or a private endpoint
pointing at a Key Vault—so you can immediately see the blast radius of a change.

Because it reads ARM's own prediction instead of parsing template source text,
you see what ARM actually evaluated against the live scope. If you use Terraform
or OpenTofu instead, reach for
[`terraform-infrastructure`](terraform-infrastructure.md).

## What it reads

The extractor reads the output of
`az deployment <scope> what-if --no-pretty-print` in one of two ways:

<!-- prettier-ignore -->
| Inputs | What runs | Trust |
|---|---|---|
| `whatIfJsonPath` (and optionally `templateJsonPath`) | Nothing: it reads a what-if result that CI or you saved | None |
| `templateFile` | `az deployment <scope> what-if` for a `.bicep` or `.json` template, then `az bicep build` for a Bicep file's dependencies | `--trust` and an Azure CLI login |

What-if never deploys anything, though it does talk to Azure. It inspects the
live resources in the scope using **your** Azure CLI login (`azPath`, which
defaults to `az`), so that account needs read access along with
`Microsoft.Resources/deployments/whatIf/action`. Run `az login` first and pass
the CLI's configuration variables through `execution.environment` in your
definition (for example, `HOME` and `AZURE_CONFIG_DIR`).

The deployment scope can be `group` (with `resourceGroup` and an optional
`mode`), `sub`, `mg` (with `managementGroupId`), or `tenant`; the last three
also require `location`. You can pass `parameters` as repository-relative
`.json` or `.bicepparam` files or as `name=value` pairs. Keep in mind that
anything written directly in a definition is visible to anyone who can read the
file, so pass secrets through a CI-generated file or Key Vault references
instead. When you use `whatIfJsonPath`, the file is read from each revision
being extracted, meaning every revision you compare needs its own saved result—a
good fit when CI runs what-if with its own identity.

Each extraction represents the scope **after that revision's deployment**,
tagging every resource with what-if's predicted action: `create`, `update`
(ARM's Modify, including `changedProperties`), `deploy` (ARM will redeploy it
but cannot tell whether anything will change), or none. Resources already in the
scope that the template does not mention (ARM's Ignore) are still included with
`managed: false`, since managed resources often point to them. Resources deleted
by a complete-mode deployment are omitted from the graph and listed in
`metadata.destroyed`.

- **Entities** are `resource` and `resource-group` nodes identified by their
  lower-cased resource ID, since ARM IDs are case-insensitive (`data.address`
  preserves ARM's original casing). Each card displays the resource name as its
  label and the resource type without its namespace (`virtualNetworks/subnets`)
  as its kind.
- **Containment** nests each child resource inside its parent (like a subnet
  inside a virtual network), each extension resource inside the resource it
  extends, and each top-level resource inside its resource group.
- **References** turn every resource ID found in a resource's properties into a
  link to that resource—or to its nearest listed ancestor for sub-resources like
  a load balancer's backend pool—labeled with the property path
  (`ipConfigurations.subnet`). If a compiled template is available via
  `templateJsonPath` or the `bicep build` step run for `templateFile`, literal
  `dependsOn` entries also add `dependsOn` to those references.
- **Values** capture `location`, `kind`, `sku`, `zones`, `tags`, and
  `properties`, filtering out bookkeeping fields like `etag` and
  `provisioningState`. Properties whose names indicate secrets (`password`,
  `key`, `connectionString`, …) are replaced with `(sensitive value)`, and
  template expressions ARM cannot evaluate ahead of time appear as
  `(known after deployment)`.

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

When the base revision matches what is already deployed, its what-if predicts no
changes, so the base extraction reflects the current scope and the head
extraction reflects the scope after the pull request. The
[`infrastructure`](../renderers/graph.md) presentation of the graph renderer
labels each change with its planned action using both a badge and text:
**Create** for added resources, **Destroy** for removed ones, and **Update in
place** or **Redeploy** for modified ones. Because ARM never predicts
replacement, you will not see Replace here.

Resource groups and parent resources that only wrap other resources appear as
bounding boxes around them. In **Diff** mode, a changed resource's card lists
the exact settings that changed (such as `properties.hardwareProfile.vmSize`),
showing the old value struck through before the new one—up to three inline,
followed by a count of any remaining changes.

The summary bar tallies resources and resource groups along with their changes,
then summarizes the plan
(`2 to add · 3 to change · 1 to redeploy · 1 to destroy`). Clicking any count
filters the graph to those resources. When viewing a single revision, each
resource shows its pending action next to its type, and the bar counts those
pending actions.

With the **Dependents** control enabled (`dependents` in
`presentation.rendererOptions`, on by default), selecting a resource highlights
everything that references it directly or transitively, and the caption reports
how many resources depend on it.

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

- What-if is a prediction, not a guarantee. Resources ARM cannot predict carry
  `unsupportedReason`, and **Redeploy** means ARM could not determine what will
  change.
- Deletions only show up in complete mode. In incremental mode, removing a
  resource from the template leaves it in the scope, so it appears as modified
  to `managed: false` rather than destroyed.
- Secret redaction only catches properties with secret-like names and parameters
  that ARM omits; other sensitive values inside properties are not detected.
- References to resources outside the deployment scope are not drawn and are
  counted in `metadata.externalReferences`. Similarly, `dependsOn` entries whose
  names are computed at deploy time (such as with `uniqueString`) cannot be
  matched and are counted in `metadata.unmatchedTemplateDependencies`.
- Because subscription IDs are part of resource IDs, deploying the same template
  to another subscription produces different IDs.
- Extractions depend on the live scope at the moment what-if runs, so running
  the same revision later can produce a different result.
- The graph renders at most 500 entities and notifies you when some are omitted.
  For larger scopes, narrow the projection or switch to the table view.

## Related

- [`graph`](../renderers/graph.md) renders this extractor using its
  `infrastructure` presentation.
- [`terraform-infrastructure`](terraform-infrastructure.md) produces the same
  model for Terraform and OpenTofu.
- [The infrastructure model](../../models/infrastructure-model.md) explains the
  shared schema both extractors write and how ARM maps onto it.
- [The default comparator](../comparators/default.md) can order review steps by
  how many resources depend on each change (`order.by: dependents`).

## How it works

See the [package README](../../../packages/extractors/azure-what-if/README.md)
for details on how the what-if output is parsed, how references are derived, and
how values are redacted.

## Build your own

Consider writing a custom extractor when ARM's what-if output does not capture
what you need to review:

- **Another deployment tool**, such as Pulumi, Crossplane, or custom Azure CLI
  scripts (Terraform's `azurerm` provider is already handled by
  [`terraform-infrastructure`](terraform-infrastructure.md)). Emit the same
  [infrastructure model](../../models/infrastructure-model.md) and the
  `infrastructure` presentation will render it automatically.
- **Facts what-if does not include**, like cost estimates, Azure Policy
  evaluation results, resource ownership by team, or role assignments modeled as
  access paths.
- **A different level of detail**, such as Bicep modules and their parameters
  instead of individual resources, or network reachability instead of property
  references.

Before building from scratch, check whether the built-in options are enough.
`scope`, `resourceGroup`, `mode`, and `parameters` let you target the right
deployment, `templateJsonPath` enriches a saved result with template
dependencies, and `whatIfJsonPath` reads CI-generated output without running
anything locally. If you only want a different visual layout, keep this
extractor and write a custom renderer (or toggle **Dependents** off). If you
want to flag risky changes—like deleting a storage account or enabling public
network access—add a comparator file instead.

**In VS Code**, open the Projections view, choose **+ New Projection…**, and
select **Write a custom extractor, renderer or comparator** › **Custom
extractor** (or **Custom extractor and renderer**). After you pick a language,
it scaffolds the definition and a starter extractor (`extract.mjs`,
`extract.py`, or `extract.go`) under `.github/projections/<id>/`, wired up to
the built-in graph renderer. You can also choose **Ask an agent to write it**
and describe what you want the projection to show.

**With the CLI**, scaffold a new extractor while keeping this graph's renderer:

```sh
projections init <id> --language node --renderer infrastructure
```

An extractor is simply a program that prints an extraction. For the
`infrastructure` presentation, emit an `architecture/v0` extraction declaring
the
[`infrastructure/v0` vocabulary](../../reference/schemas/vocabularies-infrastructure.md).
Run `projections show -p <id> --trust` as you iterate—an open projection tab
picks up your uncommitted edits ("Your edits") and flags stale results, while
the Testing view runs your projection's checks. To learn more, walk through
[Write your first extractor](../../guides/first-extractor.md) and see
[Extraction schema](../../guides/schemas.md#extraction-schema) for the output
format.
