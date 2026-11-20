// The React adapter: one actor per component, started in a layout effect so its activities run before paint and a
// state an event changes there renders before paint too.
import {useEffect, useLayoutEffect, useRef, useState} from 'react'
import {createActor, type Actor, type ActorOptions} from './actor.js'
import type {Machine, MachineActivity, MachineEffect, MachineEvent, MachineState} from './machine.js'

const useLifecycleEffect = typeof document === 'undefined' ? useEffect : useLayoutEffect

type Runners = Record<string, (task: never, context: never) => unknown>

/**
 * Runs `machine` for the component's lifetime: `[state, send, actor]`. The actor is created on the first render from
 * `options.state`; later renders' runners and `onError` are used as they are, so they may close over props. The actor
 * starts in a layout effect and stops on unmount (and starts again after React's development remount). Events sent
 * before it starts, for example from a child's layout effect, wait for it. A change made in a layout effect renders
 * before paint, as a `setState` there would.
 */
export function useMachine<S extends MachineState, E extends MachineEvent, F extends MachineEffect, A extends MachineActivity>(
  machine: Machine<S, E, F, A>,
  options: ActorOptions<NoInfer<S>, NoInfer<E>, NoInfer<F>, NoInfer<A>>,
): readonly [S, (event: E) => void, Actor<S, E>] {
  const latest = useRef(options)
  latest.current = options
  const [actor] = useState(() => {
    const delegate = (field: 'effects' | 'activities') => {
      const initial = options[field] as Runners | undefined
      if (!initial) return undefined
      const runners: Runners = {}
      for (const type of Object.keys(initial)) runners[type] = (task, context) => (latest.current[field] as Runners)[type]!(task, context)
      return runners
    }
    const onError = options.onError && ((error: unknown) => latest.current.onError?.(error))
    return createActor(machine, {
      state: options.state,
      ...(onError ? {onError} : {}),
      effects: delegate('effects'),
      activities: delegate('activities'),
    } as unknown as ActorOptions<S, E, F, A>)
  })
  const [state, setState] = useState(actor.getState)
  useLifecycleEffect(() => {
    const unsubscribe = actor.subscribe(setState)
    actor.start()
    setState(actor.getState())
    return () => {
      unsubscribe()
      actor.stop()
    }
  }, [actor])
  return [state, actor.send, actor]
}
