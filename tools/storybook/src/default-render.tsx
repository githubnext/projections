// Story renderers for the default UI's prebuilt views, shared by its story files.
import type {StoryContext} from '@storybook/react-vite'
import {ComparisonExplorer} from '@githubnext/projections-host/ui'
import {themeOf} from './theme.js'
import {extractionChoices} from './fixtures.js'
import {loadComparator, rules} from './runtime.js'
import {renderDetails, sampleAnnotations, scenarioFixture, type Loaded, type ScenarioArgs} from './stories.js'

/** `ComparisonExplorer` on the scenario's saved extractions, compared from before to after. */
export function renderExplorer(args: ScenarioArgs, {globals, loaded}: Pick<StoryContext, 'globals' | 'loaded'>) {
  const {runtime} = loaded as Loaded
  const item = scenarioFixture(args)
  const extractions = extractionChoices(item)
  return (
    <ComparisonExplorer
      key={`${item.key}-${args.renderer ?? ''}`}
      extractions={extractions}
      engine={runtime.engine}
      renderers={runtime.renderers}
      initialBefore={extractions.length > 1 ? 'before' : ''}
      initialAfter={extractions.at(-1)!.key}
      loadComparator={loadComparator}
      rules={rules}
      colorMode={themeOf(globals)}
      {...(args.initialMode ? {initialMode: args.initialMode} : {})}
      {...(args.initialView ? {initialView: args.initialView} : {})}
      {...(args.changesOnly !== undefined ? {changesOnly: args.changesOnly} : {})}
      {...(args.annotations ? {annotations: sampleAnnotations(item)} : {})}
      {...(args.details ? {renderDetails} : {})}
    />
  )
}
