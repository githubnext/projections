"""Write a Projections extractor in Python without handling its protocol.

    from projections import request, result

    entities = {}
    for name in sorted(os.listdir(request.root)):
        entities[f"directory:{name}"] = {"kind": "directory", "label": name}
    result(entities=entities)

`request` is the extractor request, read from stdin the first time it is used,
with accessors for what extractors usually read. `result()` writes the
extraction to stdout: entities and relationships, as lists or as dicts keyed by
ID, in order of ID, with the protocol's fields filled in.

Projections puts this module on PYTHONPATH when it runs a custom extractor, so
there is nothing to install; `projections __python-path` prints its directory,
to run an extractor by hand. Underneath, an extractor reads one JSON request on
stdin and writes one JSON extraction on stdout, which any language can do
without it (docs/contracts/extractors.md). Python 3.9 or later; standard library
only.
"""

import json
import os
import sys
from collections.abc import Iterable, Mapping

__all__ = ["DEFAULT_SCHEMA", "PROTOCOL_VERSION", "Request", "extraction", "read_request", "request", "result"]

#: The extractor protocol's version, of requests and extractions.
PROTOCOL_VERSION = 0
#: The domain schema `result()` writes unless told otherwise: the general one.
DEFAULT_SCHEMA = "graph/v0"

# An extraction's optional fields, besides its entities and relationships.
_OPTIONAL = ("metadata", "missingInputs", "vocabularies", "volatile")
_PYTHONIC = {"missing_inputs": "missingInputs"}
_REQUIRED = {
    "entities": (("kind", "label"), "entity"),
    "relationships": (("kind", "from", "to"), "relationship"),
}


class Request(dict):
    """The extractor request: the protocol's JSON object, as a dict, with accessors.

    `request["repository"]["root"]` and the rest of the protocol still work.
    """

    @property
    def repository(self):
        """`repository`: where the examined revision is and what it is."""
        return self.get("repository") or {}

    @property
    def project(self):
        """The definition's project, relative to the repository's root and `/`-separated; `""` for the root."""
        return self.repository.get("project") or ""

    @property
    def repository_root(self):
        """The examined revision's root directory (`repository.root`)."""
        root = self.repository.get("root")
        if not isinstance(root, str) or not root:
            raise RuntimeError("This request has no repository.root, so the extractor can't read the examined revision")
        return root

    @property
    def root(self):
        """The project's directory in the examined revision: read its files here, and give evidence relative to it."""
        return _within(self.repository_root, self.project)

    @property
    def checkout(self):
        """The project's directory where its dependencies (a virtualenv, node_modules) are installed, or None."""
        checkout = self.repository.get("checkout")
        return _within(checkout, self.project) if isinstance(checkout, str) and checkout else None

    @property
    def id(self):
        """The projection's ID."""
        return (self.get("projection") or {}).get("id")

    @property
    def definition(self):
        """The projection's definition."""
        return (self.get("projection") or {}).get("definition") or {}

    @property
    def inputs(self):
        """The definition's `inputs`, or `{}`."""
        return self.definition.get("inputs") or {}

    @property
    def upstream(self):
        """The upstream built-in extractions the definition names, by name, or `{}`."""
        return self.get("upstream") or {}

    @property
    def trusted(self):
        """Whether the run is trusted (`--trust`)."""
        return (self.get("capabilities") or {}).get("trusted") is True


def _within(directory, project):
    return os.path.join(directory, *project.split("/")) if project else directory


# Messages name values in JSON's terms, as the JavaScript helpers' do (packages/schemas/fixtures/extractor-helpers.json).
def _quoted(value):
    try:
        return json.dumps(value, ensure_ascii=False)
    except (TypeError, ValueError):
        return repr(value)


def _described(value):
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "a boolean"
    if isinstance(value, (int, float)):
        return "a number"
    if isinstance(value, str):
        return "a string"
    if isinstance(value, (list, tuple)):
        return "an array"
    if isinstance(value, Mapping):
        return "an object"
    return _article(type(value).__name__)


def _article(noun):
    return f"an {noun}" if noun[:1].lower() in tuple("aeiou") else f"a {noun}"


def read_request(stream=None):
    """Reads the extractor request from `stream` (default: stdin) and returns it as a `Request`."""
    stream = sys.stdin if stream is None else stream
    if stream.isatty():
        raise RuntimeError(
            "No extractor request on stdin. Projections sends one when it runs this extractor "
            "(projections show -p <id> --trust); to run it by hand, pipe a request in"
        )
    data = stream.buffer.read() if hasattr(stream, "buffer") else stream.read()
    if isinstance(data, bytes):
        data = data.decode("utf-8")
    try:
        value = json.loads(data)
    except ValueError as error:
        raise ValueError(f"The extractor request on stdin is not JSON: {error}") from None
    if not isinstance(value, dict):
        raise ValueError("The extractor request on stdin is not a JSON object")
    version = value.get("protocolVersion")
    if isinstance(version, bool) or version != PROTOCOL_VERSION:
        has = f"protocolVersion {_quoted(version)}" if "protocolVersion" in value else "no protocolVersion"
        raise ValueError(
            f"The extractor request has {has}; this module speaks {PROTOCOL_VERSION}. "
            "Use the module of the Projections that runs the extractor"
        )
    return Request(value)


_request = None


def __getattr__(name):
    # `from projections import request` reads stdin then, not when the module is imported.
    global _request
    if name == "request":
        if _request is None:
            _request = read_request()
        return _request
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


def _sort_key(identifier):
    # The Engine's order: UTF-16 code units, which big-endian UTF-16 bytes compare in.
    return identifier.encode("utf-16-be", "surrogatepass")


def _items(items, field):
    required, singular = _REQUIRED[field]
    listed = []
    if isinstance(items, Mapping):
        for key, item in items.items():
            if not isinstance(item, Mapping):
                raise TypeError(f"{field}[{_quoted(key)}] is {_described(item)}, not an object")
            if "id" in item and item["id"] != key:
                raise ValueError(f"{field}[{_quoted(key)}] has the id {_quoted(item['id'])}; give it its key's, or none")
            listed.append({"id": key, **item})
    elif isinstance(items, (str, bytes)) or not isinstance(items, Iterable):
        raise TypeError(f"{field} must be an array of objects, or an object of them keyed by ID, not {_described(items)}")
    else:
        for index, item in enumerate(items):
            if not isinstance(item, Mapping):
                raise TypeError(f"{field}[{index}] is {_described(item)}, not an object")
            if "id" not in item:
                raise ValueError(f"{field}[{index}] has no id")
            listed.append(dict(item))
    for item in listed:
        identifier = item["id"]
        if not isinstance(identifier, str) or not identifier:
            raise ValueError(f"{_article(singular).capitalize()}'s id must be a nonempty string, not {_quoted(identifier)}")
        for name in required:
            if not isinstance(item.get(name), str):
                raise ValueError(f"The {singular} {_quoted(identifier)} needs {name}, a string")
    return sorted(listed, key=lambda item: _sort_key(item["id"]))


def extraction(entities=(), relationships=(), *, schema=None, **fields):
    """The extraction `result()` writes, without writing it.

    `entities` and `relationships` are lists of dicts with an `id`, or dicts of
    them keyed by ID. Every entity needs `kind` and `label`; every relationship
    `kind`, `from` and `to`. `schema` is the domain schema (default `graph/v0`).
    `fields` adds the extraction's optional `metadata`, `volatile`,
    `vocabularies` and `missingInputs` (or `missing_inputs`).
    """
    schema = DEFAULT_SCHEMA if schema is None else schema
    if not isinstance(schema, str) or "/" not in schema:
        raise ValueError(f"schema must name a domain schema, such as {_quoted(DEFAULT_SCHEMA)}, not {_quoted(schema)}")
    document = {
        "protocolVersion": PROTOCOL_VERSION,
        "schema": schema,
        "entities": _items(entities, "entities"),
        "relationships": _items(relationships, "relationships"),
    }
    seen = set()
    for item in document["entities"] + document["relationships"]:
        if item["id"] in seen:
            raise ValueError(f"Two items have the id {_quoted(item['id'])}; entities and relationships share one set of IDs")
        seen.add(item["id"])
    for name, value in fields.items():
        name = _PYTHONIC.get(name, name)
        if name not in _OPTIONAL:
            raise TypeError(
                f"An extraction has no field {_quoted(name)}; besides its entities and relationships it may have "
                + ", ".join(_OPTIONAL)
            )
        if value is not None:
            document[name] = value
    return document


_written = False


def result(entities=(), relationships=(), *, schema=None, **fields):
    """Writes the extraction to stdout and returns it. Call it once, with everything; see `extraction()`."""
    global _written
    if _written:
        raise RuntimeError("result() already wrote this extractor's extraction; call it once, with everything")
    document = extraction(entities, relationships, schema=schema, **fields)
    text = _json(document)
    sys.stdout.flush()
    buffer = getattr(sys.stdout, "buffer", None)
    if buffer is not None:
        buffer.write(text.encode("utf-8"))
        buffer.flush()
    else:
        sys.stdout.write(text)
        sys.stdout.flush()
    _written = True
    return document


def _json(document):
    def encode(value):
        return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))

    advice = "use dicts, lists, strings, finite numbers, booleans and None"
    try:
        return encode(document)
    except (TypeError, ValueError) as error:
        # Name the item whose value JSON can't hold.
        for item in document["entities"] + document["relationships"]:
            try:
                encode(item)
            except (TypeError, ValueError):
                raise ValueError(f"The item {_quoted(item['id'])} holds a value JSON can't represent ({error}); {advice}") from None
        raise ValueError(f"The extraction holds a value JSON can't represent ({error}); {advice}") from None
