"""Tests of the `projections` Python module: python3 -m unittest discover -s packages/cli/python/tests."""

import contextlib
import io
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import projections  # noqa: E402
from projections import extraction, read_request  # noqa: E402

REQUEST = {
    "protocolVersion": 0,
    "projection": {"id": "flags", "definition": {"id": "flags", "inputs": {"file": "flags.yaml"}}},
    "repository": {"mode": "in-place", "root": "/work/repo", "project": "services/api", "checkout": "/work/checkout"},
    "capabilities": {"trusted": True, "network": False},
}


class Stdout(io.StringIO):
    """A text stdout with the binary buffer `result()` writes to."""

    def __init__(self):
        super().__init__()
        self.buffer = io.BytesIO()


@contextlib.contextmanager
def fresh_result():
    projections._written = False
    stdout = Stdout()
    with contextlib.redirect_stdout(stdout):
        yield stdout
    projections._written = False


class RequestTest(unittest.TestCase):
    def test_reads_the_request_and_names_the_projects_directories(self):
        request = read_request(io.StringIO(json.dumps(REQUEST)))
        self.assertEqual(request.root, os.path.join("/work/repo", "services", "api"))
        self.assertEqual(request.repository_root, "/work/repo")
        self.assertEqual(request.project, "services/api")
        self.assertEqual(request.checkout, os.path.join("/work/checkout", "services", "api"))
        self.assertEqual((request.id, request.inputs, request.upstream, request.trusted), ("flags", {"file": "flags.yaml"}, {}, True))
        self.assertEqual(request["repository"]["root"], "/work/repo", "it is still the protocol's dict")

    def test_the_repository_root_is_the_root_without_a_project(self):
        request = read_request(io.StringIO(json.dumps({**REQUEST, "repository": {"root": "/work/repo"}})))
        self.assertEqual((request.root, request.project, request.checkout), ("/work/repo", "", None))

    def test_refuses_what_is_not_a_request(self):
        for text, message in [
            ("", "not JSON"),
            ("[]", "not a JSON object"),
            ('{"protocolVersion": 1}', "protocolVersion 1"),
            ('{"protocolVersion": false}', "protocolVersion false"),
            ("{}", "no protocolVersion"),
        ]:
            with self.subTest(text=text), self.assertRaisesRegex(ValueError, message):
                read_request(io.StringIO(text))

    def test_importing_the_module_reads_nothing(self):
        self.assertIsNone(projections._request)


class ExtractionTest(unittest.TestCase):
    def test_fills_in_the_protocol_and_sorts_by_id(self):
        document = extraction(
            entities={"team:b": {"kind": "team", "label": "B"}, "team:a": {"id": "team:a", "kind": "team", "label": "A"}},
            relationships=[{"id": "owns", "kind": "owns", "from": "team:a", "to": "team:b"}],
        )
        self.assertEqual(document["protocolVersion"], 0)
        self.assertEqual(document["schema"], "graph/v0")
        self.assertEqual([item["id"] for item in document["entities"]], ["team:a", "team:b"])
        self.assertEqual(document["entities"][1], {"id": "team:b", "kind": "team", "label": "B"})
        self.assertEqual(document["relationships"][0]["from"], "team:a")

    def test_sorts_in_utf16_order_as_the_engine_does(self):
        # U+FF5E sorts after U+1F600 by code point, before it by UTF-16 code unit.
        ids = ["\U0001F600", "\uFF5E", "a"]
        document = extraction(entities=[{"id": id, "kind": "k", "label": id} for id in ids])
        self.assertEqual([item["id"] for item in document["entities"]], ["a", "\U0001F600", "\uFF5E"])

    def test_takes_a_schema_and_optional_fields(self):
        document = extraction(schema="architecture/v0", metadata={"authority": "declared"}, missing_inputs=["a.yaml"], volatile=None)
        self.assertEqual(document["schema"], "architecture/v0")
        self.assertEqual(document["metadata"], {"authority": "declared"})
        self.assertEqual(document["missingInputs"], ["a.yaml"])
        self.assertNotIn("volatile", document)
        self.assertEqual((document["entities"], document["relationships"]), ([], []))

    def test_explains_what_is_wrong(self):
        entity = {"id": "a", "kind": "k", "label": "A"}
        for call, error, message in [
            (lambda: extraction(entities="a"), TypeError, "array of objects"),
            (lambda: extraction(entities=[["a"]]), TypeError, r"entities\[0\] is an array, not an object"),
            (lambda: extraction(entities=[{"kind": "k"}]), ValueError, r"entities\[0\] has no id"),
            (lambda: extraction(entities={"a": {"id": "b", "kind": "k", "label": "A"}}), ValueError, 'has the id "b"'),
            (lambda: extraction(entities=[{"id": "", "kind": "k", "label": "A"}]), ValueError, "nonempty string"),
            (lambda: extraction(entities=[{"id": "a", "kind": "k"}]), ValueError, 'entity "a" needs label'),
            (lambda: extraction(relationships=[{"id": "r", "kind": "k", "from": "a"}]), ValueError, 'relationship "r" needs to'),
            (lambda: extraction(entities=[entity], relationships=[{**entity, "from": "a", "to": "a"}]), ValueError, "Two items"),
            (lambda: extraction(schema="graph"), ValueError, "domain schema"),
            (lambda: extraction(colour="red"), TypeError, 'no field "colour"'),
        ]:
            with self.subTest(message=message), self.assertRaisesRegex(error, message):
                call()

    def test_leaves_the_callers_items_alone(self):
        entities = {"a": {"kind": "k", "label": "A"}}
        extraction(entities=entities)
        self.assertEqual(entities, {"a": {"kind": "k", "label": "A"}})


class ResultTest(unittest.TestCase):
    def test_writes_one_extraction_to_stdout(self):
        with fresh_result() as stdout:
            returned = projections.result(entities=[{"id": "a", "kind": "k", "label": "é", "data": {"n": 1}}])
        written = json.loads(stdout.buffer.getvalue().decode("utf-8"))
        self.assertEqual(written, returned)
        self.assertEqual(written["entities"][0]["label"], "é")

    def test_writes_only_once(self):
        with fresh_result():
            projections.result()
            with self.assertRaisesRegex(RuntimeError, "call it once"):
                projections.result()

    def test_names_the_item_json_cannot_hold(self):
        for value, message in [({1, 2}, "set"), (float("nan"), "Out of range")]:
            with self.subTest(message=message), fresh_result() as stdout, self.assertRaisesRegex(ValueError, f'"b".*{message}'):
                projections.result(entities=[{"id": "a", "kind": "k", "label": "A"}, {"id": "b", "kind": "k", "label": "B", "data": {"v": value}}])
            self.assertEqual(stdout.buffer.getvalue(), b"", "nothing is written")


if __name__ == "__main__":
    unittest.main()
