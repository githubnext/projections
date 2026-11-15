import {useEffect} from 'react'
import type {SummaryNouns} from '@githubnext/projections-renderer-sdk/presentation'

/**
 * Names the renderer's kinds in the host's summary bar (`RendererProps.declareNouns`): `{package: {singular:
 * 'workspace', plural: 'workspaces'}}`, `false` to leave a kind out. The kinds an object lists come first, in its
 * order. Pass a stable value (memoize a function); `undefined` returns to `MountOptions.nouns`.
 */
export function useSummaryNouns(declare: (nouns: SummaryNouns | undefined) => void, nouns: SummaryNouns | undefined): void {
  const key = typeof nouns === 'function' ? nouns : JSON.stringify(nouns ?? null)
  useEffect(() => {
    declare(nouns)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [declare, key])
}
