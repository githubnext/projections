// A reference consumer of the target hooks: the details slot and the targets panel.
import {useState} from 'react'
import type {RefObject} from 'react'
import {decodeTarget, encodeTarget, useProjectionAnchor} from '@githubnext/projections-host'
import type {ProjectionController, ProjectionSelection, TargetResolution} from '@githubnext/projections-host'

/** A consumer's details content: the selection's targets and where the renderer draws it. */
export function DetailsSlot({selection, projection}: {selection: ProjectionSelection; projection: ProjectionController}) {
  const anchor = useProjectionAnchor(projection)
  return (
    <div className="demo-slot">
      <p>
        <strong>Consumer slot</strong> · targets:{' '}
        <output aria-label="Selection targets">{selection.targets.map(encodeTarget).join(' ') || 'none'}</output>
      </p>
      <p>
        Anchor:{' '}
        <output aria-label="Selection anchor">
          {anchor
            ? JSON.stringify({
                x: Math.round(anchor.x),
                y: Math.round(anchor.y),
                width: Math.round(anchor.width),
                height: Math.round(anchor.height),
                side: anchor.side,
              })
            : 'none'}
        </output>
      </p>
    </div>
  )
}

/** The host's selection targets, annotation activations and a form that selects a target through the controller. */
export function TargetsPanel({
  targets,
  activations,
  controller,
}: {
  targets: ProjectionSelection | null
  activations: string[]
  controller: RefObject<ProjectionController | null>
}) {
  const [targetText, setTargetText] = useState('')
  const [resolution, setResolution] = useState<TargetResolution | 'invalid' | undefined>()
  return (
    <div className="demo-evidence demo-targets" role="group" aria-label="Targets">
      <p>
        Targets: <output aria-label="Host selection targets">{JSON.stringify(targets?.targets ?? null)}</output>
      </p>
      <p>
        Selected target: <output aria-label="Host selected target">{targets?.target ? JSON.stringify(targets.target) : 'None'}</output>
      </p>
      <p>
        Annotation activations: <output aria-label="Annotation activations">{activations.join(', ') || 'None'}</output>
      </p>
      <form
        onSubmit={event => {
          event.preventDefault()
          const target = decodeTarget(targetText.trim())
          setResolution(target ? controller.current?.selectTarget(target) : 'invalid')
        }}
      >
        <label>
          Target{' '}
          <input
            aria-label="Target to select"
            value={targetText}
            placeholder="entity.after.payments"
            onChange={event => setTargetText(event.target.value)}
          />
        </label>{' '}
        <button type="submit">Select target</button>{' '}
        <output aria-label="Target resolution">{resolution === undefined ? 'None' : JSON.stringify(resolution)}</output>
      </form>
    </div>
  )
}
