//! Resolves parsed Prisma schema files into one validated data model.
//!
//! This applies the rules that determine the extraction: type and attribute
//! resolution, relation pairing, index arguments and default values. Validation
//! is deliberately limited to what the extraction depends on plus common
//! structural mistakes; connector-specific capability checks (which index types
//! or native types a database supports) remain Prisma's.

mod attributes;
mod context;
mod datetime;
mod defaults;
mod enums;
mod fields;
mod indexes;
mod relations;
mod resolve;
mod types;

pub use resolve::resolve;
pub use types::*;

#[cfg(test)]
mod tests;
