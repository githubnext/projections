// Where the renderers use the icons, each beside the words that renderer draws it with: read from the renderers' own
// vocabularies, so these groups follow them. The SDK vocabulary stories show every icon; these show them in use.
import {statusIcons, statusLabels} from '@githubnext/projections-renderer-kit'
import type {StatusPart} from '@githubnext/projections-renderer-kit'
import {generatedLabel, variedBeyondLabel} from '@githubnext/projections-renderer-sdk/presentation'
import {compatibilityLabels, compatibilityLevels} from '../../../packages/renderers/api/src/compatibility.js'
import {actionPart, infrastructureStatus} from '../../../packages/renderers/graph/src/infrastructure/resources.js'
import {categories, findingLabels, interpretationText} from '../../../packages/renderers/runtime-policy/src/model.js'
import type {IconEntry, IconGroup} from '../src/icon-vocabulary.js'

const fromPart = (part: StatusPart): IconEntry => ({name: part.icon, label: part.label, status: part.status})

/** The planned actions an infrastructure plan words (`actionPart`), and a moved resource. */
const infrastructureActions = ['create', 'delete', 'replace', 'update', 'deploy', 'read', 'import', 'forget']

export const iconUses: IconGroup[] = [
  {
    title: 'Change status (renderer kit)',
    icons: (['added', 'removed', 'modified', 'renamed'] as const).map(status => ({
      name: statusIcons[status],
      label: statusLabels[status],
      status,
    })),
  },
  {
    title: 'Volatile and generated values (renderer kit)',
    icons: [
      {name: 'varied', label: variedBeyondLabel, status: 'unchanged'},
      {name: 'generated', label: generatedLabel, status: 'unchanged'},
    ],
  },
  {
    title: 'Planned actions (graph renderer, infrastructure)',
    icons: [
      ...infrastructureActions.flatMap(action => {
        const part = actionPart(action)
        return part ? [fromPart(part)] : []
      }),
      ...infrastructureStatus({status: 'unchanged', renamed: true}).map(fromPart),
    ],
  },
  {
    title: 'Compatibility (API renderer)',
    icons: compatibilityLevels.map(level => {
      const {icon, label} = compatibilityLabels[level]
      return {name: icon, label, status: 'unchanged'}
    }),
  },
  {
    title: 'Subjects (runtime policy renderer)',
    icons: categories.map(category => ({name: category.icon, label: category.title, status: 'unchanged'})),
  },
  {
    title: 'Findings (runtime policy renderer)',
    icons: findingLabels.map(finding => ({
      name: finding.icon,
      label: interpretationText[finding.id] ?? finding.noun.singular,
      status: 'unchanged',
      noun: finding.noun,
    })),
  },
]
