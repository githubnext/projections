---
description: The Azure resources a deployment leaves (architecture/v0)
---

# Azure what-if — `architecture/v0`

The Azure resources an ARM or Bicep deployment leaves in its scope, as a graph:
each resource, contained by its resource group and parent resource (a virtual
network around its subnets), joined by the resource IDs its properties refer to,
with the change Azure Resource Manager's **what-if** predicts for it. It is
presented by the `infrastructure` presentation of the
[graph renderer](../../renderers/graph/README.md). The data model, shared with
[`terraform-infrastructure`](../terraform-infrastructure/README.md), is in
[the infrastructure model](../../../docs/models/infrastructure-model.md).

## Inputs

<!-- prettier-ignore -->
| Input | Mode | Trust |
| --- | --- | --- |
| `whatIfJsonPath` | Reads an existing `az deployment group\|sub\|mg\|tenant what-if --no-pretty-print` result (or the REST response) | None: no tool runs |
| `templateJsonPath` | Optional, with `whatIfJsonPath`: a compiled template (`bicep build` output, or an ARM template) whose `dependsOn` adds dependencies | None |
| `templateFile` | Runs `az deployment <scope> what-if` for a `.bicep` or `.json` template, then `az bicep build --stdout` for a Bicep file's dependencies | `--trust` and an Azure CLI login |

Native mode options: `scope` (`group`, the default, `sub`, `mg` or `tenant`),
`resourceGroup` (required for `group`), `subscription`, `managementGroupId`
(required for `mg`), `location` (required for `sub`, `mg` and `tenant`), `mode`
(`Incremental` or `Complete`, for `group`), `parameters` (repository-relative
`.json`/`.bicepparam` files or `name=value` pairs) and `azPath` (default `az`).
What-if is always requested with `--result-format FullResourcePayloads`.

### Trust and authentication

What-if never deploys, but it does call Azure: it reads the live resources in
the scope with **your** Azure CLI login and permissions (at least read access
and `Microsoft.Resources/deployments/whatIf/action` on the scope). Run
`az login` (or use a service principal or workload identity) first, and grant
the CLI's configuration through `execution.environment`, for example
`["HOME", "AZURE_CONFIG_DIR"]`, plus `AZURE_CORE_*`/proxy variables if you use
them. Secure parameters must be supplied without committing them: a `name=value`
pair in a definition is visible to everyone who can read it, so prefer a
parameter file the CI job writes, or Key Vault references. Raise
`execution.timeoutMs` for large scopes. Pre-exported mode needs none of this: CI
can run what-if with its own identity and save the result.

## Before and after

As for Terraform, one extraction is the infrastructure **after** that revision's
deployment, with each resource's predicted change:

| What-if `changeType` | Extraction                                                              |
| -------------------- | ----------------------------------------------------------------------- |
| `Create`             | present, `action: "create"`                                             |
| `Modify`             | present, `action: "update"`, `changedProperties` from the what-if delta |
| `Deploy`             | present, `action: "deploy"` (ARM can't tell whether properties change)  |
| `NoChange`           | present, no action                                                      |
| `Ignore`             | present, `managed: false`: in the scope but not in the template         |
| `Unsupported`        | present, `unsupportedReason`                                            |
| `Delete`             | absent, listed in `metadata.destroyed` (complete mode only)             |

When the base revision is deployed, its what-if changes nothing and its
extraction is the scope as it is now; the head's is the scope after the pull
request. ARM never predicts replacement.

## What is extracted

- **Entities:** `resource` for each resource and `resource-group` for each
  resource group (created by the deployment, or containing its resources). IDs
  are resource IDs, lower-cased because ARM IDs are case-insensitive;
  `data.address` keeps ARM's spelling. Labels are resource names; `data.type` is
  the full resource type (`Microsoft.Network/virtualNetworks/subnets`) and
  `data.provider` its namespace.
- **Containment:** a child resource (its ID extends another's) is contained by
  its nearest listed ancestor, an extension resource by the resource it extends,
  and a top-level resource by its resource group.
- **References:** every string in a resource's payload that is a resource ID
  (`properties.ipConfigurations[].properties.subnet.id`) references the listed
  resource it names, or that resource's nearest listed ancestor when it names a
  sub-resource (a load balancer's backend pool). `attributes` are the property
  paths, without `properties` and the trailing `id` (`ipConfigurations.subnet`).
  Read-only properties ARM fills in on the _referenced_ resource, pointing back
  at what uses it (a subnet's `ipConfigurations`, a network security group's
  `subnets`, a disk's `managedBy`), are dropped: they restate a reference in the
  wrong direction. References outside the deployment are counted in
  `metadata.externalReferences`.
- **Template dependencies:** with a compiled template, each `dependsOn` whose
  resource and dependency have names Bicep emits literally (string literals,
  `format`, `concat`, `parameters` with literal defaults, `variables` and
  `resourceId`) adds `dependsOn: true` to the reference; dependencies on a
  parent are containment. `metadata.unmatchedTemplateDependencies` counts the
  rest (names built from runtime values such as `uniqueString`).
- **Values:** `location`, `kind`, `sku`, `zones`, `tags` and `properties`,
  without bookkeeping (`etag`, `provisioningState`, `resourceGuid`) or
  back-references. ARM never returns `secureString` parameters, and marks
  nothing else sensitive, so values of properties whose names say they hold
  secrets (`password`, `secret`, `key`, `token`, `connectionString`, `sas`,
  `credential`) become `(sensitive value)`, except names of identifiers
  (`keyVaultId`, `keyName`, …). Unevaluated template expressions become
  `(known after deployment)`. Other secrets cannot be detected.

Subscription IDs are part of resource IDs, and so of entity IDs.

## Tests

`cargo test -p projections-extractor-azure-what-if` needs no network and no
Azure CLI. `tests/fixtures/{base,head}` hold a Bicep template, its Bicep 0.48
`bicep build` output and the what-if result for each revision; the head adds a
private-endpoints subnet with its network security group and a Key Vault private
endpoint, resizes a VM and disables the vault's public access. Their extractions
are goldens and the graph renderer's Azure scenario. Native mode is tested by
recording the `az` argv it runs.
