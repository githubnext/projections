import {
  codeStatisticsMeasures,
  codeStatisticsScopes,
  defaultCodeStatisticsOptions,
  genericMetrics,
  hasTestCounts,
  isCodeStatisticsMeasure,
  isCodeStatisticsScope,
} from '@githubnext/projections-renderer-sdk/presentation'
import type {CodeStatisticsOptions} from '@githubnext/projections-renderer-sdk/presentation'
import {defineControls} from '@githubnext/projections-renderer-sdk/protocol'
import type {ControlValue, RendererControl} from '@githubnext/projections-renderer-sdk/protocol'
import type {Entity} from '@githubnext/projections-schemas'

/**
 * Code-statistics display controls, drawn by the host: `measure` (by language
 * only), `byLanguage` (one row per language, or the code/comment/blank
 * composition) and `chart`. See `codeStatisticsControlsFor` for the scope
 * control that splits test files.
 */
export const codeStatisticsControls = defineControls([
  {
    id: 'measure',
    label: 'Measure',
    description: 'What each language row counts',
    type: 'choice',
    group: 'statistics',
    groupLabel: 'Statistics',
    default: defaultCodeStatisticsOptions.measure,
    choices: codeStatisticsMeasures.map(measure => ({value: measure.id, label: measure.label})),
  },
  {
    id: 'byLanguage',
    label: 'By language',
    description: 'One row per language, or the code, comment and blank composition',
    type: 'toggle',
    group: 'statistics',
    groupLabel: 'Statistics',
    default: defaultCodeStatisticsOptions.byLanguage,
  },
  {
    id: 'chart',
    label: 'Chart',
    type: 'choice',
    group: 'statistics',
    groupLabel: 'Statistics',
    default: defaultCodeStatisticsOptions.chart,
    choices: [
      {value: 'bars', label: 'Bars'},
      {value: 'share', label: 'Share'},
    ],
  },
])

/**
 * The "Files" control (all files, tests, non-tests), offered only when the
 * extraction splits its counts into test and other files (`testCode`, …).
 */
export const codeStatisticsScopeControl = defineControls([
  {
    id: 'scope',
    label: 'Files',
    description: 'Count every file, only the files classified as tests, or the rest',
    type: 'choice',
    group: 'statistics',
    groupLabel: 'Statistics',
    default: defaultCodeStatisticsOptions.scope,
    choices: codeStatisticsScopes.map(scope => ({value: scope.id, label: scope.label})),
  },
])[0]

/**
 * The code-statistics controls for these entities: the scope control joins when they carry test counts. Generic
 * measurements (`genericMetrics`: values without line or file counts) have one value per row, so only the chart is offered.
 */
export function codeStatisticsControlsFor(entities: Iterable<Entity | undefined>): RendererControl[] {
  const list = [...entities]
  if (genericMetrics(list)) return codeStatisticsControls.filter(control => control.id === 'chart')
  return hasTestCounts(list) ? [codeStatisticsScopeControl, ...codeStatisticsControls] : [...codeStatisticsControls]
}

/** Code-statistics options from control values (see `controlValues`). */
export function codeStatisticsOptions(values: {[id: string]: ControlValue}): CodeStatisticsOptions {
  const measure = values.measure,
    chart = values.chart,
    byLanguage = values.byLanguage
  return {
    measure: typeof measure === 'string' && isCodeStatisticsMeasure(measure) ? measure : defaultCodeStatisticsOptions.measure,
    chart: chart === 'share' ? 'share' : 'bars',
    byLanguage: typeof byLanguage === 'boolean' ? byLanguage : defaultCodeStatisticsOptions.byLanguage,
    scope: isCodeStatisticsScope(values.scope) ? values.scope : defaultCodeStatisticsOptions.scope,
  }
}
