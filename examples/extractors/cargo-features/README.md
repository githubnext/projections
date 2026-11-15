---
description: "An example extractor written in Rust with the extractor SDK: each workspace crate's Cargo features"
---

# Cargo features

A custom extractor written in Rust with the
[extractor SDK](../../../packages/extractors/sdk/README.md), the same library
every built-in extractor uses. It maps the Cargo features each crate in the
revision declares, which features they enable, across crates too, and the
optional dependencies they activate, as a `graph/v0` extraction. It reads only
manifests: it runs no tools.

```sh
cargo build --release -p projections-example-cargo-features
```

```json
{
  "id": "features",
  "title": "Cargo features",
  "extractor": {
    "command": ["target/release/cargo-features"],
    "sources": ["examples/extractors/cargo-features"]
  },
  "renderer": "graph"
}
```

`cargo test -p projections-example-cargo-features` runs it as the runner does.
