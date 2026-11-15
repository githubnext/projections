# API compatibility comparator

`api-compatibility` classifies every changed declaration of an `api/v0`
comparison as **breaking**, **additive**, **compatible** or **unknown**, with a
reason and the rule that decided it. It is a comparator file,
[`api-compatibility.comparator.yaml`](api-compatibility.comparator.yaml), loaded
exactly like anyone's: it has no privileges, needs no `--trust`, and runs the
same way in the CLI, the Inspector and browsers.

The rules are each ecosystem's official ones, reproduced over the contract facts
the `dotnet-public-api`, `typescript-public-api`, `rust-public-api` and
`go-public-api` extractors read from the compiler. The facts are
language-neutral (`data.contract`, defined by the
[`api/v0` schema](../../../docs/reference/schemas/api.md#contract) and checked
by the Engine); each ecosystem's rules also read the few facts only they need,
in `contract.native`:

| `metadata.ecosystem` | Rules                                                                          |
| -------------------- | ------------------------------------------------------------------------------ |
| `dotnet`             | ApiCompat's default mode (package validation diagnostic IDs `CP0001`–`CP0021`) |
| `typescript`         | Assignability over the checker's resolved union constituents                   |
| `rust`               | The Cargo SemVer reference, which cargo-semver-checks implements               |
| `go`                 | apidiff's documented rules                                                     |

Why the official tools aren't invoked, exactly which rules are reproduced, and
what is `unknown` are in the
[design](../../../docs/models/api-compatibility.md).

## Use

Copy `api-compatibility.comparator.yaml` into the repository and name it in the
projection definition:

```json
{
  "id": "api",
  "title": "Public API",
  "extractor": "typescript-public-api",
  "renderer": "api",
  "inputs": {"tsconfig": "tsconfig.json"},
  "comparator": ".github/projections/api-compatibility.comparator.yaml"
}
```

`options.ecosystem` selects a rule set when the extractions don't declare
`metadata.ecosystem`, for example for a custom extractor that writes the same
contract facts.

## Output

The baseline comparison, unchanged except for:

- each entity change's `summary`:
  `Breaking (binary, source): Return type changed from Receipt to Task<Receipt>.`;
- `metadata.compatibility`:
  `{version, ecosystem, rules, counts, changes, notices}`, where `changes` maps
  each entity change ID to `{level, kinds?, reason, findings}`.

The [api renderer](../../renderers/api) shows it as figures in the host's
summary bar (`2 breaking changes · 5 additive changes`, each filtering to its
changes), a status per declaration and a **Breaking only** filter.

## Test

[`api-compatibility.comparator.test.yaml`](api-compatibility.comparator.test.yaml)
states each ecosystem's verdicts on the API renderer's fixtures. In a repository
whose projection uses the comparator, copy it beside the comparator file (with
its fixtures and [`snapshots`](snapshots)) and run it with
`projections check -p <id> --no-render`; here, the CLI's tests run it:

```sh
cargo test -p projections-cli --test comparator_tests   # every *.comparator.test.yaml in the repository
cargo test --release -p projections-comparator-rules --test api
```

The rules replaced a Rust comparator module, deleted with module comparators.
Its unit tests run against the rules in
[`packages/comparators/rules/tests/api`](../rules/tests/api), and its
comparisons of every fixture are recorded in
[`golden/api-compatibility.json`](../rules/tests/golden/api-compatibility.json),
which the rules must agree with. The original saw the extractors' earlier,
language-shaped facts; when the facts were normalized, its recorded inputs were
converted ([`convert.rs`](../rules/tests/api/convert.rs), run by the ignored
`golden_migration` test), and the converted fixtures equal what the extractors
now write.

The real extractions are the
[api renderer's fixtures](../../renderers/api/fixtures), regenerated with
`node packages/renderers/api/scripts/fixtures.mjs <ecosystem>…`, which runs
`projections compare --trust` on the before and after projects in each
extractor's `tests/fixtures/compatibility`.
