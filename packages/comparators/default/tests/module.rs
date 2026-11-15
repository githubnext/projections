//! The comparator module ABI requires zero imports and three exports. This
//! builds the module from the current source and inspects its sections.

use std::path::{Path, PathBuf};
use std::process::Command;

fn leb(bytes: &[u8], cursor: &mut usize) -> u64 {
    let (mut value, mut shift) = (0u64, 0);
    loop {
        let byte = bytes[*cursor];
        *cursor += 1;
        value |= u64::from(byte & 0x7f) << shift;
        if byte & 0x80 == 0 {
            return value;
        }
        shift += 7;
    }
}

fn name(bytes: &[u8], cursor: &mut usize) -> String {
    let length = leb(bytes, cursor) as usize;
    let value = String::from_utf8(bytes[*cursor..*cursor + length].to_vec()).unwrap();
    *cursor += length;
    value
}

struct Module {
    imports: u64,
    types: Vec<(Vec<u8>, Vec<u8>)>,
    functions: Vec<u64>,
    exports: Vec<(String, u8, u64)>,
    memory_maximum: Option<u64>,
}

fn inspect(bytes: &[u8]) -> Module {
    assert_eq!(&bytes[..8], b"\0asm\x01\0\0\0", "core WebAssembly module, version 1");
    let mut module = Module {
        imports: 0,
        types: Vec::new(),
        functions: Vec::new(),
        exports: Vec::new(),
        memory_maximum: None,
    };
    let mut cursor = 8;
    while cursor < bytes.len() {
        let id = bytes[cursor];
        cursor += 1;
        let size = leb(bytes, &mut cursor) as usize;
        let end = cursor + size;
        let mut at = cursor;
        match id {
            1 => {
                for _ in 0..leb(bytes, &mut at) {
                    assert_eq!(bytes[at], 0x60, "function type");
                    at += 1;
                    let parameters = leb(bytes, &mut at) as usize;
                    let params = bytes[at..at + parameters].to_vec();
                    at += parameters;
                    let results = leb(bytes, &mut at) as usize;
                    let outputs = bytes[at..at + results].to_vec();
                    at += results;
                    module.types.push((params, outputs));
                }
            }
            2 => module.imports = leb(bytes, &mut at),
            3 => {
                for _ in 0..leb(bytes, &mut at) {
                    module.functions.push(leb(bytes, &mut at));
                }
            }
            5 => {
                assert_eq!(leb(bytes, &mut at), 1, "one memory");
                let flags = leb(bytes, &mut at);
                leb(bytes, &mut at);
                if flags & 1 == 1 {
                    module.memory_maximum = Some(leb(bytes, &mut at));
                }
            }
            7 => {
                for _ in 0..leb(bytes, &mut at) {
                    let export = name(bytes, &mut at);
                    let kind = bytes[at];
                    at += 1;
                    module.exports.push((export, kind, leb(bytes, &mut at)));
                }
            }
            _ => {}
        }
        cursor = end;
    }
    module
}

fn build() -> PathBuf {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let target = root.join("target/comparator-module-test");
    let status = Command::new(std::env::var("CARGO").unwrap_or_else(|_| "cargo".into()))
        .current_dir(&root)
        .args([
            "rustc",
            "--locked",
            "--release",
            "-p",
            "projections-comparator-default",
            "--target",
            "wasm32-unknown-unknown",
            "--lib",
            "--crate-type",
            "cdylib",
            "--target-dir",
        ])
        .arg(&target)
        .args(["--", "-C", "link-arg=--max-memory=268435456"])
        .env_remove("RUSTC_WORKSPACE_WRAPPER")
        .env_remove("RUSTC_WRAPPER")
        .env_remove("CARGO_ENCODED_RUSTFLAGS")
        .env_remove("RUSTFLAGS")
        .status()
        .expect("run cargo");
    assert!(status.success(), "build the comparator module");
    target.join("wasm32-unknown-unknown/release/projections_comparator_default.wasm")
}

#[test]
fn module_has_zero_imports_and_the_comparator_abi_exports() {
    let module = inspect(&std::fs::read(build()).unwrap());
    assert_eq!(module.imports, 0, "comparator modules must not import anything");
    let export = |wanted: &str| {
        module
            .exports
            .iter()
            .find(|(name, _, _)| name == wanted)
            .unwrap_or_else(|| panic!("missing export {wanted}"))
    };
    assert_eq!(export("memory").1, 2, "memory export");
    // No imports, so function indexes start at the module's own functions.
    let signature = |name: &str| {
        let (_, kind, index) = export(name);
        assert_eq!(*kind, 0, "{name} is a function");
        module.types[module.functions[*index as usize] as usize].clone()
    };
    assert_eq!(signature("projections_alloc"), (vec![0x7f], vec![0x7f]));
    assert_eq!(signature("projections_compare"), (vec![0x7f, 0x7f], vec![0x7e]));
    assert_eq!(
        module.memory_maximum,
        Some(256 * 1024 * 1024 / 65536),
        "the module bounds its own memory to the default host limit"
    );
}
