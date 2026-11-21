//! The Engine's boundary, and the only place it reads or writes JSON: strict
//! parsing within size limits, reading extractions and comparisons into the
//! typed model ([`crate::model`]) once, writing the model back, canonical
//! bytes and digests (which the protocol defines over JSON), and the request
//! ABI. The core works on the model alone.

mod api;
mod comparison;
mod datum;
mod encode;
mod extraction;
mod fields;
mod items;
mod json;
mod request;
mod volatile;

pub use api::{
    Generated, basis_digest, canonical, canonicalize, check_comparison, content, content_value, generated_values, normalize, parse_json,
    semantic, validate_comparison, vary,
};
pub(crate) use fields::{choice, object};
pub use request::{diagnostic_response, handle};
