//! The Engine's formally verified decisions.
//!
//! Each function here carries a [Verus](https://github.com/verus-lang/verus)
//! specification, and Verus proves the code meets it for every input. The
//! specifications are the promises in `packages/engine/VERIFICATION.md`; each clause
//! has the plain-English comment that document quotes. Ordinary builds expand
//! `verus!` into the plain Rust it contains, so the Engine runs exactly the
//! code that was proved.
//!
//! - [`content`]: no residual difference means two items' data is equal
//!   outside the paths their volatile declarations cover.
//! - [`correspondence`]: which shapes a change may have, the same rule for the
//!   default comparator and for the Engine's check of every comparator; no
//!   accepted change is many-to-many, and a change is accepted exactly when
//!   its mirror image is.
//! - [`components`]: claim groups and presentation groups are exactly the
//!   items a chain of links joins.
//! - [`keys`]: a key identity pass pairs exactly the items whose key is unique
//!   on both sides, and no item twice.
//! - [`tolerance`]: tolerance decisions are monotonic, and combining two
//!   declarations is no looser than either, over named IEEE 754 facts.
//! - [`unchanged`]: the default comparator and the Engine agree on status,
//!   and nothing called unchanged or left out differs beyond variation.
//! - [`generated`]: a generated value is judged by its basis.
//! - [`sort`]: the canonical order normalization puts every list in.
//! - [`waves`]: the default comparator's steps play backwards as the
//!   reverse comparison's.

#![no_std]

extern crate alloc;

pub mod components;
pub mod content;
pub mod correspondence;
pub mod datum;
pub mod generated;
pub mod keys;
pub mod sort;
pub mod tolerance;
pub mod unchanged;
pub mod waves;

pub use correspondence::{Correspondence, Status};
