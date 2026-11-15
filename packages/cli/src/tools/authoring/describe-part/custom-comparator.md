A custom comparator [custom]: a comparator file (\<name>.comparator.yaml), YAML
declarations over the default comparator with CEL expressions, run sandboxed
(never needs trust): identity pairs renames, moves, splits and merges; classify
writes a sentence and annotations per change; steps orders and groups changes;
metadata adds verdicts and counts (such as metadata.compatibility). In the
definition: "comparator": "path/\<id>.comparator.yaml", or {"file":
"path/\<id>.comparator.yaml", "options": {...}} with options. Tests live beside
it in \<id>.comparator.test.yaml (run_comparator_tests runs them; coverage: true
reports the rules no case runs). Scaffold them with projections init \<id>
--comparator custom; the projections skill and docs/guides/comparators.md
describe the format.
