# Priority order comparator

[`priority-order.comparator.yaml`](priority-order.comparator.yaml), for teams
that always want certain entities reviewed first, such as platform packages.

It starts from the baseline comparison and stably moves the steps that change
any entity listed in `options.priority` to the front, ordered by their most
important priority entity. Other steps keep their baseline order; changes are
untouched, so the result always covers the same changes as the baseline.

```json
"comparator": {
  "file": ".github/projections/priority-order.comparator.yaml",
  "options": {"priority": ["package:@acme/core", "package:@acme/auth", "package:@acme/ui"]}
}
```

When the baseline uses `"order": {"reverse": "explicit"}`, its `reverseSteps`
are left as they are.

[`priority-order.comparator.test.yaml`](priority-order.comparator.test.yaml)
states what the comparator is for, as cases over the two extractions in
[`fixtures`](fixtures): `@acme/core` and `@acme/auth` lead, ahead of the default
order; without a priority the default order stands; and options it doesn't know
are rejected. The first case also keeps the whole comparison in
[`snapshots/priority.json`](snapshots/priority.json). Copy the comparator file
and the test file (with its fixtures) into a repository whose projection uses
it, and:

```sh
projections check -p <id> --no-render            # runs the cases, among the projection's checks
projections check -p <id> --no-render --update   # rewrites the snapshot after an intended change
```
