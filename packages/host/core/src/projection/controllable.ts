import type {SettingKey, Settings} from './settings-store.js'

export {positionOn, speedRange, unit} from './settings-store.js'

/** Reads a value: the embedder's when it controls it, else the core's own. */
export type ValueOf = <K extends SettingKey>(key: K) => Settings[K]

/** Requests a change: updates the core's own value when uncontrolled, and always notifies. */
export type RequestChange = <K extends keyof Settings>(key: K, next: Settings[K]) => void
