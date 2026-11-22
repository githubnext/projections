// Story renderers for the VS Code UI's prebuilt views, shared by its story files.
import type {StoryContext} from '@storybook/react-vite'
import {VscodeComparisonExplorer, type VscodeProjectionFeatures} from '@githubnext/projections-host-vscode'
import {extractionChoices} from './fixtures.js'
import {loadComparator, rules} from './runtime.js'
import {renderDetails, sampleAnnotations, scenarioFixture, type Loaded, type ScenarioArgs} from './stories.js'

export interface VscodeArgs extends ScenarioArgs {
  /** Features to turn off or restrict (`VscodeProjectionFeatures`); every feature defaults on. */
  features?: VscodeProjectionFeatures
  /** The width of the explorer's container, as when embedded (for example in an editor group), whatever the viewport. */
  width?: number
}

/** `VscodeComparisonExplorer` on the scenario's saved extractions, compared from before to after. Its theme follows the frame's VS Code theme. */
export function renderVscodeExplorer(args: VscodeArgs, {loaded}: Pick<StoryContext, 'loaded'>) {
  const {runtime} = loaded as Loaded
  const item = scenarioFixture(args)
  const extractions = extractionChoices(item)
  return (
    <VscodeComparisonExplorer
      key={`${item.key}-${args.renderer ?? ''}`}
      extractions={extractions}
      engine={runtime.engine}
      renderers={runtime.renderers}
      initialBefore={extractions.length > 1 ? 'before' : ''}
      initialAfter={extractions.at(-1)!.key}
      loadComparator={loadComparator}
      rules={rules}
      {...(args.features ? {features: args.features} : {})}
      {...(args.initialMode ? {initialMode: args.initialMode} : {})}
      {...(args.initialView ? {initialView: args.initialView} : {})}
      {...(args.annotations ? {annotations: sampleAnnotations(item)} : {})}
      {...(args.details ? {renderDetails} : {})}
    />
  )
}
