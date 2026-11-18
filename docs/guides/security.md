# Security architecture

Projections shows how code changes, so it handles code you haven't reviewed yet:
a pull request's head. Its security model rests on one rule. **Code from the
revision you review runs freely; code that only a pull request's head supplies
runs only when you explicitly trust it.** Six layers enforce it, from where an
extractor runs to the page that shows the result.

## Threat model

We assume an adversary who controls a pull request's head: its source, its
projection definitions, its extractor programs and its renderer bundles. They
may try to:

- run their code on your machine or in your CI, with your credentials;
- change how their own change is explained, so a reviewer misses it;
- read private data through a renderer and send it elsewhere;
- make a hosted view show projections CI didn't produce, or run their code
  there.

We trust GitHub, the Actions runner, your browser, and the toolchains you
install yourself. Code you explicitly trust runs with whatever permissions you
give it: trust is the boundary, not a sandbox.

## Layer 1: Extractors run in your CI, with your toolchain

An extractor runs where you run Projections: the CLI on your machine, or the
GitHub Action in your repository's own workflow. It uses the toolchain your
project already has, never one Projections installs, and a hosted view never
runs it.

Each run is supervised. The extractor gets an exact Git revision materialized
into a disposable directory, never your checkout. It's started from an argv,
never a shell, with only `PATH`, a fixed locale and time zone, and the
environment variables its definition names: no `HOME`, tokens or proxies unless
declared. It and every tool it starts are stopped together at its timeout (at
most 300 seconds), and its output is bounded. For stronger isolation, run
extractors in a pinned container image with no network, a read-only filesystem
and dropped capabilities.

Learn more: [the extractor process](../contracts/extractors.md#process) and
[container isolation](../runner/environments.md#optional-container-isolation).

## Layer 2: Head code runs only with explicit trust

Built-in extractors that only read files always run: their code ships with the
executable, not your repository. A custom extractor, or a built-in one that runs
your toolchain, runs repository code, so it runs only with `--trust` (in the
Action, `trust: true`), which covers both revisions of a comparison.

A comparison explains both revisions with one definition, by default the base
revision's, so a pull request's author can't change how their own change is
explained. A custom renderer is repository code too, so it needs the same trust
unless it is byte-identical to the default branch's (Layer 4). `projections pr`
reviews someone else's pull request with no way to grant trust at all.

When you do trust a pull request's head in CI, use the plain `pull_request`
event (never `pull_request_target`), no secrets, read-only permissions and
`persist-credentials: false`: the conditions GitHub already applies to pull
requests from forks.

Learn more: [trust](how-it-works.md#trust),
[the trust contract](../contracts.md#trust) and
[trust in the Action](../setup/ci.md#trust).

## Layer 3: Comparators are data, interpreted in a sandbox

A comparator relates two extractions. A custom comparator is a **comparator
file** (`<name>.comparator.yaml`): YAML declarations and CEL expressions, data
rather than code. The rules interpreter checks it when it loads and evaluates it
under a deterministic cost budget; CEL has no files, network, clock, randomness
or unbounded loops, so a comparator file can only compute a comparison from the
two extractions it's given. They never need trust, and because they are
deterministic, anyone can rerun them to check a saved comparison.

The interpreter itself (`rules.wasm`, a WebAssembly module with zero imports)
always runs sandboxed, as defence in depth against bugs in the interpreter or
the CEL implementation it's built on:

- CLI, and servers (`projections-rules`, one process per check or comparison):
  [wasmi](https://github.com/wasmi-labs/wasmi), a WebAssembly interpreter.
  Bounds: Fuel (10¹² units), a 256 MiB memory cap, zero imports; a server should
  also kill the process at a deadline.
- Browsers (the Inspector, views you host): A dedicated Web Worker running the
  module with the browser's WebAssembly engine, created for one check or
  comparison and terminated after it. Bounds: A wall-clock deadline (30 s by
  default) and a 256 MiB memory cap. The module has zero imports, so it can't
  reach the network, the DOM or storage; the Worker shares no memory with the
  page and receives only the comparator file and the two extractions.

Comparator files are the only custom comparators: no host runs a comparator
module or JavaScript a repository supplies. The default comparator,
`default-comparator.wasm`, runs in the same sandbox.

Learn more: [comparator files](../contracts/comparisons.md#comparator-files) and
[custom comparators](../design/declarative-comparators.md#determinism-termination-and-cost).

## Layer 4: Renderers run in sandboxed frames

A renderer is a web page in a frame with `sandbox="allow-scripts"` and a content
security policy that grants no origin and `connect-src 'none'`. It receives one
extraction or comparison and draws it; it can't read files, call an API or fetch
anything. Browsers can't stop a sandboxed frame from navigating itself, which
could carry the data it was given away, so which renderer runs is a trust
decision. A custom renderer bundle is repository code, so it runs only with
`--trust` (in VS Code, a trusted workspace; in the Action, `trust: true`), like
a custom extractor. The one exception is a bundle byte-identical to the one the
projection declares at the revision's merge base with the repository's default
branch (`refs/remotes/origin/HEAD`): the repository's maintainers merged it, and
what it receives is derived from the same repository. Checking out a pull
request leaves the default branch where it was, so a renderer the pull request
adds or changes still needs trust. Without trust, viewers see the built-in
renderer for the extraction's schema, with a notice; `check` reports the
renderer checks as needing `--trust`.

Learn more: [the renderer frame protocol](../contracts/renderer-frames.md).

## Layer 5: Artifacts are verified before they're shown

The Action uploads a manifest that names the repository, run and commits, and
lists every document with its SHA-256. Before a hosted view shows anything, it
confirms with GitHub that the artifact belongs to the latest successful run for
the exact head commit, in the same repository, and that GitHub's merge base
matches. It checks every file's digest, recomputes every extraction's digest and
reruns every saved comparison: with the default comparator, or with the
comparator file the definition names. A comparator file is never taken from the
artifact: the view fetches it from the repository at the pull request's merge
base and head, and the version whose digest the comparison records must
reproduce it. The **base** revision's comparator judges a pull request, so a
pull request can't change how it is judged; when it changes the comparator file,
the view says so and shows the head's comparison only on request. A mismatch in
the manifest or archive rejects the whole artifact. A document that fails its
own checks isn't shown, and only its projection is marked as failing
verification; the others are verified independently.

Learn more: [CI artifacts](../contracts/saved-documents.md#ci-artifacts).

## Layer 6: Nothing from your repository runs in a hosted view

A hosted view never runs extractors or repository code (comparator files are
data, which it interprets in the sandbox above), never collects anything on
demand and accepts no uploads. It never loads a renderer an artifact names;
those projections use the built-in renderer for their schema. It reads with the
viewer's own read-only GitHub access, so it shows a repository only to people
who can read it, and checks that again on every read.

Hosted views are separate services built on the published
[CI artifact contract](../contracts/saved-documents.md#ci-artifacts); none is
part of this repository.

## Your responsibilities

Each layer leaves some decisions to the people who author projections and
operate the workflows and hosts that run them:

<!-- prettier-ignore -->
| Surface | Author and operator responsibility |
|---|---|
| Extractor toolchain | Projections uses the toolchain on `PATH` and never installs or pins one. Pin and review it as you would for a build, declare only the environment variables an extractor needs, and use [container isolation](../runner/environments.md#optional-container-isolation) for code you haven't reviewed. |
| Trust for head code | Grant `--trust`, or `trust: true` in the Action, only for code you've reviewed, or in a workflow on the plain `pull_request` event with no secrets, read-only permissions and `persist-credentials: false`. |
| Comparators | Review changes to comparator files like any other pull request change: they decide how changes are classified. The comparator file always belongs to the definition's digest, and a hosted view judges a pull request by the base revision's comparator. |
| Renderer sandbox | If you [embed Projections in your app](embedding.md#embedding-projections-in-your-own-app), serve renderer bundles with [the renderer response headers](host.md#serving-renderer-bundles) and never relax the frame's sandbox or content security policy. Load a repository's custom renderers only with its trust, as the CLI does. |
| Artifact digests | Don't add files to or change a `projections` artifact after the Action uploads it: a file the manifest doesn't list rejects it, and a changed document fails verification. A viewer you build should verify documents with the Engine's loader. |
| Hosted views | Give a hosted view access only to repositories whose projections the people who can read them should see. Artifacts expire with your repository's retention settings. |
| Agent viewer link | The viewer answers only on loopback, behind a token in its URL that survives restarts ([agent viewer](../design/agent-viewer.md)). Treat the URL as a secret: anyone on this computer who has it can watch the repository's projections. Rotate it with `projections view stop --rotate` once it has been shared. |

## Component overview

```text
  pull request head ──▶ your CI runner (the Projections Action)
                          ├─ extractors: your toolchain; head code only with trust  Layers 1, 2
                          └─ comparator files: interpreted in a wasmi sandbox       Layer 3
                                   │
                                   ▼
                        projections artifact: manifest, documents, SHA-256 each
                                   │
                                   ▼
                        a hosted view
                          ├─ verifies run, commits, digests and comparisons         Layer 5
                          ├─ runs no repository code                                Layer 6
                          └─ built-in renderers in sandboxed frames                 Layer 4
```
