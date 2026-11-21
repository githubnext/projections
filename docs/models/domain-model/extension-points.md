# Extension points

This page is part of the [domain model](../domain-model.md). It explains which
pieces of a projection teams can replace and the rules every component follows.

You can swap out none, some, or all of a projection's three components. All
three are first-class extension points with documentation, schemas, Inspector
support, and compatibility guarantees, though in practice teams reach for them
at very different rates.

<!-- prettier-ignore -->
| Component | Expected use | Typical reason to replace it | Runs in |
|---|---|---|---|
| Extractor | **Most common** | Projections doesn't understand a concept in the codebase | The runner, as a process using the project's own toolchain |
| Renderer | **Somewhat common** | A different presentation is needed | A sandboxed browser frame |
| Comparator | **Relatively uncommon** | Default matching, interpretation or ordering doesn't explain changes well | Comparator rules: a YAML file of CEL expressions, run by the sandboxed rules interpreter in the CLI, the Inspector, browsers and hosted views |

That frequency shapes where we invest. Extractor authoring gets the most
examples, templates, and Inspector support. For comparisons, we give the default
comparator configuration options for common needs so you only have to write
custom rules for genuinely domain-specific logic — though custom comparators are
still first-class.

Because components talk to each other only through the extraction and comparison
schemas, they can be swapped independently. A generic `dag` renderer can display
a comparison whose step order came from domain rules it knows nothing about, and
a comparator never needs to know which renderer will show its output. Each
component declares the domain schemas it reads or writes so the runner can catch
mismatches up front.

Configuration always comes before code. Common needs, like sorting by a
property, belong as options on built-in components; custom programs are for
logic that is truly specific to your domain.

## First-party components get no privileges

**Every built-in extractor, comparator, and renderer uses the exact same public
contract as a third-party one.** Built-ins serve as proof that each extension
point is complete — giving them shortcuts would only hide gaps that third-party
authors would later run into.

<!-- prettier-ignore -->
| Component | Built-ins run as | Through |
|---|---|---|
| Extractor | A process, `projections __extract <id>`, reading the public request on stdin and writing one extraction | The custom-extractor path: the same supervision, environment allowlist, timeout, output limits, trust gating, decoding and provenance. A definition can run a built-in as a custom command and gets the same extraction |
| Comparator | `default-comparator.wasm`, a zero-import WebAssembly module | The comparator runtime, with the same limits as the rules interpreter, in the CLI as in browsers |
| Renderer | A static bundle | The same sandboxed frame, content security policy and frame protocol |

First-party code depends only on the public SDKs: the Rust
[extractor SDK](../../../packages/extractors/sdk/README.md), comparator files,
and the renderer SDK, kit, and testing package. We enforce this in CI:
`tools/scripts/check-boundaries.mjs` rejects any first-party import of runner,
CLI, host, or runtime internals. Tests also run every built-in extractor through
both paths and assert identical output, and verify that CLI and browser default
comparisons match.

The only difference between built-in and third-party components is provenance,
not capability. Because a built-in ships with the executable or host rather than
coming from the inspected repository, a built-in that doesn't execute external
tools or repo code needs no trust prompt, and a built-in renderer can act as a
schema's fallback.

This strict boundary comes with a few tradeoffs:

- **One executable.** Built-in extractors are compiled into the `projections`
  binary and spawned as subprocesses, keeping installation to a single file.
  Each extraction pays a few milliseconds of process startup, and the binary
  passes its helper location in argv just as any custom extractor can. If we
  ever want to distribute extractors separately or let users override one, the
  protocol won't have to change.
- **Interpreted comparisons.** The CLI runs the default comparator inside the
  `wasmi` interpreter, which is roughly seven times slower than linked native
  code. In practice that means milliseconds for normal comparisons and about 4.5
  seconds (versus 0.7) at the limit-sized worst case
  ([measurements](../../design/engine-evaluation.md#the-default-comparator-in-the-clis-comparator-runtime)).
- **One timeout per extractor.** A definition's `execution.timeoutMs` covers the
  extractor and every tool it invokes. Built-ins that compile or build the
  project need a larger timeout, just like custom extractors do.
- **Explicit environment allowlist.** Built-ins only see the environment
  variables the definition grants, so Go, .NET, and Spring projections still
  grant `HOME`, `JAVA_HOME`, and similar variables to reuse local caches and
  toolchains.

## Determinism and authority

Extractions behave a lot like test results. Run the same test suite on the same
commit twice and you usually — but not always — get the same answer. Teams don't
solve that by banning anything short of mathematical purity. They make tests as
deterministic as they reasonably can, catch flaky ones by rerunning them, and
treat the CI run as the official result for a commit.

An extraction is the same kind of artifact: **an observation of a revision, made
by one run in one environment**, rather than a pure mathematical value. Three
design choices follow from this.

**Authority.** A commit's official extraction is the one published by the team's
CI (the Action's artifact); local runs are clearly labeled as local. Every
extraction's `provenance.execution` records where it ran (`source`), its
environment fingerprint, when it ran (`at`), and — for CI runs — the repository
and run ID. Only runs authenticated as the repository's own CI carry
`official: true`, while unauthenticated imported artifacts are labeled imported.
Hosts show the official run by default and tag every view as _From CI_,
_Imported_, _Local_, _Approximate_, or _Stale_
([local execution](../../design/local-execution.md)).

**Determinism classes.** Each extractor declares how reproducible it is via
`execution.determinism` in the definition and `determinism` in a built-in's
descriptor. These classes describe reality rather than enforcing it:

<!-- prettier-ignore -->
| Class | Depends on | Reuse | Examples |
|---|---|---|---|
| `pure` | The revision's files | Cached by Git tree, forever; a rerun must match | Manifests, lockfiles, schemas, workflow YAML: every built-in that only reads files |
| `environmental` | Files, toolchain and installed dependencies | Cached only within the same environment fingerprint | Compiler and type-checker output, dependency-injection containers. The default for custom extractors |
| `observed` | Live or varying data | Never reused silently: always "the latest observation, from *when*" | Timings, benchmarks, coverage |

A definition using a built-in extractor can downgrade its determinism class to
something less reproducible, but never upgrade it.

**Determinism is measured, like flaky tests.** `projections check` runs each
extraction twice and compares the results. Any difference shows up as a warning
naming the exact items and fields that drifted, rather than failing outright.
Passing `--strict-determinism` turns that warning into a failure, which CI uses
for built-ins (and our own test suite holds every built-in to its declared
class). The local-vs-CI parity check (`check --parity REV`) measures stability
across environments the same way, reporting results like "varies between this
environment and CI on 12% of items". When an extractor knows certain fields
naturally vary, it can list them in its top-level `volatile` array with
tolerances so comparators treat drift within tolerance as expected variation
instead of a real change.

**Unchanged:** comparators remain strictly deterministic. Verifying a saved
comparison simply reruns the comparator over the recorded extractions without
re-extracting anything.

Determinism is still the goal — a projection loses its usefulness fast if
reviewers can't tell real changes from noise. All built-in extractors are
deterministic, and custom ones should follow the same habits:

- **Read declared or resolved structure, not observed behavior.** Manifests,
  lockfiles, compiler output, schemas, container registrations, and deployment
  plans describe what the code _is_. Profiles, traces, timings, sampled
  telemetry, benchmarks, and load-test results describe a single run and shift
  between identical runs. If you still want to project them, declare the
  extractor `observed` and mark the varying fields `volatile`.
- **Keep environment details out of the output.** Never embed clocks, random
  IDs, absolute paths, hostnames, usernames, temp directories, or process IDs in
  entity IDs or data. The runner already captures environment details in
  provenance.
- **Pin your inputs.** Favor lockfiles and resolved graphs over version ranges,
  the project's own toolchain over whatever happens to be newest, and offline
  reads over live network lookups (registries, download counts, and advisories
  drift even when the commit doesn't).
- **Sort everything consistently.** Order entities, relationships, and nested
  collections inside `data` by a stable key instead of relying on hash-map or
  filesystem iteration order.
- **Keep entity IDs independent of incidental values.** Name the thing itself (a
  package, service, or table) rather than its version or position, so an upgrade
  shows up as a modified entity instead of a removal and an addition.

We removed the built-in `timeline` renderer for exactly this reason: profiling
and trace timings mostly surfaced run-to-run noise when comparing two revisions.
Separately, `execution.reproducibility` (`hermetic`, `pinned-toolchain`,
`local`, `unknown`, `external`) still records how tightly the toolchain is
pinned, independent of the determinism class.
