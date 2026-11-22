import {useMemo, useRef, useState, type Dispatch, type SetStateAction} from 'react'
import {maxArtifactBytes} from '@githubnext/projections-engine/artifacts'
import {artifactChoices, type Artifact} from './artifacts.js'
import {errorText} from './errors.js'
import type {Marks} from './pairs.js'
import type {InspectorDocument} from './props.js'

/**
 * The saved artifact (or renderer scenario) presented instead of live extractions, its own Before → After marks, and
 * which of the two the main view shows (`source`). Opening an artifact file shows it.
 */
export function useArtifacts({
  initialDocument,
  loadArtifact,
  setError,
}: {
  initialDocument: InspectorDocument | undefined
  loadArtifact: (json: string) => Promise<InspectorDocument>
  setError: Dispatch<SetStateAction<string | null>>
}) {
  const [loadingArtifact, setLoadingArtifact] = useState(false)
  const initial = useMemo(() => (initialDocument ? artifactChoices(initialDocument) : undefined), [initialDocument])
  const [artifact, setArtifact] = useState<Artifact | null>(() => (initial ? {name: 'Saved review', ...initial} : null))
  const [artifactMarks, setArtifactMarks] = useState<Marks>(() => (initial ? {a: initial.before, b: initial.after} : {}))
  const [source, setSource] = useState<'live' | 'artifact'>(initialDocument ? 'artifact' : 'live')
  const upload = useRef<HTMLInputElement>(null)
  async function openArtifact(file: File | undefined) {
    if (!file) return
    setLoadingArtifact(true)
    setError(null)
    try {
      if (file.size > maxArtifactBytes) throw new Error(`This artifact exceeds the ${maxArtifactBytes / 1024 / 1024} MiB Inspector limit`)
      const loaded = artifactChoices(await loadArtifact(await file.text()))
      setArtifact({name: file.name, ...loaded})
      setArtifactMarks({a: loaded.before, b: loaded.after})
      setSource('artifact')
    } catch (failure) {
      setError(`Could not load artifact: ${errorText(failure)}`)
    } finally {
      setLoadingArtifact(false)
      if (upload.current) upload.current.value = ''
    }
  }
  return {artifact, setArtifact, artifactMarks, setArtifactMarks, source, setSource, loadingArtifact, upload, openArtifact}
}
