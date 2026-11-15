---
description: "The Engine's decisions, which Verus proves for every input"
---

# projections-engine-verified

The Engine's formally verified decisions: which shapes a change may have and how
they mirror (`correspondence`), one-to-one key matching (`keys`), claim and
presentation groups (`components`), the canonical order (`sort`), tolerance
(`tolerance`), generated values (`generated`), residual content differences
(`content`), what "unchanged" means (`unchanged`) and how the default
comparator's steps mirror (`waves`). Each function carries a
[Verus](https://github.com/verus-lang/verus) specification that Verus proves for
every input; the Engine and the default comparator call these functions, so they
run the code that was proved. `datum` holds the data model the proofs reason
about, which the Engine re-exports.

Ordinary builds expand `verus!` with `verus_builtin_macros`, which erases the
specifications and proofs; nothing of Verus is linked, natively or as Wasm. The
crate has no other dependencies, so Verus checks it on its own. From the
repository root:

```sh
npm run tools -- verify --install
```

`verus.toml` pins the Verus release. `mutants/` plants one bug per `ensures`
clause, and the check requires Verus to reject each on its clause.

See [`packages/engine/VERIFICATION.md`](../VERIFICATION.md) for the promises,
what is proved and what is only tested, the trusted boundary and the
measurements.
