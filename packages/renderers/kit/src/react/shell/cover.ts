import {useMemo} from 'react'
import {parseStageCover, type CoverRect} from '../../fit.js'

/**
 * The host's `stage-cover` token as rectangles (`parseStageCover`), kept while the token is unchanged. A new cover is
 * fitted to at once: the content never zooms or slides to it.
 */
export function useStageCoverOf(token: string | undefined): readonly CoverRect[] | undefined {
  return useMemo(() => parseStageCover(token), [token])
}
