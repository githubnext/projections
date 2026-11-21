# Projections documentation

Pick the section that matches what you're trying to do. Each guide links onward
to the next page you're likely to need.

## Use Projections

1. Start with the [quick start](setup/quick-start.md). Hand your coding agent
   the setup prompt so it can run the CLI, explore your repository, and open
   projections in the Projections viewer (either in your agent's in-app browser
   or a standalone browser). You can also [install the CLI](setup/install.md)
   yourself, or install from a clone via
   [early access (from source)](setup/early-access.md) before a release reaches
   you. If you prefer an alternate workflow right beside your code in VS Code,
   see [the VS Code extension](setup/install.md#the-vs-code-extension).
2. [Build your first projection](setup/first-projection.md) for something unique
   to your codebase, then [add Projections to CI](setup/ci.md) using the GitHub
   Action.
3. [Run projections locally](runner.md) to learn every CLI workflow, including
   `explore`, `show`, `compare`, `check`, image export, and the GitHub CLI
   extension.
4. Read the [how-it-works guide](guides/how-it-works.md) to see how projections,
   extractors, comparators, and renderers fit together and how to customize each
   one.
5. Check [support and compatibility](guides/support.md) and the
   [security architecture](guides/security.md) for supported platforms and
   execution boundaries.

To browse what comes out of the box, look through [the gallery](gallery.md) for
examples of every built-in renderer, or open [the built-ins](builtins/README.md)
for a dedicated page on each built-in extractor, renderer, and the default
comparator (including options and when to build your own). For complete option
lists, see the [CLI reference](reference/cli.md), the
[GitHub Action reference](reference/github-action.md), the
[built-in extractors reference](reference/extractors.md), and the
[built-in renderers reference](reference/renderers.md).

If you're working with a coding agent, the [agent prompt files](agents/) cover
the same tasks: [explore](agents/explore.md), [install](agents/install.md),
[create a projection](agents/create-projection.md), and
[add to CI](agents/ci.md). [Agent skills](setup/agent-skills.md) explains where
`projections init` writes the skill file and which agents pick it up.

## Extend Projections

- **Extractors** read a repository and emit an extraction. Begin with
  [write your first extractor](guides/first-extractor.md), then keep the
  [extractor SDK API](reference/extractor-sdk.md) and the
  [extraction schemas](reference/schemas/README.md) nearby as references.
- **Comparators** determine what changed between revisions. See real examples in
  [Custom comparators: what they make possible](guides/comparators.md), follow
  [control the order of changes](guides/order-of-changes.md) to write your own,
  and refer to the [comparator schema](reference/schemas/comparator.md).
- **Renderers** draw extractions and comparisons. Start with
  [develop a renderer](guides/develop-a-renderer.md), the
  [renderer kit guide](guides/renderer-kit.md) (including
  [graphs](guides/renderer-kit-graphs.md) and
  [components](guides/renderer-kit-components.md)), and the
  [renderer SDK guide](guides/renderer-sdk.md). When you need API details, check
  the [renderer kit API](reference/renderer-kit.md), the
  [renderer SDK API](reference/renderer-sdk.md),
  [renderer messages](reference/renderer-messages.md), and
  [theme tokens](reference/theme-tokens.md). All of these ship in
  [`@githubnext/projections`](../packages/sdk/README.md).
- **Embedding** lets you host Projections inside your own application. Start
  with
  [embedding Projections](guides/embedding.md#embedding-projections-in-your-own-app)
  and continue to the [host guide](guides/host.md).

The [contracts](contracts.md) specify every version 0 wire format, file, and
protocol, backed by the JSON Schemas in
[extraction and protocol schemas](reference/schemas/README.md).

## Shared models

Extractors across different ecosystems share common vocabularies so that a
single renderer and comparator can work for all of them:

- [Domain model and vocabulary plan](models/domain-model.md) explains the design
  behind extractions, comparisons, and shared vocabularies.
- [One model for dependency injection](models/dependency-injection-model.md)
  shows how .NET, NestJS, and Spring containers map onto one set of boundaries.
- [One model for infrastructure](models/infrastructure-model.md) maps Terraform
  plans and Azure what-if results into a single resource graph.
- [One model for runtime security policies](models/runtime-policy-model.md)
- [One model for agentic workflows](models/agentic-workflow-model.md)
- [One model for renderer scenarios](models/scenarios-model.md)
- [API compatibility](models/api-compatibility.md)

## Contribute and maintain

- [Contributing](../CONTRIBUTING.md) covers local setup, checks, and the
  repository's invariants.
- [State machines](guides/state-machines.md) explains how the hosts and
  integrations model lifecycles, along with the checks that enforce them.
- [Design decisions](design/) explain why things are built the way they are,
  along with each decision's status, while [proposals](design/proposals/) hold
  open RFCs. You can also read the
  [engine evaluation](design/engine-evaluation.md) for measured Rust adoption,
  Worker responsiveness, and maximum-case qualifications, and
  [the Engine's verification](../packages/engine/VERIFICATION.md) to see what
  Verus proves.
- Maintainer guides cover [releasing](maintainers/releasing.md),
  [npm publishing](maintainers/npm-publishing.md),
  [schema publishing](maintainers/schema-publishing.md),
  [runner coverage](maintainers/runner-coverage.md),
  [file standards](maintainers/file-standards.md),
  [what CI runs for what](maintainers/ci-plan.md),
  [dependency advisories](maintainers/dependency-advisories.md), and
  [developing the VS Code extension](maintainers/vscode-extension.md).

## Layout

| Directory                         | Holds                                                                                         |
| --------------------------------- | --------------------------------------------------------------------------------------------- |
| [`setup/`](setup/)                | Getting started: install, early access, quick start, first projection, adding to CI           |
| [`builtins/`](builtins/README.md) | A page per built-in extractor, renderer and the default comparator; their facts are generated |
| [`guides/`](guides/)              | How Projections works and how to extend it                                                    |
| [`reference/`](reference/)        | Generated reference pages (`npm run docs:generate`); don't edit them by hand                  |
| [`models/`](models/)              | The shared vocabulary specifications                                                          |
| [`design/`](design/)              | Decision records; open proposals in [`design/proposals/`](design/proposals/)                  |
| [`maintainers/`](maintainers/)    | Releasing and verifying Projections                                                           |
| [`agents/`](agents/)              | Prompt files for coding agents                                                                |

[`contracts.md`](contracts.md) and [`runner.md`](runner.md) sit at the top level
because the rest of the docs link to them directly. Each one indexes its
supporting pages under [`contracts/`](contracts/) and [`runner/`](runner/).
