# Model upgrades comparator

[`model-upgrades.comparator.yaml`](model-upgrades.comparator.yaml) reads
generated values. An extractor that has a model summarize each class declares
the summary generated, with the basis it was generated from:

```json
"volatile": [
  {"kinds": ["class"], "path": "/data/summary", "generated": true, "basis": "/data/summaryBasis"}
]
```

A summary reworded from an equal basis is an `unchanged` change with `varied`:
listed, but in no step. A summary whose basis moved makes its class `modified`,
and `change.varied` says which parts moved (`because`). The rules use
`generated.only(change, ['model'])` to find the changes that differ only because
the model changed, summarize them and gather them in a final step, so changes
whose input or prompt moved come first. Rules can't make a model upgrade
`unchanged`: an extractor that doesn't want model changes to count leaves the
model out of its basis. See
[generated values](../../../docs/design/generated-values.md) and the
[`class-summaries`](../../extractors/class-summaries/README.md) sample
extractor.

[`model-upgrades.comparator.test.yaml`](model-upgrades.comparator.test.yaml)
states what the comparator makes of rewording, an input change and a model
upgrade. `projections check -p <id>` runs the cases for a projection that uses
the comparator.
