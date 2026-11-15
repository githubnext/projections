"""Extractor for the "{{id}}" projection.

Projections runs this program and reads one extraction from it: the entities
and relationships that matter in this codebase, as data.
`projections help authoring` explains the whole loop.

The starter describes each top-level directory and how many files it holds.
Replace it with the facts this projection is about.

Rules: read the examined revision only through request.root, never the
network or the clock, so the same revision always gives the same extraction.
Give items IDs that stay stable when unrelated things change
("route:GET /orders", not a list position).

request.root is this projection's project (the directory holding its
definition) in the examined revision. The definition's paths and inputs are
relative to it; so are evidence paths.

Projections provides the `projections` module: there is nothing to install.
"""

import os

from projections import request, result


def count_files(directory):
    return sum(len(files) for _, _, files in os.walk(directory))


entities = {}
for name in os.listdir(request.root):
    if os.path.isdir(os.path.join(request.root, name)) and not name.startswith("."):
        entities[f"directory:{name}"] = {
            "kind": "directory",
            "label": name,
            "data": {"files": count_files(os.path.join(request.root, name))},
            "evidence": [{"kind": "file", "source": name}],
        }

# In the general graph/v0 schema, result()'s default; schema="..." picks a closer one.
result(entities=entities)
