import {useEffect, useReducer, useState} from 'react'
import {runningIndicator} from './running.js'
import type {Running} from './running.js'

/**
 * The job an indicator shows (`runningIndicator`): only once it has run a moment, then for at least a moment, so short
 * jobs never flash it. `undefined` while nothing shows.
 */
export function useRunningIndicator(running: Running | null | undefined): Running | undefined {
  const [, changed] = useReducer((count: number) => count + 1, 0)
  const [indicator] = useState(() => runningIndicator(changed))
  useEffect(() => {
    const before = indicator.current
    indicator.set(running ?? undefined)
    if (indicator.current !== before) changed()
  }, [indicator, running])
  useEffect(() => () => indicator.dispose(), [indicator])
  return indicator.current
}
