import {useEffect, useState} from 'react'
import type {SummaryNouns} from '@githubnext/projections-renderer-sdk/presentation'

/**
 * Names the renderer's kinds in the host's summary bar (`RendererProps.declareNouns`): `{package: {singular:
 * 'workspace', plural: 'workspaces'}}`, `false` to leave a kind out. The kinds an object lists come first, in its
 * order. Pass a stable value (memoize a function); `undefined` returns to `MountOptions.nouns`.
 */
export function useSummaryNouns(declare: (nouns: SummaryNouns | undefined) => void, nouns: SummaryNouns | undefined): void {
  // The nouns as they were when their value last changed, so an equal object passed again declares nothing.
  const key = typeof nouns === 'function' ? nouns : JSON.stringify(nouns ?? null)
  const [declared, setDeclared] = useState({key, nouns})
  if (declared.key !== key) setDeclared({key, nouns})
  useEffect(() => {
    declare(declared.nouns)
  }, [declare, declared])
}
