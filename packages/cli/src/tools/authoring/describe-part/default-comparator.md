The default comparator [default]: matches entities and relationships by ID (and
the definition's correspondence for renames), and groups connected changes into
steps in structural order. It runs sandboxed everywhere, so it never needs
trust.\
Options, in the definition: "comparator": {"options": {"order": {"by":
"dependents", "direction": "descending"}}} orders the steps by how many items
depend on each changed one (direction ascending or descending).\
Omit "comparator" for the default comparator without options.
