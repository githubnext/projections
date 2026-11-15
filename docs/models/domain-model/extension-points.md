# Extension points

Part of the [domain model](../domain-model.md): what customers can replace, and
the rules every component follows.

A customer can replace none, any or all of a projection's three components. All
three are fully and officially supported extension points, with documentation,
schemas, Inspector support and compatibility commitments. They differ in how
often customers are expected to need them.

<!-- prettier-ignore -->
| Component | Expected use | Typical reason to replace it | Runs in |
|---|---|---|---|
| Extractor | **Most common** | Projections doesn't understand a concept in the codebase | The runner, as a process using the project's own toolchain |
| Renderer | **Somewhat common** | A different presentation is needed | A sandboxed browser frame |
| Comparator | **Relatively uncommon** | Default matching, interpretation or ordering doesn't explain changes well | Comparator rules: a YAML file of CEL expressions, run by the sandboxed rules interpreter in the CLI, the Inspector, browsers and hosted views |

The expected frequency shapes investment. Extractor authoring gets the most
examples, templates and Inspector support. The default comparator gets
configuration options that cover common needs, so that writing a comparator is
reserved for genuinely domain-specific logic, but custom comparators are never
second-class.

Components communicate only through the extraction and comparison schemas. This
makes them independently replaceable: a generic `dag` renderer can present a
comparison whose order came from domain knowledge it doesn't have, and a
comparator doesn't need to know which renderer will present its output. Each
component declares the domain schemas it accepts or produces so the runner can
reject incompatible combinations.

Configuration comes before code. Common needs, such as ordering by a property,
are options on built-in components. Custom programs are for genuinely
domain-specific logic.

## First-party components get no privileges

**Decision: every built-in extractor, comparator and renderer uses exactly the
public contract a third party uses.** Built-ins are the proof that each
extension point is sufficient; a privilege would hide a gap that third parties
would hit.

<!-- prettier-ignore -->
| Component | Built-ins run as | Through |
|---|---|---|
| Extractor | A process, `projections __extract <id>`, reading the public request on stdin and writing one extraction | The custom-extractor path: the same supervision, environment allowlist, timeout, output limits, trust gating, decoding and provenance. A definition can run a built-in as a custom command and gets the same extraction |
| Comparator | `default-comparator.wasm`, a zero-import WebAssembly module | The comparator runtime, with the same limits as the rules interpreter, in the CLI as in browsers |
| Renderer | A static bundle | The same sandboxed frame, content security policy and frame protocol |

Built-in code uses only the public SDKs: the Rust
[extractor SDK](../../../packages/extractors/sdk/README.md), comparator files
and the renderer SDK and kit, and tests with the same renderer testing package.
`tools/scripts/check-boundaries.mjs` rejects a first-party dependency on runner,
CLI, host or runtime internals; a test runs every built-in extractor both ways
and requires identical extractions, and another requires the CLI's and the
browser's default comparisons to be identical.

What still differs is provenance, not capability. A built-in ships with the
executable or host rather than the examined repository, so running one that
executes no tools or repository code needs no trust, and a built-in renderer can
be a schema's fallback.

Tradeoffs:

- **One executable.** Built-in extractors are compiled into the `projections`
  executable and run as its own subprocesses, so installation stays one file.
  Each extraction pays a process start (a few milliseconds), and the executable
  passes its own helper location to its entrypoint in argv, as any extractor may
  with its own files. Distributing extractors separately, or letting users
  replace one, is possible later without changing the protocol.
- **Interpreted comparisons.** The CLI runs the default comparator in the
  `wasmi` interpreter, about seven times slower than linked native code: about
  4.5 seconds instead of 0.7 for the limit-sized worst case, milliseconds for
  typical comparisons
  ([measurements](../../design/engine-evaluation.md#the-default-comparator-in-the-clis-comparator-runtime)).
- **One timeout per extractor.** The definition's timeout covers the extractor
  and every tool it runs, so built-ins that build the project need a larger
  `execution.timeoutMs`, as custom extractors always did.
- **Only granted variables.** Built-ins read only the environment the definition
  grants, so Go, .NET and Spring users grant `HOME`, `JAVA_HOME` and the like to
  reuse their caches and toolchains.

## Determinism and authority

Extractions work like test results. A test run is an observation: run the same
suite against the same commit twice and you usually, not always, get the same
answer. Teams don't respond by forbidding anything short of perfect determinism.
They make tests as deterministic as they reasonably can, they notice flaky ones
by rerunning them, and they agree that the run in CI is the official result for
a commit, even though a rerun could differ.

An extraction is the same kind of thing: **an observation of a revision, made by
one run in one environment**, not a pure value. Three consequences follow.

**Authority.** A commit's official extraction is the run the team's CI published
(the Action's artifact). Local runs are labelled as runs. Every extraction's
`provenance.execution` records the run: where it ran (`source`), its environment
fingerprint, when (`at`), and for a CI run the repository and run ID with
`official: true`. Hosts show the official run for a commit by default and say
_From CI_, _Local_, _Approximate_ or _Stale_
([local execution](../../design/local-execution.md)).

**Determinism classes.** An extractor declares how reproducible it is, as
`execution.determinism` in the definition and `determinism` in a built-in's
descriptor. The class is descriptive, never enforced:

<!-- prettier-ignore -->
| Class | Depends on | Reuse | Examples |
|---|---|---|---|
| `pure` | The revision's files | Cached by Git tree, forever; a rerun must match | Manifests, lockfiles, schemas, workflow YAML: every built-in that only reads files |
| `environmental` | Files, toolchain and installed dependencies | Cached only within the same environment fingerprint | Compiler and type-checker output, dependency-injection containers. The default for custom extractors |
| `observed` | Live or varying data | Never reused silently: always "the latest observation, from *when*" | Timings, benchmarks, coverage |

A built-in's definition may declare a less reproducible class than the built-in
does, never a more reproducible one.

**Determinism is measured, like flaky tests.** `projections check` reruns each
extraction and compares the two runs. A difference is a warning, never a
failure, that names the items and fields that varied; `--strict-determinism`
makes it a failure, which CI uses for built-ins, and our own tests hold every
built-in to its class. The local-vs-CI parity check (`check --parity REV`)
reports stability across environments the same way ("varies between this
environment and CI on 12% of items"). An extraction may declare which fields
vary and by how much (its top-level `volatile` list, with tolerances);
comparators then report those differences as variation within tolerance rather
than as changes.

**Unchanged:** comparators stay deterministic, and verifying a saved comparison
reruns the comparator over the recorded extractions; it never re-extracts.

Determinism remains the goal, because a projection's value falls quickly when
readers can't tell a real change from noise. The built-in extractors are
deterministic, and authoring guidance steers custom ones the same way:

- **Read declared or resolved structure, not observed behavior.** Manifests,
  lockfiles, compiler and type-checker output, schemas, container registrations
  and plans describe what the code _is_. Profiles, traces, timings, sampled
  telemetry, benchmark results and load-test output describe one run of it and
  change between identical runs; when you want them anyway, declare the
  extractor `observed` and mark the varying fields `volatile`.
- **Keep the environment out of the output.** No clocks, random identifiers,
  absolute paths, host names, usernames, temporary directories or process IDs in
  IDs or data. The runner records the environment in provenance, not in
  entities.
- **Pin what the result depends on.** Prefer lockfiles and resolved graphs to
  version ranges, the project's own toolchain to whatever is newest, and offline
  reads to network lookups (registries, download counts, advisories change
  without the revision changing).
- **Order deterministically.** Sort entities, relationships and collections
  inside `data` by a stable key; never emit in hash-map or filesystem order.
- **Make identity independent of incidental values.** An ID names the thing (a
  package, a service, a table), not its version or position, so an upgrade is
  one modified entity rather than a removal and an addition.

The built-in `timeline` renderer was removed for this reason: the data it was
designed for (profiling and trace timings) mostly showed run-to-run variance
when comparing two revisions. `execution.reproducibility` (`hermetic`,
`pinned-toolchain`, `local`, `unknown`, `external`) still describes how the
toolchain is pinned, independently of the determinism class.
