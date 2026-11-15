# Moved components comparator

[`moved-components.comparator.yaml`](moved-components.comparator.yaml)
recognizes components that moved between modules. When an extractor's IDs
include a component's module (`component:billing/InvoiceService`), a moved
component gets a new ID, and the default comparator sees one component removed
and an unrelated one added. These rules pair each removed entity with the added
entity of the same kind and label, when there is exactly one of each, as a
`declared` correspondence, and pair the relationships between them the same way.
The moves form one step of their own, between the removals and the additions.

Every view then shows one component that moved, marked Renamed, instead of one
removed and another added; see
[Custom comparators: what they make possible](../../../docs/guides/comparators.md#identity-renames-moves-splits-and-merges).

```json
"comparator": ".github/projections/moved-components.comparator.yaml"
```

There is nothing to build: every host runs the comparator file in the sandboxed
rules interpreter. [`fixtures`](fixtures) holds the example in the guide:
`InvoiceService` moves from `billing` to `invoicing`.
[`moved-components.comparator.test.yaml`](moved-components.comparator.test.yaml)
states what the comparator makes of it (one unchanged component with its uses,
the move as one step), that a moved component that also changed is modified, and
that an ambiguous pairing is left alone. In a repository whose projection uses
the comparator, with the test file beside it:

```sh
projections check -p <id> --no-render   # runs the cases, among the projection's checks
```
