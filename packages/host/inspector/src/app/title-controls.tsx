import type {RefObject} from 'react'
import {FileUp, LoaderCircle} from 'lucide-react'
import {shortcutLabel} from '../shell/controls.js'
import {TitleActivity, TitleFileButton, TitleSettings, type PickerOption} from '../shell/title-bar.js'
import type {ThemePreference} from '../shell/theme.js'
import type {Activity} from './activity.js'

/** The title bar's items: the status line, Open (a saved artifact) and the Settings menu. */
export function InspectorTitle({
  activity,
  watching,
  loadingArtifact,
  upload,
  openArtifact,
  theme,
  definition,
}: {
  activity: Activity
  /** Whether the live preview follows the working tree. */
  watching: boolean
  loadingArtifact: boolean
  upload: RefObject<HTMLInputElement | null>
  openArtifact: (file: File | undefined) => Promise<void>
  theme: {preference: ThemePreference; setPreference: (value: ThemePreference) => void}
  /** The advanced Definition from choice, with a runner. */
  definition: {value: string; options: readonly PickerOption[]; onChange: (value: string) => void; disabled?: boolean} | undefined
}) {
  return (
    <>
      <TitleActivity
        kind={activity.kind}
        plain={activity.plain}
        at={activity.at}
        verb={activity.verb}
        reason={activity.reason?.node}
        data-watching={watching || undefined}
      >
        {activity.message}
      </TitleActivity>
      <TitleFileButton
        icon={loadingArtifact ? <LoaderCircle className="pj:animate-spin pj:motion-reduce:animate-none" /> : <FileUp />}
        label="Open"
        name="Open saved artifact"
        title={`Open saved artifact (${shortcutLabel('o')})`}
        accept=".json,application/json"
        busy={loadingArtifact}
        inputRef={upload}
        onFile={file => void openArtifact(file)}
      />
      <TitleSettings theme={theme.preference} onTheme={theme.setPreference} definition={definition} />
    </>
  )
}
