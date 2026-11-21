# Security architecture

Because Projections visualizes code changes, it regularly deals with code you
haven't reviewed yet—namely, a pull request's head. Its security model comes
down to a single rule: **code from the revision you review runs freely; code
that only a pull request's head supplies runs only when you explicitly trust
it.** Six layers enforce that boundary, from where an extractor executes all the
way to the page that displays the result.

## Threat model

We assume an adversary controls a pull request's head, including its source
code, projection definitions, extractor programs, and renderer bundles. They may
try to:

- Run their own code on your machine or in your CI with access to your
  credentials.
- Manipulate how their changes are explained so a reviewer overlooks something
  important.
- Exfiltrate private repository data through a custom renderer.
- Trick a hosted view into displaying projections CI never produced, or running
  their code inside the view.

We trust GitHub, the Actions runner, your browser, and the toolchains you
install yourself. Code you explicitly trust runs with whatever permissions you
give it—trust is the security boundary, not a sandbox.

## Layer 1: Extractors run in your CI, with your toolchain

Extractors only ever run where you run Projections: locally through the CLI, or
in your repository's own workflow via the GitHub Action. They use the toolchain
your project already provides, never one Projections installs, and a hosted view
never runs them.

Every extractor run is closely supervised. Projections materializes the exact
Git revision into a disposable directory rather than touching your checkout. It
launches the extractor directly from an argv array—never through a shell—with
only `PATH`, a fixed locale and time zone, and the environment variables
explicitly named in its definition. No `HOME`, tokens, or proxies are passed
through unless declared.

The extractor and every child process it spawns are terminated together if it
hits its timeout (at most 300 seconds), and its output size is capped. When you
want stronger isolation, you can run extractors inside a pinned container image
with no network access, a read-only filesystem, and dropped capabilities.

Learn more: [the extractor process](../contracts/extractors.md#process) and
[container isolation](../runner/environments.md#optional-container-isolation).

## Layer 2: Head code runs only with explicit trust

Built-in extractors that only read files always run freely because their code
ships inside the Projections executable, not in your repository. By contrast, a
custom extractor—or a built-in extractor that invokes your project's toolchain—
executes repository code, so it only runs when you pass `--trust` (or
`trust: true` in the Action). That trust covers both revisions in a comparison.

A comparison evaluates both revisions using one definition, defaulting to the
base revision's, so a pull request author can't rewrite how their own diff is
explained. Custom renderers count as repository code too and require the same
trust unless they are byte-identical to the default branch's bundle (Layer 4).
For extra safety when reviewing someone else's PR locally, `projections pr`
offers no way to grant trust at all.

When you do trust a pull request's head in CI, trigger the workflow on the plain
`pull_request` event (never `pull_request_target`) with no secrets, read-only
permissions, and `persist-credentials: false`—the same restrictions GitHub
already applies to pull requests from forks.

Learn more: [trust](how-it-works.md#trust),
[the trust contract](../contracts.md#trust) and
[trust in the Action](../setup/ci.md#trust).

## Layer 3: Comparators are data, interpreted in a sandbox

A comparator relates two extractions. Rather than running arbitrary code, a
custom comparator is a **comparator file** (`<name>.comparator.yaml`) made of
YAML declarations and CEL expressions. The rules interpreter validates it on
load and evaluates it under a deterministic cost budget. Because CEL has no
filesystem access, network, clock, randomness, or unbounded loops, a comparator
file can only compute a comparison from the two extractions it receives. It
never needs trust, and because it is deterministic, anyone can rerun it to
verify a saved comparison.

As defence in depth against bugs in the interpreter or its underlying CEL
implementation, the interpreter itself (`rules.wasm`, a WebAssembly module with
zero imports) always runs inside a sandbox:

- **In the CLI and on servers** (`projections-rules`, one process per check or
  comparison), it runs in [wasmi](https://github.com/wasmi-labs/wasmi), a
  WebAssembly interpreter capped at 10¹² fuel units, 256 MiB of memory, and zero
  imports. Servers should also enforce a process deadline.
- **In browsers** (the Inspector and self-hosted views), it runs inside a
  dedicated Web Worker using the browser's WebAssembly engine, created for a
  single check or comparison and terminated immediately afterward. It is bounded
  by a wall-clock deadline (30 s by default) and a 256 MiB memory cap. With zero
  imports, the module can't touch the network, the DOM, or storage, and the
  Worker shares no memory with the page—it only receives the comparator file and
  the two extractions.

Comparator files are the only supported form of custom comparator; no host runs
repository-supplied comparator modules or JavaScript. The built-in default
comparator, `default-comparator.wasm`, runs in the exact same sandbox.

Learn more: [comparator files](../contracts/comparisons.md#comparator-files) and
[custom comparators](../design/declarative-comparators.md#determinism-termination-and-cost).

## Layer 4: Renderers run in sandboxed frames

Every renderer is a web page loaded inside an iframe with
`sandbox="allow-scripts"` and a content security policy that grants no origin
and sets `connect-src 'none'`. It receives a single extraction or comparison to
draw, and it can't read local files, call APIs, or fetch network resources.

Even so, browsers can't stop a sandboxed frame from navigating itself, which
could leak the extraction data it was handed. That makes choosing which renderer
to run a trust decision. A custom renderer bundle is treated as repository code
and requires `--trust` (a trusted workspace in VS Code, or `trust: true` in the
Action), just like a custom extractor.

The one exception is a bundle byte-identical to what the projection declares at
the revision's merge base with the default branch (`refs/remotes/origin/HEAD`).
Maintainers already merged that bundle, and it only sees data derived from the
same repository. Checking out a pull request doesn't move the default branch, so
any renderer added or modified in a PR still needs explicit trust. Without
trust, viewers fall back to the built-in renderer for the extraction's schema
with a notice, and `check` reports that the renderer checks need `--trust`.

Learn more: [the renderer frame protocol](../contracts/renderer-frames.md).

## Layer 5: Artifacts are verified before they're shown

When the Action uploads projections, it includes a manifest naming the
repository, workflow run, and commits, along with a SHA-256 digest for every
document. Before displaying anything, a hosted view confirms with GitHub that
the artifact came from the latest successful run for that exact head commit in
the same repository, and that GitHub's merge base matches.

Next, the view checks every file's digest, recomputes every extraction's digest,
and reruns every saved comparison using either the default comparator or the
comparator file named in the definition. It never trusts a comparator file from
the artifact itself; instead, it fetches the file directly from the repository
at the pull request's merge base and head, requiring the version matching the
comparison's recorded digest to reproduce the result. Because the **base**
revision's comparator judges the pull request, an author can't alter how their
own PR is judged. If the PR edits the comparator file, the view notes that and
shows the head's comparison only on request. Any mismatch in the manifest or
archive rejects the entire artifact, while a single document that fails its own
checks is withheld and only its projection is marked as failing verification.

Locally, the CLI applies the same digest, commit, and definition checks before
reusing CI extractions, and marks an extraction as official only when it is
authenticated as the repository's own CI output. Passing `--ci` downloads only
from a successful run of this repository's Projections workflow for a push or a
same-repository pull request—never from a fork PR, since a fork runs its own
workflow files and could upload arbitrary artifacts. Similarly, importing a
local artifact directory with `--artifact DIR` marks it official only if its
attestation verifies and points to such a run; otherwise it is labelled
imported.

Learn more: [CI artifacts](../contracts/saved-documents.md#ci-artifacts) and
[CI artifacts as a source](../runner/caches.md#ci-artifacts-as-a-source).

## Layer 6: Nothing from your repository runs in a hosted view

A hosted view never runs extractors or repository code (remember, comparator
files are data interpreted inside the sandbox above). It never collects
extractions on demand, accepts no uploads, and never loads custom renderers
named in an artifact—those projections always use the built-in renderer for
their schema. Every read uses the viewer's own read-only GitHub permissions and
re-checks access on each request, so a repository's projections are only visible
to people who can already read that repository.

Hosted views are separate services built on the published
[CI artifact contract](../contracts/saved-documents.md#ci-artifacts); none is
part of this repository.

## Your responsibilities

Each layer still leaves a few operational decisions to the people who author
projections and run workflows or hosts:

<!-- prettier-ignore -->
| Surface | Author and operator responsibility |
|---|---|
| Extractor toolchain | Projections uses whatever toolchain is on `PATH` and never installs or pins one. Pin and review it as you would for a build, declare only the environment variables an extractor needs, and use [container isolation](../runner/environments.md#optional-container-isolation) for code you haven't reviewed. |
| Trust for head code | Grant `--trust` (or `trust: true` in the Action) only for code you've reviewed, or inside a workflow triggered by the plain `pull_request` event with no secrets, read-only permissions, and `persist-credentials: false`. |
| Comparators | Review comparator file edits like any other pull request change, since they control how diffs are classified. The comparator file is part of the definition's digest, and hosted views always judge a PR with the base revision's comparator. |
| Renderer sandbox | If you [embed Projections in your app](embedding.md#embedding-projections-in-your-own-app), serve renderer bundles with [the renderer response headers](host.md#serving-renderer-bundles) and never weaken the frame's sandbox or content security policy. Load custom renderers only when the repository is trusted, matching the CLI. |
| Artifact digests | Don't add or edit files inside a `projections` artifact after the Action uploads it—an unlisted file rejects the whole artifact, and a modified document fails verification. Any custom viewer you build should verify documents with the Engine's loader. |
| Hosted views | Grant a hosted view access only to repositories whose projections readers should be able to view. Artifacts expire according to your repository's retention settings. |
| Agent viewer link | The viewer listens only on loopback behind a URL token that survives restarts ([agent viewer](../design/agent-viewer.md)). Treat that URL like a secret, since anyone on the same machine who has it can watch the repository's projections. Once shared, rotate it with `projections view stop --rotate`. |

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
