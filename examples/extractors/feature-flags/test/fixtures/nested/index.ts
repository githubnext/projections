import { client as flags } from "provider"; export function enabled() { return flags.variation("user", "new-ui"); }
