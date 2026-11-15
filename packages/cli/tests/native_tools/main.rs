//! Opt-in qualification of the built-in extractors against real ecosystem tools.
//!
//! Each suite runs only when explicitly selected through its environment switch;
//! once selected, a missing tool or failed build fails the test rather than skipping.
//! `PROJECTIONS_NATIVE_TESTS=1` selects the .NET and Django suites,
//! `PROJECTIONS_NATIVE_DOTNET=1` only .NET, `PROJECTIONS_DJANGO_PYTHON` only Django,
//! `PROJECTIONS_NATIVE_SPRING=1` only Spring Boot (a JDK, Gradle and Maven; also
//! selected by `PROJECTIONS_NATIVE_TESTS`),
//! `PROJECTIONS_NATIVE_RUST=1` only the Rust public API (a nightly toolchain,
//! `PROJECTIONS_RUST_NIGHTLY`), and `PROJECTIONS_NATIVE_ECOSYSTEMS=1` the Cargo,
//! NuGet, Go helper, Rust public API, Terraform and SCIP (`PROJECTIONS_SCIP_TYPESCRIPT`) suites.

mod common;
mod django;
mod dotnet;
mod go;
mod rust;
mod scip;
mod spring;
mod terraform;
