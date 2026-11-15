//! Sandboxed host for Projections' comparators.
//!
//! A custom comparator is a rules file ([`ComparatorModule::load_rules`]), run
//! by the rules interpreter, `rules.wasm`; the default comparator runs as
//! `default-comparator.wasm`. Both are Projections' own WebAssembly modules, and this
//! runtime is their sandbox: users don't supply modules.
//!
//! The modules share an internal ABI: **zero imports**, and the exports
//! `memory`, `projections_alloc(len: i32) -> i32` and
//! `projections_compare(ptr: i32, len: i32) -> i64`. The host writes the UTF-8
//! JSON input at the pointer returned by `projections_alloc`, calls
//! `projections_compare`, and reads the UTF-8 JSON output described by the packed
//! `(ptr << 32) | len` return value. The output is either a comparison or
//! `{"error": "message"}`. The interpreter also exports
//! `projections_rules_inspect`, which checks a rules file, and
//! `projections_rules_cover`, which compares with rule coverage
//! ([`ComparatorModule::compare_with_coverage`]).
//!
//! Every run uses a fresh instance in a fresh store with no host functions, a
//! fuel (instruction) budget and a memory cap, so execution is deterministic and
//! bounded. Any trap, exceeded bound, malformed return value or malformed output
//! is an explicit [`ComparatorError`]; the host never substitutes another result.
//!
//! The runtime checks the input and output envelopes structurally. Validating a
//! comparison against both extractions is the Engine's responsibility.

mod digest;
mod envelope;
mod error;
mod limiter;
mod module;

pub use self::digest::{digest, interpreter_digest, rules_digest};
pub use self::error::ComparatorError;
pub use self::module::ComparatorModule;

/// The comparison protocol version this runtime speaks.
pub const PROTOCOL_VERSION: u64 = 0;
/// Name of the exported linear memory.
pub const MEMORY_EXPORT: &str = "memory";
/// Name of the exported allocator: `(len: i32) -> i32`.
pub const ALLOC_EXPORT: &str = "projections_alloc";
/// Name of the exported comparison entry point: `(ptr: i32, len: i32) -> i64`.
pub const COMPARE_EXPORT: &str = "projections_compare";

/// Default execution budget in Wasmi fuel units (roughly one per instruction).
///
/// In an optimized build this is roughly 30 seconds of a tight loop on a
/// current laptop. The default comparator spends well under it on a 10 MiB
/// input with 10,000 entities, 50,000 relationships and 10,000 changes.
pub const DEFAULT_FUEL: u64 = 100_000_000_000;
/// Default linear memory cap: 256 MiB.
pub const DEFAULT_MAX_MEMORY_BYTES: usize = 256 * 1024 * 1024;
/// Default input size cap: 32 MiB.
pub const DEFAULT_MAX_INPUT_BYTES: usize = 32 * 1024 * 1024;
/// Default output size cap: 32 MiB.
pub const DEFAULT_MAX_OUTPUT_BYTES: usize = 32 * 1024 * 1024;
/// Maximum elements per table. Tables are host-allocated, so they are bounded too.
pub const MAX_TABLE_ELEMENTS: usize = 1_000_000;
const MAX_TABLES: usize = 16;
const LISTED_IMPORTS: usize = 5;

const INPUT_FIELDS: [&str; 5] = ["protocolVersion", "before", "after", "baseline", "options"];
const COMPARISON_FIELDS: [&str; 7] = [
    "protocolVersion",
    "changes",
    "steps",
    "order",
    "reverseSteps",
    "variation",
    "metadata",
];

/// Bounds applied to one comparator run.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Limits {
    /// Fuel available to instantiation and the call; exhausting it stops the run.
    pub fuel: u64,
    /// Maximum size of the module's linear memory in bytes.
    pub max_memory_bytes: usize,
    /// Maximum size of the input JSON in bytes.
    pub max_input_bytes: usize,
    /// Maximum size of the output JSON in bytes.
    pub max_output_bytes: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            fuel: DEFAULT_FUEL,
            max_memory_bytes: DEFAULT_MAX_MEMORY_BYTES,
            max_input_bytes: DEFAULT_MAX_INPUT_BYTES,
            max_output_bytes: DEFAULT_MAX_OUTPUT_BYTES,
        }
    }
}

/// The rules comparator module's export that checks a rules file.
pub const RULES_INSPECT_EXPORT: &str = "projections_rules_inspect";
/// The rules comparator module's export that compares with rule coverage.
pub const RULES_COVER_EXPORT: &str = "projections_rules_cover";

/// Fuel for a rules comparison. The rules interpreter spends most of its
/// time allocating, which the interpreter runs slowly; a limit-sized
/// comparison (10,000 entities, 50,000 changed relationships) with a rule
/// evaluated for every change needs about 4 × 10¹¹. The rules' own cost
/// budget bounds their work deterministically; fuel only guards the
/// interpreter itself.
pub const DEFAULT_RULES_FUEL: u64 = 1_000_000_000_000;

impl Limits {
    /// The default limits for a rules comparator.
    pub fn rules() -> Self {
        Self {
            fuel: DEFAULT_RULES_FUEL,
            ..Self::default()
        }
    }
}

/// The custom section in which the rules interpreter's build records its
/// identity, a digest of the source it was built from.
pub const INTERPRETER_SECTION: &str = "projections.interpreter";

/// Whether `path` names a comparator file: `<name>.comparator.yaml` or
/// `<name>.comparator.yml`.
pub fn is_comparator_file(path: &str) -> bool {
    path.ends_with(".comparator.yaml") || path.ends_with(".comparator.yml")
}
