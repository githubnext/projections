//! Shared support for the Swift extractors: a Swift lexer, the package
//! manifest read without running it or from `swift package dump-package`,
//! `Package.resolved`, and a file's imports. It registers no extractor itself.

pub mod imports;
pub mod lexer;
pub mod manifest;
pub mod packages;
pub mod resolved;
pub mod syntax;

pub use imports::{Import, imports};
pub use manifest::{Manifest, Unsupported, identity};
pub use resolved::Pin;
