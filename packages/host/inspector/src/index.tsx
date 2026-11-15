// The package entry: the Inspector app (its modules are in `app/`) and what hosts use beside it.
export {InspectorApp} from './app/inspector-app.js'
export type {InspectorAppProps, InspectorComparison, InspectorDocument, InspectorOpenedOn} from './app/props.js'
export {artifactChoices, scenarioArtifact} from './app/artifacts.js'
export {changeReason, definitionPolicy, partPath, repositoryKey} from './app/definitions.js'
export {SidebarSection} from './app/explorer-sections.js'
export {mentionsPath} from './app/page.js'
export {defaultPair, pairDetail, pairLabel, suggestedMarks} from './app/pairs.js'
export {age, choiceLabel, refName, revisionKey, revisionLabel} from './app/revisions.js'
export {ProvenanceSection} from './shell/panels.js'
export {InspectorHostProvider} from './host.js'
export {createInspectorClient} from './client/create.js'
export {InspectorRequestError} from './transport.js'
export {maxComparatorBytes, parseComparatorResponse} from './client/comparator.js'
export {parseFixtureCatalog} from './client/fixtures.js'
export {parseRendererList} from './client/renderers.js'
export type {InspectorApi} from './client/api.js'
export type {
  FixtureCatalog,
  FixtureComparator,
  FixtureRenderer,
  FixtureScenario,
  FixtureSource,
  InspectorComparator,
  InspectorDefinitionList,
  InspectorDefinitionSave,
  InspectorInvalidDefinition,
  InspectorJob,
  InspectorPair,
  InspectorPairs,
  InspectorPolicy,
  InspectorRendererList,
  InspectorRevision,
  InspectorRevisionList,
  InspectorRunOutput,
  InspectorRunRequest,
} from './types.js'
