//! The extractor helpers for Node (`packages/cli/node`): `@githubnext/projections/extractor`, the same module the npm
//! package exports, bundled into one file, which lets a JavaScript or TypeScript extractor read its request and write
//! its extraction without handling the protocol's JSON. It is embedded in this executable and unpacked into the
//! per-user cache on first use. ECMAScript modules don't search `NODE_PATH`, so for a custom extractor whose program
//! is the bare name `node` the runner preloads `register.cjs` (`node --require`), whose resolve hook maps that one
//! specifier to the module: `import {request, result} from '@githubnext/projections/extractor'` then works with
//! nothing installed, from `.mjs`, `.js` and `.ts` alike.

use std::path::{Path, PathBuf};

use anyhow::Result;

/// Where the module's directory is mounted in a container.
pub const CONTAINER_DIRECTORY: &str = "/projections/node";

/// The file `node --require` preloads, in the module's directory.
pub const PRELOAD: &str = "register.cjs";

const FILES: &[crate::cache::Entry] = &[
    ("extractor.mjs", include_bytes!("../node/extractor.mjs")),
    ("hooks.mjs", include_bytes!("../node/hooks.mjs")),
    ("register.cjs", include_bytes!("../node/register.cjs")),
];

/// The directory holding the module, unpacked and verified under the cache base `base`.
pub fn directory_in(base: &Path) -> Result<PathBuf> {
    crate::cache::unpack(base, env!("CARGO_PKG_VERSION"), FILES)
}

/// `argv` with `preload` (the path of [`PRELOAD`]) preloaded, when its program is the bare name `node`; any other
/// argv, including a path to a Node executable, as it is.
pub fn preload(argv: &[String], preload: &str) -> Vec<String> {
    match argv.split_first() {
        Some((program, rest)) if program == "node" => [program.clone(), "--require".into(), preload.into()]
            .into_iter()
            .chain(rest.iter().cloned())
            .collect(),
        _ => argv.to_vec(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{collections::BTreeMap, process::Command};

    fn argv(parts: &[&str]) -> Vec<String> {
        parts.iter().map(|part| (*part).to_owned()).collect()
    }

    #[test]
    fn a_bare_node_preloads_the_module_and_other_programs_run_as_written() {
        assert_eq!(
            preload(&argv(&["node", "--no-warnings", "extract.mjs"]), "/cache/register.cjs"),
            argv(&["node", "--require", "/cache/register.cjs", "--no-warnings", "extract.mjs"])
        );
        for written in [
            argv(&["python3", "x.py"]),
            argv(&["/usr/bin/node", "x.mjs"]),
            argv(&["npx", "tsx", "x.ts"]),
        ] {
            assert_eq!(preload(&written, "/cache/register.cjs"), written);
        }
    }

    #[test]
    fn the_module_unpacks_into_the_cache() {
        let base = tempfile::tempdir().unwrap();
        let directory = directory_in(base.path()).unwrap();
        let module = std::fs::read_to_string(directory.join("extractor.mjs")).unwrap();
        assert!(module.contains("function result("), "{module}");
        assert!(directory.join(PRELOAD).is_file());
        assert_eq!(directory_in(base.path()).unwrap(), directory, "a second use reuses it");
    }

    #[test]
    fn an_extractor_imports_the_module_with_nothing_installed() {
        let Some(node) = crate::runtime::which_in("node", &std::env::var_os("PATH").unwrap_or_default()) else {
            return;
        };
        let base = tempfile::tempdir().unwrap();
        let directory = directory_in(base.path()).unwrap();
        let project = tempfile::tempdir().unwrap();
        std::fs::write(
            project.path().join("extract.mjs"),
            "import {request, result} from '@githubnext/projections/extractor'\n\
             result({entities: {[`project:${request.project}`]: {kind: 'project', label: request.id}}})\n",
        )
        .unwrap();
        let mut argv = preload(&argv(&["node", "extract.mjs"]), directory.join(PRELOAD).to_str().unwrap());
        argv[0] = node.to_string_lossy().into_owned();
        let environment: BTreeMap<String, String> = std::env::vars()
            .filter(|(name, _)| name == "PATH" || name == "SystemRoot")
            .collect();
        let mut child = Command::new(&argv[0])
            .args(&argv[1..])
            .current_dir(project.path())
            .env_clear()
            .envs(&environment)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .unwrap();
        use std::io::Write;
        child
            .stdin
            .take()
            .unwrap()
            .write_all(br#"{"protocolVersion":0,"projection":{"id":"x","definition":{}},"repository":{"root":"/r","project":"a"},"capabilities":{"trusted":true,"network":false}}"#)
            .unwrap();
        let output = child.wait_with_output().unwrap();
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        assert_eq!(
            String::from_utf8(output.stdout).unwrap(),
            r#"{"protocolVersion":0,"schema":"graph/v0","entities":[{"id":"project:a","kind":"project","label":"x"}],"relationships":[]}"#
        );
        assert_eq!(
            std::fs::read_dir(&directory).unwrap().count(),
            FILES.len(),
            "running the module leaves its cache directory as it was unpacked"
        );
    }
}
