import type {RefObject} from 'react'
import {shortcutLabel} from '../shell/controls.js'
import {ProjectionSwitcher, type SwitcherItem} from '../shell/switcher.js'
import type {ThemePreference} from '../shell/theme.js'
import type {InspectorRevision} from '../types.js'
import {inspectorActivity} from './activity.js'
import {revisionOption} from './revisions.js'
import {InspectorTitle} from './title-controls.js'

/** The workbench's title bar: its items (the activity line, Open, Settings), the projection switcher, and its key. */
export function inspectorTitleBar({
  activity: situation,
  connected,
  watching,
  artifactName,
  loadingArtifact,
  upload,
  openArtifact,
  theme,
  definitionChoice,
  switcher,
}: {
  /** What the activity line says, from the Inspector's situation. */
  activity: Parameters<typeof inspectorActivity>[0]
  /** Whether a runner is connected. */
  connected: boolean
  watching: boolean
  artifactName: string | undefined
  loadingArtifact: boolean
  upload: RefObject<HTMLInputElement | null>
  openArtifact: (file: File | undefined) => Promise<void>
  theme: {preference: ThemePreference; setPreference: (value: ThemePreference) => void; colorMode: 'light' | 'dark'}
  /** The advanced Definition from choice, with a runner. */
  definitionChoice: {value: string; revisions: readonly InspectorRevision[]; onChange: (value: string) => void; disabled: boolean}
  switcher: {
    items: SwitcherItem[]
    presented: string
    failing: number
    open: boolean
    onOpenChange: (open: boolean) => void
    onChoose: (id: string) => void
    loading: boolean
  }
}) {
  const activity = inspectorActivity(situation)
  const title = (
    <InspectorTitle
      activity={activity}
      watching={watching}
      loadingArtifact={loadingArtifact}
      upload={upload}
      openArtifact={openArtifact}
      theme={theme}
      definition={
        connected
          ? {
              value: definitionChoice.value,
              options: definitionChoice.revisions.map(item => ({value: item.ref, label: revisionOption(item)})),
              onChange: definitionChoice.onChange,
              disabled: definitionChoice.disabled,
            }
          : undefined
      }
    />
  )
  const center = (
    <ProjectionSwitcher
      items={switcher.items}
      current={switcher.presented}
      open={switcher.open}
      onOpenChange={switcher.onOpenChange}
      onChoose={id => (connected ? switcher.onChoose(id) : undefined)}
      colorMode={theme.colorMode}
      shortcut={shortcutLabel('p')}
      empty={connected ? (switcher.loading ? 'Reading projections…' : 'No projection') : 'No artifact open'}
    />
  )
  const mode = connected ? 'repository' : 'offline'
  const titleKey = `${mode}-${switcher.presented}-${switcher.failing}-${definitionChoice.value}-${activity.kind}-${artifactName ?? ''}-${loadingArtifact}-${situation.shownScenario ?? ''}`
  return {title, center, titleKey}
}
