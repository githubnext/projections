/// <reference types="vite/client" />

declare module 'virtual:projections-scenarios' {
  import type {Fixture} from './fixtures.js'
  const scenarios: Fixture[]
  export default scenarios
}
