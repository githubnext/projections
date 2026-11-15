import { on as listen, registry, handles } from "messages"; import { receive as process } from "./handler.js";
listen("created", process); registry({ deleted: process });
class Worker { @handles("updated") run(payload: unknown): void {} }
