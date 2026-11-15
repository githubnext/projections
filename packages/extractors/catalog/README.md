---
description: Registers the built-in extractors in their published order
---

# Extractor catalog

`projections-extractor-catalog` registers the built-in extractors in their
published order, declared once in its `registry!` list: each entry names an
extractor crate, whose `ID`, `descriptor`, `requires_trust` and `collect` it
registers. It builds the `projections extractor list` document and definition
templates from each extractor's own descriptor, answers whether a definition
requires `--trust` before execution, and dispatches `collect` to the selected
extractor crate inside the `projections __extract <id>` process.
