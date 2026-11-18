//! Shared support for the Swift extractors: a Swift lexer, the package
//! manifest read without running it or from `swift package dump-package`,
//! and `Package.resolved`. It registers no extractor itself.

pub mod lexer;
pub mod manifest;
pub mod packages;
pub mod resolved;
pub mod syntax;

pub use manifest::{Manifest, Unsupported, identity};
pub use resolved::Pin;
