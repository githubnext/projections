# One model for infrastructure

Status: **adopted**. Two built-in extractors write it —
[`terraform-infrastructure`](../../packages/extractors/terraform-infrastructure/README.md)
(Terraform and OpenTofu) and
[`azure-what-if`](../../packages/extractors/azure-what-if/README.md) (Azure
Resource Manager templates and Bicep) — and the `infrastructure` presentation of
the [graph renderer](../../packages/renderers/graph/README.md) presents either.

Pull request tools for infrastructure already exist. Atlantis, Terraform Cloud,
Spacelift and tfcmt post `terraform plan` output as a comment; Azure's what-if
prints a colored list. All of them answer _which resources change, and how_, as
a list of resources and attribute diffs: lines of code, rendered differently.
Projections answers a different question: _what does this change do to the
system?_ Infrastructure is a graph — a network contains subnets, instances sit
in subnets behind security groups, a database is referenced by the secret, the
DNS record, the alarm and the replica that point at it — and the consequential
part of a change is often not the resource that changes but what depends on it.
"This pull request replaces the database, and six resources reference it" is
visible in a graph and nearly invisible in a list.

This document explains the model both extractors share, why its boundaries are
where they are, how Terraform and ARM map onto it, and what does not fit. It was
written by building the two extractors against real tool output (Terraform 1.14
and OpenTofu 1.12 `show -json`, and the ARM what-if REST response the Azure CLI
prints), and changing the model only where one of them could not be expressed
honestly.

## Ground rules

Each extractor reads **the deployment tool's own prediction**, never the
configuration's source text:

- `terraform-infrastructure` reads `terraform show -json` of a saved plan:
  `planned_values` for the resources, `resource_changes` for the actions and the
  `configuration` block for references. Terraform decided which resources exist
  after apply and what happens to each.
- `azure-what-if` reads the what-if result of `az deployment … what-if`: ARM
  evaluated the template against the live deployment scope and decided each
  resource's change type.

Both can read a pre-exported JSON file without trust, or run the user's own tool
(`terraform`/`tofu`, `az`) with `--trust`, the user's credentials and the user's
state. Neither ever applies or deploys anything.

Both are deterministic for one revision and one deployed environment: the same
configuration planned against the same state gives the same extraction. Values
that every plan reads again (Terraform data sources) are left out for that
reason.

## Before and after

A comparison needs two extractions. A plan or a what-if is already a comparison
— of configuration with deployed state — so there are two ways to model it:

1. **Two infrastructure graphs, compared by the standard comparator.** One
   extraction is the infrastructure _after_ a revision's deployment: every
   resource that will exist, each with the action that gets it there. When the
   base revision is deployed, its plan changes nothing and its extraction is the
   infrastructure as it is now; the head's extraction is the infrastructure
   after the pull request.
2. **One extraction carrying both sides**, with action attributes and a custom
   comparator to turn them into steps.

We chose the first. It keeps the one-revision view complete — a single
extraction is a useful map of the infrastructure a branch describes, with its
pending actions — and it needs no infrastructure-specific comparator: the
default comparator matches resources by address or resource ID and orders the
steps, and every renderer (graph, table, text) agrees on what changed. It also
composes: comparing two pushes of the same pull request shows what the second
push changed about the plan.

| Planned change  | Base extraction            | Head extraction                                              | Comparison   |
| --------------- | -------------------------- | ------------------------------------------------------------ | ------------ |
| Create          | absent                     | present, `action: "create"`                                  | added        |
| Update in place | present                    | present, `action: "update"`, new values                      | modified     |
| **Replace**     | present                    | present, **same ID**, `action: "replace"`                    | **modified** |
| Destroy         | present                    | absent (listed in `metadata.destroyed`)                      | removed      |
| Move / rename   | present at the old address | present, `previousIds: [old address]`; its relationships too | renamed      |
| No change       | present                    | present, identical                                           | unchanged    |

Replacement deserves its own decision. Terraform destroys one object and creates
another, so it could be a removal and an addition. But the _resource_ — the
address other resources reference, the thing in the configuration — is the same
before and after; only the object behind it changes. Modelling it as a removal
and an addition would also remove and re-add every relationship to it, and a
graph would show the database's dependents losing and regaining their arrows,
which is exactly backwards: the point is that they keep depending on it through
the replacement. So a replacement is an identity-preserving **modification**
with `action: "replace"`, and the renderer says _Replace_, never _Modified_.

## Vocabulary

Everything below is ordinary `architecture/v0` ([contracts](../contracts.md)):
entity kinds, relationship kinds and `data` fields. Fields an ecosystem has no
use for are absent. Extractions declare the vocabulary,
`"vocabularies": ["infrastructure/v0"]`, and the engine checks the fields
renderers rely on
([`vocabularies/infrastructure`](../reference/schemas/vocabularies-infrastructure.md)
lists them); the others are documented here and stay open.

### Entities

<!-- prettier-ignore -->
| Kind | What it is | Label |
| --- | --- | --- |
| `resource` | A managed infrastructure object: an instance, a network, a database | Its name, with a `count`/`for_each` key (`api[0]`, `private["us-east-1a"]`) |
| `data-source` | Something the configuration reads but doesn't manage (Terraform `data` blocks) | Its name |
| `module` | A reusable configuration boundary (a Terraform module call) | The module name |
| `resource-group` | A deployment scope that contains resources (an Azure resource group) | The group name |

`provider` is deliberately **not** an entity: in both ecosystems a provider is
how a resource is managed, not something in the system, so it is the `provider`
field. A resource's _type_ is not part of its kind either: kinds are a small,
shared vocabulary that renderers can rely on, and types (`aws_db_instance`,
`Microsoft.Network/virtualNetworks/subnets`) are an open set. The renderer draws
the type as the card's kind line instead.

<!-- prettier-ignore -->
| Field | Meaning |
| --- | --- |
| `type` | The ecosystem's resource type |
| `provider` | Terraform's provider source address, or ARM's resource provider namespace |
| `address` | Terraform's resource address, or the ARM resource ID as ARM wrote it |
| `module` | The containing module's address (Terraform) |
| `action` | The planned action, below; absent when nothing happens |
| `replaceOrder` | `destroy-before-create` or `create-before-destroy` |
| `replaceReason` | Why the provider must replace (`replace_because_cannot_update`, `replace_by_request`, `replace_because_tainted`, …) |
| `replacePaths` | The attributes that force replacement |
| `changedProperties` | Property paths ARM reports as changing |
| `importing` | Terraform will import an existing object |
| `managed` | `false` for an object in the scope that the template doesn't manage (ARM's Ignore) |
| `unsupportedReason` | Why ARM couldn't predict this resource's change |
| `values` | The resource's planned configuration, with sensitive values replaced (below) |

### Actions

<!-- prettier-ignore -->
| `action` | Meaning | Terraform | ARM what-if |
| --- | --- | --- | --- |
| `create` | The object will be created | `["create"]` | `Create` |
| `update` | Changed in place; the object survives | `["update"]` | `Modify` |
| `replace` | Destroyed and created again under the same address | `["delete","create"]`, `["create","delete"]` | — (ARM never predicts replacement) |
| `delete` | The object will be destroyed; the resource is absent from the extraction | `["delete"]` | `Delete` (complete mode) |
| `read` | A data source read only during apply | `["read"]` | — |
| `import` | An existing object enters management unchanged | `["no-op"]` while importing | — |
| `forget` | Leaves management without being destroyed | `["forget"]` | — |
| `deploy` | Will be redeployed; ARM can't tell whether properties change | — | `Deploy` |
| *(absent)* | Nothing happens | `["no-op"]` | `NoChange`, `Ignore`, `Unsupported` |

### Relationships

<!-- prettier-ignore -->
| Kind | From → to | Meaning |
| --- | --- | --- |
| `contains` | module or resource group → resource or module; parent resource → child resource | Structural containment. Containment-only modules and resource groups become boundaries in the graph |
| `references` | resource → resource | The source's configuration refers to the target: it depends on it, and is affected when it is replaced or destroyed |

`references` carry `attributes` (the referring attributes or property paths) and
`dependsOn: true` for an explicit `depends_on`/`dependsOn`. They are `derived`:
the tool did not report them as a graph; the extractor derived them from
configuration expressions or resource IDs by the ecosystem's own rules.
_Dependents_ of a resource are everything with a path of `references` to it; the
renderer's dependents control highlights them.

## Sensitive and unknown values

Infrastructure configuration contains passwords, keys and connection strings,
and a pull request is the last place they should appear.

- **Terraform** marks sensitive values itself (`sensitive_values`,
  `after_sensitive`). They become `(sensitive value)`. Sensitivity is lost when
  a value is copied through some attributes — real OpenTofu output copies a
  sensitive password through `terraform_data.output` unmarked — so any other
  string containing a value Terraform marked sensitive anywhere in the document
  is replaced too, as are values of sensitive variables. Values unknown until
  apply become `(known after apply)`.
- **ARM** never returns `secureString` parameters or secrets in resource
  payloads, but has no markers for anything else. Values of properties whose
  names say they hold secrets (`password`, `secret`, `key`, `token`,
  `connectionString`, `sas`, `credential`) are replaced, except identifiers that
  only name one (`keyVaultId`, `keyName`, …). Template expressions ARM can't
  evaluate before deployment (`[reference(…)]`) become
  `(known after deployment)`.

Neither extractor can detect a secret its tool never identified. The raw tool
output is never recorded, because it contains variable values.

## How each ecosystem maps

<!-- prettier-ignore -->
| | Terraform | ARM / Bicep |
| --- | --- | --- |
| **Identity** | Resource address (`module.database.aws_db_instance.main`) | Resource ID, case-insensitive (lower-cased) |
| **Instances** | `count`/`for_each` keys in the address | One resource per ID; copy loops produce distinct names |
| **Boundaries** | Module calls, nested | Resource groups; parent resources (a virtual network around its subnets) |
| **References** | Configuration expressions, followed through module outputs and input variables; `depends_on` | Resource IDs inside resource payloads; parent/child IDs; `dependsOn` from the compiled template |
| **Replacement** | Planned explicitly, with the forcing attributes | Not predicted: ARM updates in place or fails |
| **Unmanaged objects** | Not visible (outside state) | Visible as `Ignore` in incremental mode (`managed: false`) |
| **Deletion** | Planned when removed from configuration | Only in complete mode; incremental deployments leave objects |

### Terraform

Terraform maps directly, because a plan is already a graph's worth of
information spread over three sections. `planned_values` is the set of resources
after apply; `resource_changes` gives each its action, replacement reason and
forcing paths and, for moved resources, `previous_address`; the `configuration`
gives the expressions each attribute was written with and the references
Terraform found in them. References are written relative to their module and
often go through a module's interface, so the extractor follows
`module.database.endpoint` into the database module's `endpoint` output and on
to `aws_db_instance.main`, and `var.subnet_ids` inside a module back to the
calling module's argument. A module whose resources are referenced this way
stays a pure boundary, and the arrow goes where the dependency really is.

Count and `for_each` instances are identified by their keys, but the
configuration describes the resource block, not each instance. A reference to
`aws_subnet.private` connects every instance; a reference through `count.index`
connects every pairing. This is the conservative choice: it can show a
dependency that doesn't exist, never hide one that does.

Data sources are part of the graph, because resources depend on them, but carry
no values: every plan reads them again, and a newer AMI ID or a rotated
certificate would otherwise make every comparison report a change.

### ARM and Bicep

ARM's what-if is a list, not a graph, but ARM resource IDs are hierarchical
paths, and resource payloads refer to other resources by ID
(`properties.ipConfigurations[].properties.subnet.id`). So the graph is derived
from IDs:

- A child resource's ID extends its parent's
  (`…/virtualNetworks/vnet-shop/subnets/app`); the parent `contains` it. A
  top-level resource is contained by its resource group. Extension resources
  (`…/virtualMachines/vm/providers/Microsoft.Insights/diagnosticSettings/x`) are
  contained by the resource they extend.
- Any string in a payload that is a resource ID is a reference. When the exact
  ID is not an entity — `…/loadBalancers/lb/backendAddressPools/pool` is a
  sub-resource what-if doesn't list separately — the reference goes to its
  nearest listed ancestor, the load balancer. References to a resource's own
  sub-resources and to its ancestors are containment, not references. References
  to resources outside the deployment are counted in
  `metadata.externalReferences`, not invented as entities.
- Bicep and ARM `dependsOn` can be read from the compiled template
  (`bicep build`); declared dependencies whose resources have literal names are
  matched to what-if resources and add `dependsOn: true`.

ARM has no replacement and no read; it does have _Deploy_, a resource ARM will
send again without being able to say whether anything changes (typically because
a property depends on a runtime value), and _Ignore_, an existing object the
template does not mention. Ignore resources are included with `managed: false`,
because they are part of the scope's infrastructure and frequently what managed
resources reference.

## What doesn't fit

- **Attribute-level diffs.** Both tools report which attributes change and how.
  Projections keeps the planned values (redacted) and, for ARM, the changed
  property paths, so an inspector can show them; it does not try to be a better
  plan diff. That is the existing tools' job, and the line between a system view
  and a configuration view.
- **Execution order.** Terraform's apply walks the dependency graph and
  replacements may happen create-before-destroy. A comparison's step order
  exists for comprehension, not execution (see
  [the domain model](domain-model.md#relationship-to-infrastructure-planning)),
  so `replaceOrder` is recorded but the steps are the comparator's.
- **Locals and provider configuration.** Terraform's JSON plan omits locals, so
  references through a `local` are unresolved and counted in
  `metadata.unresolvedReferences`; provider configurations (regions, aliases)
  are not entities.
- **Cross-scope and cross-state references.** A resource referring to
  infrastructure in another Terraform state or another subscription points
  outside the extraction. Terraform shows the reading data source; ARM counts
  the reference as external.
- **Outputs.** Module and deployment outputs are interfaces, not infrastructure;
  they are followed for references but not drawn.
