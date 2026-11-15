//! Volatile data: values an extractor declares may vary between runs at the
//! same revision, such as durations, sample counts or measured means, and how
//! much variation is expected.
//!
//! An extraction declares them in its top-level `volatile` list. Each
//! declaration names a collection, optionally some kinds, a JSON pointer under
//! `/data/` (where a `*` segment matches any object key or array index) and an
//! optional tolerance. IDs, kinds, labels and endpoints are never volatile, so
//! identity and matching are unaffected; only a matched pair's status depends
//! on volatility.
//!
//! Comparators stay deterministic: this module is the single definition of
//! which differences are expected variation ("within"), used by the default
//! comparator, rules comparators, comparison validation and rerun checks.

mod assess;
mod basis;
mod declaration;
mod generated;
pub(crate) mod paths;
mod rerun;
mod tolerance;

pub use crate::model::variation;
pub use crate::parse::{Generated, basis_digest, generated_values, vary};
pub use assess::{Assessment, Declarations, Varied, same_content};
pub(crate) use basis::check_bases;
pub use declaration::{Declaration, Pointer, Tolerance};
pub(crate) use declaration::{unvaried_bases, within_path};
pub use generated::{GeneratedValue, generated, regenerated_because, sha256};
pub use rerun::{Beyond, Variation, Within, rerun};

/// Most declarations one extraction may make.
pub const MAX_DECLARATIONS: usize = 256;
/// Longest declared pointer, in bytes.
pub const MAX_POINTER_BYTES: usize = 1024;
/// Most named parts one basis may have.
pub const MAX_BASIS_PARTS: usize = 16;
/// Longest value of one basis part, in UTF-8 bytes.
pub const MAX_BASIS_PART_BYTES: usize = 256;
