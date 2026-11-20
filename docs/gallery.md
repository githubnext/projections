# Gallery

Here is one example of every built-in renderer, generated directly by the CLI
with `projections compare --png` and `projections show --png`. Most images show
a change between revisions, while a few capture a system at a single point in
time.

Most examples come from small sample projects under
[`images/sources`](images/sources) (linked under each image), and the rest come
from public repositories at pinned commits. You can regenerate the whole set
with `node tools/scripts/readme-images.mjs`.

## Dependency injection

The [`dependency-injection`](builtins/renderers/dependency-injection.md)
renderer maps a container's registrations as a graph showing each service, its
lifetime, and the dependencies it injects.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/readme/di-split-animated-dark.png">
  <img width="880" alt="An animated dependency graph: OrderService, which both controllers inject, turns red and leaves; CheckoutService and OrderQueries arrive, each depending on only what it needs" src="images/readme/di-split-animated-light.png">
</picture>

An animated view of `OrderService` splitting into two focused services
([`docs/images/sources/order-service-split`](images/sources/order-service-split/README.md),
using `dotnet-di`).

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/readme/di-split-dark.png">
  <img width="880" alt="The same change as one diff: OrderService removed in red, two new services added in green, and each controller listing the dependency it lost and the one it gained" src="images/readme/di-split-light.png">
</picture>

The same split shown as a single diff, where each controller lists the
dependency it dropped and the one it injects now.

## Database schema

The [`database`](builtins/renderers/database.md) renderer lays out tables,
columns, keys, and the foreign-key relationships between them.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/readme/database-dark.png">
  <img width="660" alt="A schema diff: a new Organization table takes plan and stripeCustomerId from User, a Membership table and a Role enum arrive, and Project and Invoice point at organizations instead of users" src="images/readme/database-light.png">
</picture>

Billing moving from individual users to organizations
([`docs/images/sources/billing-to-organizations`](images/sources/billing-to-organizations/README.md),
using `prisma-schema`).

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/readme/database-after-dark.png">
  <img width="660" alt="The schema after the change: Organization, User, Membership, Project, Invoice and the Role enum, with their foreign keys" src="images/readme/database-after-light.png">
</picture>

The resulting schema viewed at a single revision.

## Architecture

The `architecture` presentation of the [`graph`](builtins/renderers/graph.md)
renderer shows components and how they connect—in this case, domain events along
with the code that publishes and handles them.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/readme/architecture-after-dark.png">
  <img width="880" alt="An event flow: checkout publishes order.placed, billing handles it and publishes payment.captured, which shipping and notifications handle" src="images/readme/architecture-after-light.png">
</picture>

An online shop's event flow at one revision
([`docs/images/sources/order-event-flow`](images/sources/order-event-flow/README.md),
extracted with the `message-handlers` sample extractor).

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/readme/architecture-dark.png">
  <img width="880" alt="The change that made it: three handlers of order.placed removed, and payment.captured, its publisher and its two handlers added" src="images/readme/architecture-light.png">
</picture>

The diff that introduced it, where three `order.placed` handlers give way to a
`payment.captured` chain.

## Infrastructure

The `infrastructure` presentation maps cloud resources, the references between
them, and what a deployment plan will do to each one.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/readme/infrastructure-dark.png">
  <img width="880" alt="A Terraform plan: the main database is replaced to encrypt its storage, its replica, DNS record and connection parameter update in place, a Secrets Manager secret is created and the bastion host destroyed" src="images/readme/infrastructure-light.png">
</picture>

A Terraform plan replacing a database to enable storage encryption
([`docs/images/sources/encrypt-database`](images/sources/encrypt-database/README.md),
using `terraform-infrastructure`).

## Dependencies

The `dependencies` presentation shows packages, what depends on them, and how
their versions shift across a change.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/readme/dependencies-dark.png">
  <img width="880" alt="An npm workspace: React upgraded from 18 to 19, moment replaced by date-fns, classnames by clsx, and a new icons workspace" src="images/readme/dependencies-light.png">
</picture>

Upgrading a workspace from React 18 to 19
([`docs/images/sources/react-19-upgrade`](images/sources/react-19-upgrade/README.md),
using `workspace-dependencies`).

## Pipeline

The `dag` presentation shows pipeline jobs and which ones wait on each other.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/readme/dag-dark.png">
  <img width="560" alt="A CI workflow: the deploy job is removed, e2e and deploy-staging run after build, and deploy-production waits for both" src="images/readme/dag-light.png">
</picture>

A workflow gaining end-to-end tests and a staged deployment
([`docs/images/sources/deploy-pipeline-split`](images/sources/deploy-pipeline-split/README.md),
using `github-actions-jobs`).

## Public API

The [`api`](builtins/renderers/api.md) renderer lists exported declarations and
their signatures. Paired with the API compatibility comparator, it also flags
which changes break callers.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/readme/api-dark.png">
  <img width="760" alt="Four breaking changes to a TypeScript client: search removed, a required headers member added to Response, createClient taking an options object, and withRetry removed, each with why it breaks" src="images/readme/api-light.png">
</picture>

Breaking changes in a client library, with an explanation of why each breaks
callers
([`docs/images/sources/client-breaking-changes`](images/sources/client-breaking-changes/README.md),
using `typescript-public-api`).

## Text

The [`text-diff`](builtins/renderers/text-diff.md) renderer diffs captured
command output line by line.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/readme/text-diff-dark.png">
  <img width="640" alt="A command's help text: publish replaced by deploy and rollback, the preview port changed, --out renamed --output and --legacy removed" src="images/readme/text-diff-light.png">
</picture>

How a CLI's help text changed across a release
([`docs/images/sources/cli-help-release`](images/sources/cli-help-release/README.md),
using `command-output`).

## Code statistics

The [`code-statistics`](builtins/renderers/code-statistics.md) renderer breaks
down lines of code by language.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/readme/code-statistics-dark.png">
  <img width="700" alt="fish shell from 3.7.0 to 4.0.0: Rust added, 70,286 lines; C++ removed, 48,829 lines; C headers removed" src="images/readme/code-statistics-light.png">
</picture>

The fish shell's port from C++ to Rust between 3.7.0 and 4.0.0
([fish-shell/fish-shell](https://github.com/fish-shell/fish-shell)).

## Files

The [`file-packing`](builtins/renderers/file-packing.md) renderer arranges files
as circles sized by byte count and nested inside their folders.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/readme/file-packing-dark.png">
  <img width="560" alt="Every file in fish shell 4.0.0 as a circle sized by bytes, packed inside its folder and coloured by language" src="images/readme/file-packing-light.png">
</picture>

Every file in fish shell 4.0.0 shown at a single revision.

## Runtime security policy

The [`runtime-policy`](builtins/renderers/runtime-policy.md) renderer displays
runtime security policies along with their hooks, rules, and targets. With the
runtime policy comparator, it also spells out what each change means.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/readme/runtime-policy-dark.png">
  <img width="820" alt="A Tetragon credentials policy: its scope broadened from payments to checkout and payments, a new rule that kills curl and wget reading the service account token, newly enforced, and the security_mmap_file hook no longer covered" src="images/readme/runtime-policy-light.png">
</picture>

A credentials policy broadening its scope and beginning to kill downloaders that
read the service account token
([`docs/images/sources/credentials-policy`](images/sources/credentials-policy/README.md),
using `tetragon-policies`).

## Agentic workflows

The [`agentic-workflows`](builtins/renderers/agentic-workflows.md) renderer
presents each GitHub Agentic Workflow as a card covering its triggers, what the
agent can reach and write, its budgets, and what it loads. With the
agentic-workflows comparator, it highlights changes that widen what an agent is
allowed to do.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/readme/agentic-workflows-dark.png">
  <img width="1240" alt="A group of gh-aw documentation workflows: docs-bot reaches another repository, writes more and stops loading a guardrail, docs-bot-links may run any command and reach more domains, each section marked Widened" src="images/readme/agentic-workflows-light.png">
</picture>

A pull request widening permissions across a set of documentation workflows and
dropping a guardrail
([`docs/images/sources/docs-bot`](images/sources/docs-bot/README.md), using
`github-agentic-workflows`).

For generic graphs without domain-specific labels, the
[`graph`](builtins/renderers/graph.md) renderer also offers plain `graph` and
`graph-horizontal` presentations that use the same cards and arrows.
