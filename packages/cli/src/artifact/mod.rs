//! Projection artifacts: definitions, extraction documents and comparison
//! documents, validated strictly, and read from disk without following links.

mod comparison;
mod definition;
mod execution;
mod extraction;
mod io;
mod presentation;
mod upstream;
mod values;

pub use comparison::{
    DEFAULT_COMPARATOR, MAX_NOTICES, compare_extractions, compare_extractions_from, compare_extractions_with, custom_comparator,
    default_comparator, default_comparator_options, default_comparison, load_comparator, missing_input_notice, missing_input_notices,
    missing_inputs, notices, pairing_mismatch, revision_name, run_custom_comparator, run_custom_comparator_with_coverage, set_notices,
    validate_comparison, validate_comparison_with,
};
pub use definition::{COMPARATOR_DOCS, definition_sources, scope, semantic_definition, validate_definition};
pub use execution::validate_execution;
pub use extraction::{extractor_id, validate_extraction};
pub use io::{MAX_ARTIFACT_BYTES, MAX_DOCUMENT_BYTES, base64, byte_sha256, read_artifact, read_document};
pub(crate) use presentation::presentation_defaults;
pub use values::{FieldError, error_pointer, locate, parse};
pub(crate) use values::{fields, identifier, object, text};
