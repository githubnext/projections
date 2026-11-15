---
description: The Rust library for writing extractors
---

# Extractor SDK

`projections-extractor-sdk` is the Rust library for writing a Projections
[extractor](../../../docs/contracts/extractors.md): a process that reads one
extractor request on stdin and writes one extraction on stdout. Every built-in
extractor is written with it and depends on nothing else from Projections, so
the built-ins use exactly what a third-party extractor can. No SDK is required:
an extractor can be written in any language.

## Write an extractor in Rust

```toml
[dependencies]
anyhow = "1"
# Not on crates.io; pin the release you use.
projections-extractor-sdk = { git = "https://github.com/githubnext/projections", tag = "v0.1.0" }
serde_json = "1"
```

```rust
use projections_extractor_sdk::{Context, extraction, key, read_source, relationship};
use serde_json::json;

fn main() -> std::process::ExitCode {
    projections_extractor_sdk::main("flags", |cx: &Context| {
        let mut entities = vec![];
        let mut relationships = vec![];
        for file in cx.files()?.iter().filter(|file| file.ends_with("flags.txt")) {
            let owner = format!("file:{file}");
            entities.push(json!({"id": owner, "kind": "file", "label": file}));
            for flag in read_source(cx.root(), file)?.lines().filter(|line| !line.is_empty()) {
                let id = key(&["flag", flag]);
                entities.push(json!({"id": id, "kind": "flag", "label": flag}));
                relationships.push(relationship("declares", &owner, &id));
            }
        }
        Ok(extraction("graph/v0", entities, relationships, None))
    })
}
```

Build it and name the executable in a projection definition, with its sources so
a change to it is recognized:

```json
{
  "id": "flags",
  "extractor": {"command": ["target/release/flags"], "sources": ["tools/flags"]},
  "renderer": "graph"
}
```

[`cargo-features`](../../../examples/extractors/cargo-features) is a complete
example with tests.

## What it provides

- `main` and `serve` run the extractor process: read the request, call your
  function, write its extraction, or its error first and then diagnostics on
  stderr with a nonzero exit.
- `Context`, one invocation built from the request and this process:
  - `files()`, `entry(path)`, `is_dir(path)`, `read_source(path)`,
    `read_bytes(path, max)` and `read_json(path)`: the examined revision's files
    in Git's order and their contents, however the runner gives them (see
    below); and `definition()`, with its `inputs`;
  - `root()` and `directory()`: the directory holding the revision, for tools
    that read it themselves; `mode()` says which (`in-place`, `materialized`,
    `workspace` or `git-objects`, which has no directory);
  - `exists(path)` and `input_exists(path)`: whether a file or folder is part of
    the revision; `input_exists` records a declared input the revision lacks
    (and `missing_input(glob)` one that matches nothing), which `serve` writes
    to the extraction's `missingInputs`, so a revision from before the input was
    added extracts as empty rather than failing;
  - `scope()`: the scope the runner enforces, if any;
  - `checkout()`: where the project's installed packages are for this run
    (absent under container isolation and for Git objects);
  - `trusted()` and `require_trust()`: call `require_trust` immediately before
    running ecosystem tools or repository code;
  - `environment(names)`: the base tool environment plus the named variables
    this process received, which are exactly the ones the definition grants
    through `execution.environment`;
  - `run(cwd, argv, stdin, environment)`: runs a tool as a child process, which
    stays in the runner's supervision, and records its stderr as a diagnostic;
  - `helper(installed, source)`: your executable's own helper files, from the
    directory you configure with `with_helpers` or their source location.
- `execute` and `run` run a tool with the base environment and the granted
  variables, after checking trust.
- `path`, `read_source`, `read_json` and `read_file`: repository-contained paths
  that never traverse symlinks, and bounded reads. JSON is parsed by the
  Engine's strict parser, which rejects duplicate keys and unsafe numbers.
- `extraction`, `relationship`, `key`, `stable`, `exported` and friends: build
  extractions with stable, escaped identities.
- `Scratch`: a private build directory inside the examined revision.
- With the `testing` feature, `testing::context` and `testing::trusted` build a
  context for a directory without a runner, and `golden` compares JSON with a
  golden file. `Context::with_tools`, `with_environment` and `with_files`
  substitute tools, variables and files.

`Descriptor`, `Trust`, `Access` and `Determinism` describe a built-in extractor
in the `projections catalog`; other extractors don't need them.

## Correct in place

The runner reads the working tree, and a commit that is the clean `HEAD`, in
place: `root()` is then the user's checkout, which also holds ignored files
(`node_modules`, build output, editor files). Read the revision through the
context: `files()` lists what Git lists (tracked files and untracked ones it
doesn't ignore), and `read_source` refuses anything else, naming the path, so an
extraction depends only on the revision. Don't walk `root()` yourself, and write
only ignored scratch or build output there (`Scratch` is removed on drop).

An extractor that only reads files this way can declare `access: Access::Files`.
The runner then reads commits straight from Git's object store with nothing on
disk, which is much faster on large repositories; `root()` is unavailable (it
panics, naming the extractor) and the context reads blobs with one
`git cat-file --batch` process. When the runner enforces a scope, files outside
it aren't listed and reading one fails, naming it. Tools that read the checkout
themselves need `Access::Checkout`.

Extractors should be deterministic: the same revision should give the same
extraction. Prefer sources that are, such as the project's compiler or
lockfiles, over timing or profiling data.
