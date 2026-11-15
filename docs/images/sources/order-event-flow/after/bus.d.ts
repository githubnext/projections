declare module '@shop/bus' {
  export function subscribe(event: string, handler: (payload: unknown) => Promise<void>): void
  export function publish(event: string, payload: unknown): Promise<void>
}
