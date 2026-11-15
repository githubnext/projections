# Class summaries — custom extractor sample

[`extract.mjs`](extract.mjs) finds every TypeScript class and records a one-line
summary of what it does, written by a model. Summaries are useful, but a model
rewords its answer every time it's asked, so the extraction declares each
summary a **generated value** with the basis it was generated from:

```json
"volatile": [
  {"kinds": ["class"], "path": "/data/summary", "generated": true, "basis": "/data/summaryBasis"}
]
```

The basis names what the summary depends on, each part hashed: the class's
source (`input`), the prompt (`prompt`) and the model's ID (`model`, kept
verbatim). Comparisons judge a summary by its basis, never its wording: equal
bases make any rewording expected variation (the class stays unchanged), and a
moved part makes the class `modified`, saying which part moved. See
[generated values](../../../docs/design/generated-values.md).

The sample uses `basis()` and `generations()` from
`@githubnext/projections/extractor`. `generations()` reads the runner's
**generation store**: summaries earlier extractions generated, keyed by the
declared path and the basis. When the basis is equal, the extractor reuses the
stored text instead of asking the model again, so reruns and pull request
comparisons are byte-identical.

Its model is a deterministic stand-in, `fake-summarizer`, that builds a sentence
from the class's members and picks one of a few wordings by
`FAKE_SUMMARIZER_SAMPLE`, so the sample makes no network or paid calls. Replace
`summarize` with a call to your model, and give the definition the network and
the credentials it needs:

```json
{
  "id": "class-summaries",
  "title": "Class summaries",
  "extractor": {
    "command": ["node", "tools/projections/class-summaries/extract.mjs"],
    "sources": ["tools/projections/class-summaries", "tools/projections/typescript-common"]
  },
  "renderer": "architecture",
  "inputs": {"model": "fake-summarizer@1"},
  "execution": {"network": true, "environment": ["MODEL_API_KEY"], "determinism": "environmental"}
}
```

`inputs.model` names the model; changing it regenerates every summary. Put in
the basis everything that should regenerate a summary when it changes (the
source the model read, the prompt, the model if an upgrade should count) and
nothing else: no seeds, timestamps or credentials.

The [`model-upgrades`](../../comparators/model-upgrades/README.md) comparator
puts changes that differ only by model in a final step.
