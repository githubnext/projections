//! The `projections` Python module (`packages/cli/python/projections`), which
//! lets a Python extractor read its request and write its extraction without
//! handling the protocol's JSON. It is embedded in this executable and
//! unpacked into the per-user cache on first use; the runner prepends its
//! directory to a custom extractor's `PYTHONPATH`, so it needs no install.

use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};

use anyhow::Result;

/// The variable that names the module's directory to Python.
pub const VARIABLE: &str = "PYTHONPATH";

/// Where the module's directory is mounted in a container.
pub const CONTAINER_DIRECTORY: &str = "/projections/python";

const FILES: &[crate::cache::Entry] = &[("projections/__init__.py", include_bytes!("../python/projections/__init__.py"))];

/// The directory holding the `projections` module, unpacked and verified under the cache base `base`.
pub fn directory_in(base: &Path) -> Result<PathBuf> {
    crate::cache::unpack(base, env!("CARGO_PKG_VERSION"), FILES)
}

/// `environment`'s `PYTHONPATH` with `directory` first, before any `PYTHONPATH` it already has (one that
/// `execution.environment` passes through), joined with `separator`.
pub fn prepend(environment: &mut BTreeMap<String, String>, directory: &str, separator: char) {
    let value = match environment.get(VARIABLE).filter(|value| !value.is_empty()) {
        Some(existing) => format!("{directory}{separator}{existing}"),
        None => directory.to_owned(),
    };
    environment.insert(VARIABLE.into(), value);
}

/// The separator of this platform's search paths.
pub const SEPARATOR: char = if cfg!(windows) { ';' } else { ':' };

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_module_goes_before_a_pythonpath_passed_through() {
        let mut environment = BTreeMap::new();
        prepend(&mut environment, "/cache/python", ':');
        assert_eq!(environment[VARIABLE], "/cache/python");
        environment.insert(VARIABLE.into(), "/mine".into());
        prepend(&mut environment, "/cache/python", ':');
        assert_eq!(environment[VARIABLE], "/cache/python:/mine");
    }

    #[test]
    fn the_module_unpacks_into_the_cache() {
        let base = tempfile::tempdir().unwrap();
        let directory = directory_in(base.path()).unwrap();
        let module = std::fs::read_to_string(directory.join("projections/__init__.py")).unwrap();
        assert!(module.contains("def result("), "{module}");
        assert_eq!(directory_in(base.path()).unwrap(), directory, "a second use reuses it");
    }
}
