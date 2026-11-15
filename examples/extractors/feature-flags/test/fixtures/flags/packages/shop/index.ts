import * as flags from "flags"; const KEY = "checkout";
export function view() { return flags.enabled(KEY); }
export function dynamic(key: string) { return flags.enabled(key); }
function enabled(key: string) { return true; } enabled("decoy");
