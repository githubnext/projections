---
description: "Shared support for the Rails extractors: a reader for declarative Ruby and ActiveSupport's inflections"
---

# Ruby support

`projections-extractor-ruby-support` is shared by
[`rails-schema`](../rails-schema/README.md) and
[`rails-routes`](../rails-routes/README.md); it registers no extractor itself.
It reads the declarative Ruby that Rails keeps its schema and routes in without
running Ruby, so extraction needs no Ruby, Bundler, gems or database and works
on any revision, however old its dependencies.

```rust
let statements = projections_extractor_ruby_support::parse(source, "config/routes.rb")?;
let mut inflections = projections_extractor_ruby_support::inflect::Inflections::default();
inflections.read(&parse(initializer, "config/initializers/inflections.rb")?);
```

## The reader

`parse` turns source into statements: method calls with their receivers,
positional and keyword arguments (including hash rockets and `**`/`&` splats),
`do`/`end` and brace blocks with their parameters, and the literals
configuration DSLs use: strings (escapes decoded, interpolation kept as text),
symbols, numbers, regular expressions, `%w[]`/`%i[]`, `%q`/`%Q`/`%r`, heredocs
(`<<~`, `<<-`, quoted), arrays, hashes, constants and lambdas. `if`/`unless`
(with `elsif`/`else`) and modifier conditions are statements with their
condition's text.

It doesn't evaluate Ruby. Operators, assignments, method definitions, `case`,
loops and anything else it doesn't model are kept as text (`Kind::Other`,
`Stmt::Other`) with their line, so each reader can say what it didn't interpret
rather than guess. Only unbalanced source (an unterminated string or heredoc, a
block never closed, a stray `end`) is an error, naming the file and line.

## Inflections

`inflect::Inflections` singularizes and pluralizes as ActiveSupport does: its
default English rules, irregulars and uncountables (ported from
`activesupport/lib/active_support/inflections.rb`, MIT licensed; the notice is
in `src/inflect.rs`), applied newest first. `read` adds an application's own
`irregular`, `uncountable`, `plural` and `singular` rules from
`ActiveSupport::Inflector.inflections` blocks; `acronym` and `human` change
casing and display, not number, and are accepted. Any other rule is listed in
`unread`, for the extractor to report.

## Tests

```sh
cargo test -p projections-extractor-ruby-support
```
