# Runs one case of packages/schemas/fixtures/extractor-helpers.json (its JSON is the argument) through the
# `projections` Python module, as an extractor imports it: the accessors' values or the extraction on stdout, or
# `error: <message>` on stderr. extractor-helpers.test.mjs runs it with the module on PYTHONPATH.
import json
import re
import sys

case = json.loads(sys.argv[1])
try:
    import projections

    if "accessors" in case:
        values = {name: getattr(projections.request, re.sub("([A-Z])", r"_\1", name).lower()) for name in case["accessors"]}
        sys.stdout.write(json.dumps(values, ensure_ascii=False))
    else:
        projections.result(**case["result"])
except Exception as error:
    sys.stderr.write(f"error: {error}\n")
    sys.exit(1)
