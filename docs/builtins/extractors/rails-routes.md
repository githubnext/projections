# Rails routes

The routes a Rails application's `config/routes.rb` declares, one row each: its
verb and path beside the controller action it reaches and its name, as
`bin/rails routes` would print them, read from the routes file itself. Compared
across a pull request, it answers "which URLs does this change add, remove or
send somewhere else?"

<!-- generated: facts -->

- ID: `rails-routes`
- Extraction schema: [`api/v0`](../../reference/schemas/api.md)
- Drawn by default with: [`api`](../renderers/api.md)
- Needs `--trust`: No (`none`)
- Suggested when the repository has: `config/routes.rb`, `**/config/routes.rb`

<!-- end generated: facts -->

## When to use it

Use it in any Rails application to review routing changes as the routes they
produce rather than as DSL: a `resources` that gains `:destroy`, a member route
added, a namespace moved, a route sent to another controller. Projections
evaluates the routing DSL itself, the way Rails' router does, so it needs no
Ruby, no gems, no application boot and no `--trust`. It is quick and works on
every revision in your history, even ones whose gems you no longer have
installed, where `bin/rails routes` would need each revision's gems.

It sees what the routes file declares, not what the running application adds:
see [what it can't see](#what-it-cant-see). Pair it with
[`rails-schema`](rails-schema.md) to see a change's schema beside its routes.

## What it reads

- The routes file: `routes` (one file or a list). With neither, every
  application's `config/routes.rb` in the repository, except an engine's dummy
  app under `test/` or `spec/`; each route's ID includes its application's
  directory, so a host application and its engines can be listed together.
- The routing DSL, as Rails' `ActionDispatch::Routing::Mapper` evaluates it:
  - `get`, `post`, `put`, `patch`, `delete`, `options` and `match` (`via:`),
    with `to:` (`"controller#action"`, `redirect(...)` or a Rack application),
    `as:`, `on:`, `controller:`, `action:`, `path:`, `format:`, `constraints:`
    and `defaults:`;
  - `root`; `resources` and `resource` with `only:`, `except:`, `path:`, `as:`,
    `controller:`, `param:`, `module:`, `shallow:` and `concerns:`, nested
    resources, `member`, `collection`, `new` and `shallow`;
  - `namespace`, `scope`, `controller`, `defaults` and `constraints` blocks;
  - `concern` and `concerns`, `mount`, and `draw`, which reads
    `config/routes/<name>.rb`.
- `config.api_only = true` in `config/application.rb`, which drops resources'
  `new` and `edit` routes, and the inflections in
  `config/initializers/inflections.rb` (or `inflections`), which decide resource
  names (`resources :inventory` with `inventory` uncountable is
  `inventory_index`).

Each route is a `route` entity labelled with its verbs and path
(`GET /photos/:id`); its signature is the controller action or endpoint, then
its name, constraints, defaults and conditions: `photos#show as photo`,
`redirect("/products", status: 301) as legacy_catalog`,
`api/v1/orders#index as api_v1_orders defaults format: :json`. Each `mount` is a
`mount` entity at its path (`mount Sidekiq::Web as sidekiq_web`).

Names, paths, controllers and actions match Rails' own router: the tests compare
them, in order, with the route tables ActionPack builds from the same files.

### What it can't see

Some routes only exist when the application runs. They are listed as
`unresolved` entities, with the source and a reason, rather than guessed:

- **Routes from gems**: `devise_for :users`, an `authenticate` block, any method
  that isn't part of Rails' routing DSL. The call is listed; its routes, and
  routes inside its block, aren't expanded.
- **Computed routes**: an interpolated path, a variable, routes drawn in a loop
  (`%w[about terms].each`), and any other Ruby.
- **Mounted engines' routes**: a mount is one entity at its path. Read the
  engine's own `config/routes.rb` as another application to see its routes
  (relative to where it is mounted).
- **Errors Rails raises** while drawing, such as a route with no controller or
  `match` without `via:`.

Conditions (`if Rails.env.development?`) and constraint objects or lambdas
aren't evaluated either: the routes are listed with the condition or constraint
as written, so a development-only route shows `if Rails.env.development?` in its
signature.

## Options

<!-- generated: inputs -->

| Input         | Meaning                                                                                      |
| ------------- | -------------------------------------------------------------------------------------------- |
| `inflections` | Inflections initializer; default config/initializers/inflections.rb beside config/routes.rb. |
| `routes`      | Routes file or files; otherwise discovers each application's config/routes.rb.               |

<!-- end generated: inputs -->

## What a comparison shows

The [`api`](../renderers/api.md) renderer lists every route by path, so a
resource's routes stay together.

- **Routes added or removed**: a new resource's seven routes, a member route, a
  route that moved to another path. A route's identity is its verbs and path, so
  changing a verb or path reads as one removed and one added.
- **Routes modified**: the same verb and path reaching another controller or
  action, renamed (`as:`), or gaining a constraint or condition, with the
  signature's changed runs struck through and underlined in place.
- **Unresolved declarations** added or removed, so a new `devise_for` is visible
  even though its routes aren't expanded.

The summary bar counts the entities (`47 declarations +23 ~1`).

## Start from this definition

<!-- generated: definition -->

```json
{
  "extractor": "rails-routes",
  "id": "rails-routes",
  "renderer": "api",
  "title": "Rails routes"
}
```

<!-- end generated: definition -->

## Screenshot

The license server's routes as it gains accounts: the home page becomes the
account dashboard, and an account area, sessions, registration, recovery,
purchase webhooks and a claim action for the licenses API arrive
([`docs/images/sources/account-recovery`](../../images/sources/account-recovery/README.md)).

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../../images/readme/rails-routes-dark.png">
  <img width="760" alt="The api renderer comparing two Rails route tables: GET / modified from pages#home to dashboards#show, and the account routes added, each with its controller action and route name" src="../../images/readme/rails-routes-light.png">
</picture>

## Limitations

- Routes are listed by path, not in the order Rails matches them, so a change
  that only reorders routes (and so which of two overlapping routes wins) shows
  nothing.
- Requirements, constraints and defaults are recorded as written, not evaluated;
  a route whose constraint changes reads as modified, but what the constraint
  now matches isn't shown.
- Names Rails generates follow ActiveSupport's inflections plus the
  application's literal `irregular`, `uncountable`, `plural` and `singular`
  rules; inflections declared any other way are reported and left out.
- `config.api_only` is read only when `config/application.rb` assigns it
  literally.
- The `api` renderer lists at most 500 routes; in a comparison, changed routes
  are listed first, and the host's table lists every route.

## Related

- [`api`](../renderers/api.md), the renderer that lists it.
- [`rails-schema`](rails-schema.md), the application's database schema.
- [The default comparator](../comparators/default.md), which decides what
  changed.

## How it works

The [package README](../../../packages/extractors/rails-routes/README.md)
details how the DSL is evaluated, what it covers and the extraction's model.

## Build your own

Write your own extractor when the routes file isn't the picture you want:

- **The application's real route table**, including gems' and engines' routes:
  `bin/rails runner` printing `Rails.application.routes.routes` as JSON, run
  with `--trust`. Each revision needs its own gems, so history comparisons need
  an environment that installs them.
- **Who calls each route**: your front end's or clients' requests, matched to
  routes, drawn as an architecture graph.
- **Routes with their authorization**: the policies or `before_action`s each
  controller action runs.

**In VS Code**, choose **+ New Projection…** in the Projections view, then
**Write a custom extractor, renderer or comparator** › **Custom extractor**, and
pick its language. Or choose **Ask an agent to write it** and describe what the
projection should show.

**With the CLI**:

```sh
projections init <id> --language node --renderer api
```

An extractor is any program that prints an extraction. Run it with
`projections show -p <id> --trust` as you change it.
[Write your first extractor](../../guides/first-extractor.md) walks through one,
and the [`api/v0` schema](../../reference/schemas/api.md) lists the fields the
`api` renderer reads.
