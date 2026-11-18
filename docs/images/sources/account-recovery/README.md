---
description: "A Rails license server before and after it gains user accounts and account recovery, for the Rails built-ins' images"
---

# Account recovery

The [`rails-schema`](../../../../docs/builtins/extractors/rails-schema.md) and
[`rails-routes`](../../../../docs/builtins/extractors/rails-routes.md) images.

A small Rails application that issues licenses for a desktop app. `before` keys
each license by email; `after` adds `users` with account recovery and a
`license_purchases` table, gives `licenses` a `user_id` foreign key and makes
its `email` optional, makes the account dashboard the home page, and adds
sessions, registration, recovery, an account area, purchase webhooks and an API
to claim a license. The extractors read `db/schema.rb` and `config/routes.rb`;
nothing runs, and there is no Ruby or Gemfile here.
`node tools/scripts/readme-images.mjs --only rails-schema,rails-routes` commits
`before` and `after` as two revisions and draws the images.
