# Gallery

One example for each built-in renderer, drawn by the CLI with
`projections compare --png` and `projections show --png`. Most draw a change;
some draw a system at one revision. Most come from small, made-up projects in
[`images/sources`](images/sources), each linked below; the others are public
repositories at pinned commits. `node tools/scripts/readme-images.mjs` draws
them all again.

## Dependency injection

The [`dependency-injection`](builtins/renderers/dependency-injection.md)
renderer draws a container's registrations as a graph: each service, its
lifetime and what it injects.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/readme/di-split-dark.gif">
  <img width="880" alt="An animated dependency graph: OrderService, which both controllers inject, turns red and leaves; CheckoutService, OrderQueries and OrderNotifications arrive, each depending on only what it needs" src="images/readme/di-split-light.gif">
</picture>

`OrderService` split into three focused services, animated
([`docs/images/sources/order-service-split`](images/sources/order-service-split/README.md),
`dotnet-di`).

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/readme/di-split-dark.png">
  <img width="880" alt="The same change as one diff: OrderService removed in red, three new services added in green, and each controller listing the dependency it lost and the ones it gained" src="images/readme/di-split-light.png">
</picture>

The same change as one diff: each controller lists what it now injects instead.

## Database schema

The [`database`](builtins/renderers/database.md) renderer draws tables, columns,
keys and the foreign keys between them.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/readme/database-dark.png">
  <img width="660" alt="A schema diff: a new Organization table takes plan and stripeCustomerId from User, a Membership table and a Role enum arrive, and Project and Invoice point at organizations instead of users" src="images/readme/database-light.png">
</picture>

Billing moves from users to organizations
([`docs/images/sources/billing-to-organizations`](images/sources/billing-to-organizations/README.md),
`prisma-schema`).

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/readme/database-after-dark.png">
  <img width="660" alt="The schema after the change: Organization, User, Membership, Project, Invoice and the Role enum, with their foreign keys" src="images/readme/database-after-light.png">
</picture>

The same schema at one revision.

## Architecture

The [`graph`](builtins/renderers/graph.md) renderer's `architecture`
presentation draws components and how they connect; here, events and the code
that publishes and handles them.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/readme/architecture-after-dark.png">
  <img width="880" alt="An event flow: checkout publishes order.placed, billing handles it and publishes payment.captured, which shipping and notifications handle" src="images/readme/architecture-after-light.png">
</picture>

A shop's event flow at one revision
([`docs/images/sources/order-event-flow`](images/sources/order-event-flow/README.md),
the `message-handlers` sample extractor).

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/readme/architecture-dark.png">
  <img width="880" alt="The change that made it: three handlers of order.placed removed, and payment.captured, its publisher and its two handlers added" src="images/readme/architecture-light.png">
</picture>

The change that made it: three handlers of `order.placed` give way to a
`payment.captured` chain.

## Infrastructure

The `infrastructure` presentation draws cloud resources, the references between
them and what a plan does to each.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/readme/infrastructure-dark.png">
  <img width="880" alt="A Terraform plan: the main database is replaced to encrypt its storage, its replica, DNS record and connection parameter update in place, a Secrets Manager secret is created and the bastion host destroyed" src="images/readme/infrastructure-light.png">
</picture>

A Terraform plan that replaces a database
([`docs/images/sources/encrypt-database`](images/sources/encrypt-database/README.md),
`terraform-infrastructure`).

## Dependencies

The `dependencies` presentation draws packages, what depends on them and how
their versions move.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/readme/dependencies-dark.png">
  <img width="880" alt="An npm workspace: React upgraded from 18 to 19, moment replaced by date-fns, classnames by clsx, and a new icons workspace" src="images/readme/dependencies-light.png">
</picture>

A React 18 to 19 upgrade across a workspace
([`docs/images/sources/react-19-upgrade`](images/sources/react-19-upgrade/README.md),
`workspace-dependencies`).

## Pipeline

The `dag` presentation draws jobs and what each waits for.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/readme/dag-dark.png">
  <img width="560" alt="A CI workflow: the deploy job is removed, e2e and deploy-staging run after build, and deploy-production waits for both" src="images/readme/dag-light.png">
</picture>

A workflow gains end-to-end tests and a staged deploy
([`docs/images/sources/deploy-pipeline-split`](images/sources/deploy-pipeline-split/README.md),
`github-actions-jobs`).

## Public API

The [`api`](builtins/renderers/api.md) renderer lists declarations with their
signatures; with the API compatibility comparator, it says which changes break
callers.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/readme/api-dark.png">
  <img width="760" alt="Four breaking changes to a TypeScript client: search removed, a required headers member added to Response, createClient taking an options object, and withRetry removed, each with why it breaks" src="images/readme/api-light.png">
</picture>

A client library's breaking changes, and why each breaks
([`docs/images/sources/client-breaking-changes`](images/sources/client-breaking-changes/README.md),
`typescript-public-api`).

## Text

The [`text-diff`](builtins/renderers/text-diff.md) renderer compares captured
command output line by line.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/readme/text-diff-dark.png">
  <img width="640" alt="A command's help text: publish replaced by deploy and rollback, the preview port changed, --out renamed --output and --legacy removed" src="images/readme/text-diff-light.png">
</picture>

A command line's help across a release
([`docs/images/sources/cli-help-release`](images/sources/cli-help-release/README.md),
`command-output`).

## Code statistics

The [`code-statistics`](builtins/renderers/code-statistics.md) renderer draws
lines of code by language.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/readme/code-statistics-dark.png">
  <img width="700" alt="fish shell from 3.7.0 to 4.0.0: Rust added, 70,286 lines; C++ removed, 48,829 lines; C headers removed" src="images/readme/code-statistics-light.png">
</picture>

fish shell's port from C++ to Rust, 3.7.0 to 4.0.0
([fish-shell/fish-shell](https://github.com/fish-shell/fish-shell)).

## Files

The [`file-packing`](builtins/renderers/file-packing.md) renderer packs files as
circles sized by their bytes inside their folders.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/readme/file-packing-dark.png">
  <img width="560" alt="Every file in fish shell 4.0.0 as a circle sized by bytes, packed inside its folder and coloured by language" src="images/readme/file-packing-light.png">
</picture>

Every file in fish shell 4.0.0, at one revision.

## Runtime security policy

The [`runtime-policy`](builtins/renderers/runtime-policy.md) renderer draws
runtime security policies, the hooks they attach to, their rules and who they
apply to; with the runtime policy comparator, it says what each change means.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/readme/runtime-policy-dark.png">
  <img width="820" alt="A Tetragon credentials policy: its scope broadened from payments to checkout and payments, a new rule that kills curl and wget reading the service account token, newly enforced, and the security_mmap_file hook no longer covered" src="images/readme/runtime-policy-light.png">
</picture>

A credentials policy starts killing downloaders that read the service account
token, and widens its scope
([`docs/images/sources/credentials-policy`](images/sources/credentials-policy/README.md),
`tetragon-policies`).

The [`graph`](builtins/renderers/graph.md) renderer's plain `graph` and
`graph-horizontal` presentations draw the same cards and arrows as the
presentations above, without their domain wording.
