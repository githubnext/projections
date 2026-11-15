declare module '@reduxjs/toolkit' {
  export function createSlice<R, S>(options: { name: string; initialState: unknown; reducers: R; selectors?: S; extraReducers?: (builder: any) => void }): { actions: R; selectors: S };
}
declare module 'flags' {
  export function enabled(name: string): boolean;
  export function variation(user: string, name: string): boolean;
}
declare module 'messages' {
  export function on(event: string, handler: (payload: unknown) => void): void;
  export function registry(handlers: Record<string, (payload: unknown) => void>): void;
  export function handles(event: string): MethodDecorator;
  export function emit(event: string, payload?: unknown): void;
}
declare module 'express' {
  export interface Application {
    get(path: string, ...handlers: Function[]): Application;
    post(path: string, ...handlers: Function[]): Application;
    route(path: string): ChainedRoute;
    use(path: string, router: Application): void;
  }
  export interface ChainedRoute { get(...handlers: Function[]): ChainedRoute; post(...handlers: Function[]): ChainedRoute }
  export function Router(): Application;
  export default function express(): Application;
}
declare module 'fastify' {
  export interface Server {
    get(path: string, ...handlers: Function[]): void;
    route(options: { method: string | string[]; url: string; handler: Function }): void;
    register(plugin: Function, options: { prefix: string }): void;
  }
  export default function fastify(): Server;
}
