import { on, emit } from "messages"; const Topics = { Created: "created" } as const;
export function receive(payload: unknown): void {}
on("created", receive); on("archived", receive);
export function create(): void { emit(Topics.Created, {}); }
export function dynamic(name: string): void { emit(name); }
