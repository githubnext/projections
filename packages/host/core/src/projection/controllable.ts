import {useCallback, useRef, useState} from 'react'
import {initialSettings, notifySetting, requestedSettings, settingValue} from './settings-store.js'
import type {SettingKey, Settings} from './settings-store.js'
import type {ProjectionOptions} from './types.js'

export {positionOn, speedRange, unit} from './settings-store.js'

export type Internal = Settings

/** Reads a value: the embedder's when it controls it, else the core's own. */
export type ValueOf = <K extends SettingKey>(key: K) => Internal[K]

/** Requests a change: updates internal state when uncontrolled, and always notifies. */
export type RequestChange = <K extends keyof Internal>(key: K, next: Internal[K]) => void

/**
 * Every value the embedder may control (pass it with its `on…Change` handler) or leave to the core (optionally seeded
 * with `initial…`), and `latest`, the options of the latest render for callbacks that outlive it. The rules are the
 * framework-free settings reducer's (`settings-store.ts`); this runs them in a component's state.
 */
export function useControllable(options: ProjectionOptions) {
  const latest = useRef(options)
  latest.current = options
  const [internal, setInternal] = useState(() => initialSettings(options))
  const value: ValueOf = key => settingValue(internal, options, key)
  const request = useCallback<RequestChange>((key, next) => {
    const current = latest.current
    setInternal(previous => requestedSettings(previous, current, key, next))
    notifySetting(current, key, next)
  }, [])
  return {latest, internal, setInternal, value, request}
}

export type Controllable = ReturnType<typeof useControllable>
