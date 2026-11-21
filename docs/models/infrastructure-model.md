# One model for infrastructure

Status: **adopted**. Two built-in extractors produce this model —
[`terraform-infrastructure`](../../packages/extractors/terraform-infrastructure/README.md)
for Terraform and OpenTofu, and
[`azure-what-if`](../../packages/extractors/azure-what-if/README.md) for Azure
Resource Manager templates and Bicep. The `infrastructure` presentation of the
[graph renderer](../../packages/renderers/graph/README.md) renders either one.

Plenty of pull request tools already handle infrastructure diffs. Atlantis,
Terraform Cloud, Spacelift, and tfcmt post `terraform plan` output as a comment,
and Azure's what-if prints a colored list. They all answer _which resources
change, and how_ as a flat list of resource and attribute diffs — essentially
lines of code in a nicer wrapper.

Projections asks a different question: _what does this change do to the system?_
Infrastructure is a graph. A network contains subnets, instances sit in those
subnets behind security groups, and a database is referenced by its secret, DNS
record, alarm, and replica. Often the most important part of a change isn't the
resource being edited, but everything that depends on it. "This pull request
replaces the database, and six resources reference it" jumps out immediately in
a graph and is easy to miss in a flat list.

This document walks through the shared model, why its boundaries sit where they
do, how Terraform and ARM map onto it, and what stays out of scope. We shaped
the model by building both extractors against real tool output — Terraform 1.14
and OpenTofu 1.12 `show -json`, plus the ARM what-if REST response from the
Azure CLI — and only adjusted the model where one ecosystem couldn't be
represented honestly.

## Ground rules

Both extractors read **the deployment tool's own prediction**, never raw
configuration source text:

- `terraform-infrastructure` reads `terraform show -json` from a saved plan:
  `planned_values` for the resulting resources, `resource_changes` for the
  planned actions, and the `configuration` block for references. Terraform
  itself decides what exists after apply and what happens to each resource.
- `azure-what-if` reads the output of `az deployment … what-if`, where ARM has
  already evaluated the template against the live deployment scope and
  determined each resource's change type.

You can feed either extractor a pre-exported JSON file without trust, or let it
run your local tool (`terraform`/`tofu`, `az`) under `--trust` using your own
credentials and state. Neither extractor ever applies or deploys anything.

Both are deterministic for a given revision and deployed environment: planning
the same configuration against the same state yields the same extraction. We
intentionally omit values that every plan re-reads (like Terraform data source
attributes) so they don't create false diffs.

## Before and after

Every comparison takes two extractions. Since a plan or what-if is already a
comparison between configuration and deployed state, there are two ways to model
it:

1. **Two infrastructure graphs compared by the standard comparator.** Each
   extraction represents the infrastructure _after_ a revision is deployed, with
   each resource carrying the action that gets it there. When the base revision
   is already deployed, its plan is a no-op and its extraction reflects current
   live state; the head extraction reflects the state after the pull request.
2. **One extraction carrying both sides**, with action attributes and a custom
   comparator to turn them into steps.

We picked the first approach. A single extraction stays useful on its own as a
complete map of a branch's infrastructure and pending actions, and we don't need
an infrastructure-specific comparator. The default comparator matches resources
by address or resource ID and orders the steps, so graph, table, and text
renderers all agree on what changed. It also composes naturally: comparing two
pushes of the same pull request shows what the second push changed in the plan.

| Planned change  | Base extraction            | Head extraction                                              | Comparison   |
| --------------- | -------------------------- | ------------------------------------------------------------ | ------------ |
| Create          | absent                     | present, `action: "create"`                                  | added        |
| Update in place | present                    | present, `action: "update"`, new values                      | modified     |
| **Replace**     | present                    | present, **same ID**, `action: "replace"`                    | **modified** |
| Destroy         | present                    | absent (listed in `metadata.destroyed`)                      | removed      |
| Move / rename   | present at the old address | present, `previousIds: [old address]`; its relationships too | renamed      |
| No change       | present                    | present, identical                                           | unchanged    |

Replacement is a special case worth calling out. Under the hood, Terraform
destroys one object and creates another, so you could model it as a removal plus
an addition. Doing that, however, would tear down and recreate every
relationship pointing to the resource, making the graph look like the database's
dependents lost and regained their arrows. That's backwards — the whole point is
that those dependents keep relying on that address across the replacement. So a
replacement is modeled as an identity-preserving **modification** with
`action: "replace"`, and the renderer labels it _Replace_ rather than
_Modified_.

## Vocabulary

Everything here is standard `architecture/v0` ([contracts](../contracts.md)) —
entity kinds, relationship kinds, and `data` fields. Fields that don't apply to
an ecosystem are simply omitted. Extractions declare
`"vocabularies": ["infrastructure/v0"]`, and the engine validates the fields
renderers depend on (listed in
[`vocabularies/infrastructure`](../reference/schemas/vocabularies-infrastructure.md));
all other fields are documented here and left open.

### Entities

<!-- prettier-ignore -->
| Kind | What it is | Label |
| --- | --- | --- |
| `resource` | A managed infrastructure object: an instance, a network, a database | Its name, with a `count`/`for_each` key (`api[0]`, `private["us-east-1a"]`) |
| `data-source` | Something the configuration reads but doesn't manage (Terraform `data` blocks) | Its name |
| `module` | A reusable configuration boundary (a Terraform module call) | The module name |
| `resource-group` | A deployment scope that contains resources (an Azure resource group) | The group name |

Notice that `provider` is deliberately **not** an entity. In both ecosystems a
provider is how a resource is managed rather than a thing in the system, so it
lives in the `provider` field instead. Similarly, a resource's _type_ isn't its
entity kind: kinds form a small, shared vocabulary that renderers can count on,
while resource types (`aws_db_instance`,
`Microsoft.Network/virtualNetworks/subnets`) are an open set that the renderer
displays on the card's kind line.

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

Each `references` edge carries `attributes` (the referring attributes or
property paths) and sets `dependsOn: true` when an explicit
`depends_on`/`dependsOn` exists. These edges are marked `derived` because the
underlying tool didn't emit a graph; the extractor inferred them from
configuration expressions or resource IDs using each ecosystem's rules. Any
resource with a path of `references` leading to a target is one of its
_dependents_, which the renderer's dependents control can highlight.

## Sensitive and unknown values

Infrastructure configs are full of passwords, keys, and connection strings that
must never leak into a pull request.

- **Terraform** flags sensitive values itself (`sensitive_values`,
  `after_sensitive`), and the extractor replaces them with `(sensitive value)`.
  Because sensitivity can get stripped when a value is copied through certain
  attributes — real OpenTofu output copies a sensitive password through
  `terraform_data.output` unmarked — any other string containing a value marked
  sensitive anywhere in the document is redacted too, along with sensitive
  variable values. Values that won't exist until apply become
  `(known after apply)`.
- **ARM** never returns `secureString` parameters or secrets in resource
  payloads, though it doesn't mark other sensitive fields. The extractor redacts
  properties whose names indicate secrets (`password`, `secret`, `key`, `token`,
  `connectionString`, `sas`, `credential`), while sparing identifiers that
  merely name a secret resource (`keyVaultId`, `keyName`, …). Template
  expressions that ARM can't evaluate ahead of deployment (`[reference(…)]`)
  become `(known after deployment)`.

Neither extractor can catch a secret that its tool never flagged. We also never
store the raw tool output, since it contains variable values.

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

Terraform maps cleanly because a saved plan already contains a full graph split
across three sections. `planned_values` lists the resources after apply;
`resource_changes` supplies each action, replacement reason, forcing paths, and
`previous_address` for moved resources; and `configuration` holds the attribute
expressions along with the references Terraform found in them.

Because references are written relative to their module and often pass through a
module's interface, the extractor traces them across boundaries. It follows
`module.database.endpoint` into the database module's `endpoint` output and on
to `aws_db_instance.main`, and traces `var.subnet_ids` inside a module back to
the caller's argument. That keeps modules as clean visual boundaries while
drawing arrows directly between the resources that actually depend on each
other.

Instances created with `count` or `for_each` carry their keys in their IDs, but
Terraform's `configuration` block describes the resource block as a whole rather
than individual instances. A reference to `aws_subnet.private` therefore links
every instance, and a reference using `count.index` links every pairing. That's
a deliberate conservative choice: it may draw an extra edge, but it won't hide a
real dependency.

Data sources stay in the graph so dependents still connect to them, but their
values are omitted. Otherwise a refreshed AMI ID or rotated certificate would
make every comparison look modified.

### ARM and Bicep

ARM's what-if output is a flat list, not a graph, so the extractor builds the
graph from ARM's hierarchical resource IDs and the IDs embedded inside resource
payloads (such as `properties.ipConfigurations[].properties.subnet.id`):

- **Containment.** A child resource whose ID extends its parent's
  (`…/virtualNetworks/vnet-shop/subnets/app`) gets a `contains` edge from the
  parent. Top-level resources are contained by their resource group, and
  extension resources
  (`…/virtualMachines/vm/providers/Microsoft.Insights/diagnosticSettings/x`) are
  contained by the resource they extend.
- **References.** Any resource ID string inside a payload becomes a reference.
  If the ID points to a sub-resource that what-if doesn't list separately (like
  `…/loadBalancers/lb/backendAddressPools/pool`), the edge targets its nearest
  listed ancestor (the load balancer). Pointers to a resource's own
  sub-resources or ancestors are treated as containment rather than references.
  References to resources outside the deployment are tallied in
  `metadata.externalReferences` instead of inventing fake entities.
- **Explicit dependencies.** When a compiled template is available (via
  `bicep build`), declared `dependsOn` entries with literal names are matched to
  what-if resources and marked with `dependsOn: true`.

ARM has no replacement or read actions, but it does have _Deploy_ (a resource
ARM will redeploy without knowing if properties changed, usually due to a
runtime value) and _Ignore_ (an existing resource the template doesn't mention).
Ignored resources are still included with `managed: false`, since they live in
the deployment scope and managed resources frequently reference them.

## What doesn't fit

- **Attribute-level diffs.** Both Terraform and ARM already report which
  attributes change. Projections retains redacted planned values and ARM's
  changed property paths so an inspector can display them, without trying to
  replace existing plan-diff tools. That's the boundary between a system view
  and a configuration view.
- **Execution order.** Terraform's apply walks the dependency graph and may
  perform create-before-destroy replacements. A comparison's step order is meant
  for human comprehension, not execution (see
  [the domain model](domain-model.md#relationship-to-infrastructure-planning)),
  so we record `replaceOrder` but let the comparator choose the step order.
- **Locals and provider configuration.** Terraform's JSON plan omits locals, so
  references passing through a `local` can't be resolved and are counted in
  `metadata.unresolvedReferences`. Provider configurations (regions, aliases)
  aren't modeled as entities.
- **Cross-scope and cross-state references.** References into another Terraform
  state or Azure subscription point outside the extraction. Terraform surfaces
  the reading data source, while ARM counts the reference as external.
- **Outputs.** Module and deployment outputs are interfaces rather than
  infrastructure; the extractor follows them to resolve references, but doesn't
  draw them as entities.
