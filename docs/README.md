# Projections documentation

Start here. Pick the path that matches what you're doing; each page links to the
next one you're likely to need.

## Use Projections

1. Follow the [quick start](setup/quick-start.md): give your coding agent the
   setup prompt to run the CLI, explore your repository, and open projections in
   the Projections viewer (in your agent's in-app browser or a standalone
   browser), or [install the CLI](setup/install.md) yourself. Before a release
   reaches you, install from a clone:
   [early access (from source)](setup/early-access.md). For an alternate
   experience closer to your code, see
   [the VS Code extension](setup/install.md#the-vs-code-extension).
2. [Build your first projection](setup/first-projection.md) and
   [add Projections to CI](setup/ci.md) with the GitHub Action.
3. [Run projections locally](runner.md): every CLI workflow (`explore`, `show`,
   `compare`, `check`, images and the GitHub CLI extension).
4. The [guide](guides/how-it-works.md) explains how Projections works:
   projections, extractors, comparators and renderers, and how to customize
   each.
5. [Support and compatibility](guides/support.md) and the
   [security architecture](guides/security.md): what's supported, and where each
   part runs.

[The gallery](gallery.md) shows an example of each built-in renderer.
[The built-ins](builtins/README.md) have a page each: what every built-in
extractor, renderer and the default comparator shows, its options, and when to
build your own. The [CLI reference](reference/cli.md), the
[GitHub Action reference](reference/github-action.md), the
[built-in extractors](reference/extractors.md) and the
[built-in renderers](reference/renderers.md) list every option.

Working with a coding agent? The [agent prompt files](agents/) give it the same
steps: [explore](agents/explore.md), [install](agents/install.md),
[create a projection](agents/create-projection.md) and
[add to CI](agents/ci.md). [Agent skills](setup/agent-skills.md) says where
`projections init` puts the skill agents load, and which agents read it.

## Extend Projections

- **Extractors** read a repository and write an extraction. Start with
  [write your first extractor](guides/first-extractor.md); the
  [extractor SDK API](reference/extractor-sdk.md) and the
  [extraction schemas](reference/schemas/README.md) are the reference.
- **Comparators** decide what changed.
  [Custom comparators: what they make possible](guides/comparators.md) shows
  real examples; [control the order of changes](guides/order-of-changes.md)
  walks through writing one, and the
  [comparator schema](reference/schemas/comparator.md) is the reference.
- **Renderers** draw extractions and comparisons. Start with
  [develop a renderer](guides/develop-a-renderer.md), the
  [renderer kit guide](guides/renderer-kit.md) (with its
  [graphs](guides/renderer-kit-graphs.md) and
  [components](guides/renderer-kit-components.md)) and the
  [renderer SDK guide](guides/renderer-sdk.md), then the API: the
  [renderer kit API](reference/renderer-kit.md), the
  [renderer SDK API](reference/renderer-sdk.md),
  [renderer messages](reference/renderer-messages.md) and
  [theme tokens](reference/theme-tokens.md). The
  [`@githubnext/projections`](../packages/sdk/README.md) package ships them.
- **Embedding** Projections in your own app:
  [embedding Projections](guides/embedding.md#embedding-projections-in-your-own-app),
  then the [host guide](guides/host.md).

The [contracts](contracts.md) specify every wire format, file and protocol
(version 0), and the [schemas](reference/schemas/README.md) are their JSON
Schemas.

## Shared models

The vocabularies extractors share, so one renderer and comparator work across
ecosystems:

- [Domain model and vocabulary plan](models/domain-model.md): the decisions
  behind extractions, comparisons and vocabularies.
- [One model for dependency injection](models/dependency-injection-model.md):
  how .NET, NestJS and Spring containers share one set of boundaries.
- [One model for infrastructure](models/infrastructure-model.md): how Terraform
  plans and Azure what-if results become one resource graph.
- [One model for runtime security policies](models/runtime-policy-model.md)
- [One model for agentic workflows](models/agentic-workflow-model.md)
- [One model for renderer scenarios](models/scenarios-model.md)
- [API compatibility](models/api-compatibility.md)

## Contribute and maintain

- [Contributing](../CONTRIBUTING.md): setup, the checks and the repository's
  invariants.
- [State machines](guides/state-machines.md): how the hosts and integrations
  model lifecycles, and the checks that hold them to it.
- [Design decisions](design/): why things are the way they are, each with its
  status. [Proposals](design/proposals/) are still open. The
  [engine evaluation](design/engine-evaluation.md) records measured Rust
  adoption, Worker responsiveness and maximum-case qualifications, and
  [the Engine's verification](../packages/engine/VERIFICATION.md) what Verus
  proves.
- Maintainers: [releasing](maintainers/releasing.md),
  [npm publishing](maintainers/npm-publishing.md),
  [schema publishing](maintainers/schema-publishing.md),
  [runner coverage](maintainers/runner-coverage.md),
  [file standards](maintainers/file-standards.md),
  [dependency advisories](maintainers/dependency-advisories.md) and
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

[`contracts.md`](contracts.md) and [`runner.md`](runner.md) stay at the top:
they're the specifications the rest link to. Each indexes its pages, in
[`contracts/`](contracts/) and [`runner/`](runner/).
