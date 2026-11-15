# Test timings comparator

[`test-timings.comparator.yaml`](test-timings.comparator.yaml) reads volatile
data. A test-results extractor declares its durations volatile with a tolerance:

```json
"volatile": [
  {"kinds": ["test"], "path": "/data/durationMs", "tolerance": {"absolute": 50, "relative": 0.2}}
]
```

A test whose duration moved within that tolerance is an `unchanged` change with
`varied`: listed, so the noise stays visible, but in no step. A duration beyond
it makes the test `modified`, and `change.varied` says which value and whether
it was within. The rules summarize those regressions
(``Test `load` got slower beyond tolerance``) and list the noise in the
comparison's metadata; see
[Volatile data](../../../docs/guides/how-it-works.md#volatile-data) and
[`change.varied`](../../../docs/design/declarative-comparators.md).

[`test-timings.comparator.test.yaml`](test-timings.comparator.test.yaml) states
what the comparator makes of jitter within tolerance, a regression beyond it and
a status change. `projections check -p <id>` runs the cases for a projection
that uses the comparator.
