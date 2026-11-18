---
description: A Rails application's config/routes.rb as its route table (api/v0)
---

# Rails routes — `api/v0`

`rails-routes` describes the route table a Rails application's
`config/routes.rb` declares: one `route` entity per route, a `mount` per mounted
application and an `unresolved` entity for each declaration it can't expand
without running the application. The [`api`](../../renderers/api/README.md)
renderer lists them by path, each with its signature: the controller action or
endpoint, the route's name, and any constraints, defaults and conditions.

```json
{
  "id": "routes",
  "extractor": "rails-routes",
  "inputs": { "routes": "web/config/routes.rb" }
}
```

- `inputs.routes`: a routes file, or a list of them.
- Without it, every application's `config/routes.rb` at any depth, except under
  `test/`, `spec/`, `vendor/`, `tmp/` and the like (an engine's dummy app). Each
  route's ID names its application's directory, so several applications (a host
  and its engines) can be listed together.
- `inputs.inflections`: the initializer whose inflections singularize resource
  names; default `config/initializers/inflections.rb` beside `config/routes.rb`.

## How routes are read

Projections evaluates the routing DSL itself, with
[`ruby-support`](../ruby-support/README.md)'s reader, the way ActionDispatch's
`Mapper` evaluates it: no Ruby, Bundler, gems, Rails boot or database, and no
trust, so it is quick and works on every revision. `bin/rails routes`
(`bin/rails runner`) needs the revision's gems installed and boots the
application, seconds per revision, which history comparisons can't afford.

It evaluates `routes.draw` (and `append`/`prepend`) blocks:

- `get`, `post`, `put`, `patch`, `delete`, `options` and `match` (`via:`), with
  `to:` (`"controller#action"`, an action, `redirect(...)` or a Rack
  application), `controller:`, `action:`, `as:`, `on:`, `path:`, `format:`,
  `constraints:`, `defaults:` and requirements, the hash form
  (`get "about" => "pages#about"`) and the `"photos/search"` shorthand.
- `root`, `resources` and `resource` with `only:`, `except:`, `path:`, `as:`,
  `controller:`, `param:`, `module:`, `shallow:` and `concerns:`, nested
  resources, `member`, `collection`, `new` and `shallow`.
- `namespace` (`path:`, `as:`, `module:`, `shallow_path:`, `shallow_prefix:`),
  `scope` (a path, `module:`, `as:`, `controller:`, `only:`/`except:`,
  requirements), `controller`, `defaults` and `constraints` blocks.
- `concern` (with a block) and `concerns`, `mount` (`at:` or `=>`, `as:`) and
  `draw`, which reads `config/routes/<name>.rb`.
- `config.api_only = true` in `config/application.rb`, which drops resources'
  `new` and `edit`, and the application's inflections.

Route names, paths, controllers and actions follow ActionDispatch exactly:
`tests/fixtures/expected` holds the route tables ActionPack 6.1.7.10's own
router builds from the fixtures (`tests/fixtures/oracle.rb` printed them), and
the tests require the reader to reproduce them in order. Names Rails leaves off
(a second route with the same name) are left off too.

## What it can't see

Some routes exist only when the application runs. They are listed, never
guessed:

- Methods that aren't part of Rails' routing DSL, such as `devise_for` or a
  gem's `authenticate` block, are `unresolved` entities: their routes aren't
  expanded, and routes inside their blocks aren't either.
- Routes built from computed values (an interpolated path, a variable, a splat)
  or in loops (`%w[a b].each`), and any other Ruby, are `unresolved`, with the
  source text and a reason.
- A mounted engine's or Rack application's own routes: the mount is one entity
  at its path. Read an engine's `config/routes.rb` as its own application (its
  paths are relative to the mount).
- Conditions (`if Rails.env.development?`) and constraint objects or lambdas
  aren't evaluated: the routes are listed with the condition or constraint as
  written in their signature, `data.conditions` and `data.constraints`.
- Errors Rails raises while drawing (a route without a controller, `match`
  without `via:`) are `unresolved` entities with that reason.

## What the extraction contains

- `route`: identified by application, path (without `(.:format)`) and verbs,
  `route:/photos/:id GET` (`route:web:/photos/:id GET` for an application in
  `web/`), so IDs order routes by path; its label is `GET /photos/:id`. Data:
  `signature`, `verbs` (`ANY` for `via: :all`), `path`, `pattern` (as
  `bin/rails routes` prints it, with `(.:format)`), `controller`, `action`,
  `endpoint`, `name`, `constraints`, `defaults` and `conditions`.
- `mount`: identified by application and path (`mount:/sidekiq`); its label is
  the path. Data as a route's, with the application in `endpoint`.
- `unresolved`: identified by application, file and first line of source. Data:
  `signature` (the reason), `text`, `reason`, `conditions`.

Each item's evidence names its routes file and line. Metadata records the
applications, whether each is API-only, the number unresolved and the
extraction's limitations.

## Tests

```sh
cargo test -p projections-extractor-rails-routes
```

To regenerate the expected route tables, install ActionPack and run
`ruby tests/fixtures/oracle.rb tests/fixtures/<app>/config/routes.rb` for each
fixture.
