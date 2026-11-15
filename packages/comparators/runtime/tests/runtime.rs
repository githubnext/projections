use projections_comparator_runtime::{ComparatorError, ComparatorModule, Limits, digest, interpreter_digest};

const INPUT: &[u8] = br#"{"protocolVersion":0,"before":{},"after":{},"baseline":{},"options":{}}"#;
const COMPARISON: &str = r#"{"protocolVersion":0,"changes":[],"steps":[],"metadata":{}}"#;

fn escape(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("\\{byte:02x}")).collect()
}

/// A module whose `projections_compare` runs `body` and returns `(0 << 32) | len`
/// of `output`, stored at address 0. Input is written at 4096.
fn module(output: &[u8], body: &str) -> Vec<u8> {
    module_with(output, body, "")
}

fn module_with(output: &[u8], body: &str, extra: &str) -> Vec<u8> {
    wat::parse_str(format!(
        r#"(module
            (memory (export "memory") 2)
            (data (i32.const 0) "{data}")
            (func (export "projections_alloc") (param i32) (result i32) (i32.const 4096))
            (func (export "projections_compare") (param i32 i32) (result i64)
                {body}
                (i64.const {length}))
            {extra})"#,
        data = escape(output),
        length = output.len(),
    ))
    .unwrap()
}

fn run(bytes: &[u8], limits: &Limits) -> Result<Vec<u8>, ComparatorError> {
    ComparatorModule::load(bytes)?.run(INPUT, limits)
}

fn small() -> Limits {
    Limits {
        fuel: 1_000_000,
        max_memory_bytes: 2 * 1024 * 1024,
        ..Limits::default()
    }
}

#[test]
fn returns_the_comparison() {
    let bytes = module(COMPARISON.as_bytes(), "");
    let comparator = ComparatorModule::load(&bytes).unwrap();
    assert_eq!(comparator.digest(), digest(&bytes));
    let output = comparator.run(INPUT, &Limits::default()).unwrap();
    assert_eq!(output, COMPARISON.as_bytes());
    // Runs are independent and deterministic.
    assert_eq!(comparator.run(INPUT, &Limits::default()).unwrap(), output);
    let value = comparator
        .compare(&serde_json::from_slice(INPUT).unwrap(), &Limits::default())
        .unwrap();
    assert_eq!(value, serde_json::from_str::<serde_json::Value>(COMPARISON).unwrap());
}

#[test]
fn passes_the_input_through_memory() {
    // Traps unless the input arrives at the allocated pointer with its length.
    let body = format!(
        "(if (i32.ne (local.get 0) (i32.const 4096)) (then unreachable))
         (if (i32.ne (local.get 1) (i32.const {length})) (then unreachable))
         (if (i32.ne (i32.load8_u (i32.const 4096)) (i32.const 0x7b)) (then unreachable))
         (if (i32.ne (i32.load8_u (i32.const {last})) (i32.const 0x7d)) (then unreachable))",
        length = INPUT.len(),
        last = 4096 + INPUT.len() - 1,
    );
    let bytes = module(COMPARISON.as_bytes(), &body);
    assert_eq!(run(&bytes, &Limits::default()).unwrap(), COMPARISON.as_bytes());
}

#[test]
fn rejects_imports() {
    let bytes = wat::parse_str(
        r#"(module
            (import "env" "clock" (func))
            (import "wasi_snapshot_preview1" "fd_write" (func (param i32 i32 i32 i32) (result i32)))
            (memory (export "memory") 1)
            (func (export "projections_alloc") (param i32) (result i32) (i32.const 0))
            (func (export "projections_compare") (param i32 i32) (result i64) (i64.const 0)))"#,
    )
    .unwrap();
    let error = ComparatorModule::load(&bytes).unwrap_err();
    assert_eq!(
        error,
        ComparatorError::ForbiddenImport {
            imports: vec!["env.clock".into(), "wasi_snapshot_preview1.fd_write".into()],
            count: 2,
        }
    );
    assert_eq!(error.code(), "forbidden-import");
    assert!(error.to_string().contains("zero imports"), "{error}");

    let memory = wat::parse_str(
        r#"(module
            (import "env" "memory" (memory 1))
            (export "memory" (memory 0))
            (func (export "projections_alloc") (param i32) (result i32) (i32.const 0))
            (func (export "projections_compare") (param i32 i32) (result i64) (i64.const 0)))"#,
    )
    .unwrap();
    assert_eq!(ComparatorModule::load(&memory).unwrap_err().code(), "forbidden-import");
}

#[test]
fn rejects_missing_and_mistyped_exports() {
    let load = |source: &str| ComparatorModule::load(&wat::parse_str(source).unwrap()).unwrap_err();
    assert_eq!(
        load(
            r#"(module
                (memory (export "memory") 1)
                (func (export "projections_alloc") (param i32) (result i32) (i32.const 0)))"#
        ),
        ComparatorError::MissingExport("projections_compare")
    );
    assert_eq!(
        load(
            r#"(module
                (memory 1)
                (func (export "projections_alloc") (param i32) (result i32) (i32.const 0))
                (func (export "projections_compare") (param i32 i32) (result i64) (i64.const 0)))"#
        ),
        ComparatorError::MissingExport("memory")
    );
    assert_eq!(
        load(
            r#"(module
                (memory (export "memory") 1)
                (func (export "projections_compare") (param i32 i32) (result i64) (i64.const 0)))"#
        ),
        ComparatorError::MissingExport("projections_alloc")
    );
    let error = load(
        r#"(module
            (memory (export "memory") 1)
            (func (export "projections_alloc") (param i32) (result i32) (i32.const 0))
            (func (export "projections_compare") (param i32 i32) (result i32) (i32.const 0)))"#,
    );
    assert_eq!(error.code(), "invalid-export");
    assert_eq!(
        error.to_string(),
        "comparator export `projections_compare` must be a function (i32, i32) -> (i64), but is a function (i32, i32) -> (i32)"
    );
    let error = load(
        r#"(module
            (memory 1)
            (global (export "memory") i32 (i32.const 0))
            (func (export "projections_alloc") (param i32) (result i32) (i32.const 0))
            (func (export "projections_compare") (param i32 i32) (result i64) (i64.const 0)))"#,
    );
    assert_eq!(error.code(), "invalid-export", "{error}");
}

#[test]
fn rejects_malformed_modules() {
    assert_eq!(ComparatorModule::load(b"not wasm").unwrap_err().code(), "invalid-module");
    // Valid structure, invalid body: the function returns nothing.
    let mut bytes = module(COMPARISON.as_bytes(), "");
    bytes.truncate(bytes.len() - 3);
    assert_eq!(ComparatorModule::load(&bytes).unwrap_err().code(), "invalid-module");
}

#[test]
fn stops_infinite_loops_with_fuel() {
    let bytes = module(COMPARISON.as_bytes(), "(loop $forever (br $forever))");
    assert_eq!(run(&bytes, &small()).unwrap_err(), ComparatorError::OutOfFuel { budget: 1_000_000 });
    // Start functions are metered too.
    let bytes = module_with(
        COMPARISON.as_bytes(),
        "",
        "(func $start (loop $forever (br $forever))) (start $start)",
    );
    assert_eq!(run(&bytes, &small()).unwrap_err().code(), "out-of-fuel");
}

#[test]
fn stops_memory_bombs() {
    let limit = ComparatorError::MemoryLimit {
        limit_bytes: 2 * 1024 * 1024,
    };
    // Keeps growing until growth fails, then returns normally.
    let bytes = module(
        COMPARISON.as_bytes(),
        "(loop $grow (br_if $grow (i32.ne (memory.grow (i32.const 1)) (i32.const -1))))",
    );
    assert_eq!(run(&bytes, &small()).unwrap_err(), limit);
    // One large request, whose failure the module ignores.
    let bytes = module(COMPARISON.as_bytes(), "(drop (memory.grow (i32.const 60000)))");
    assert_eq!(run(&bytes, &small()).unwrap_err(), limit);
    // Growth within the cap is fine.
    let bytes = module(COMPARISON.as_bytes(), "(drop (memory.grow (i32.const 16)))");
    assert_eq!(run(&bytes, &small()).unwrap(), COMPARISON.as_bytes());
    // An initial memory larger than the cap fails at instantiation.
    let bytes = wat::parse_str(
        r#"(module
            (memory (export "memory") 100)
            (func (export "projections_alloc") (param i32) (result i32) (i32.const 0))
            (func (export "projections_compare") (param i32 i32) (result i64) (i64.const 0)))"#,
    )
    .unwrap();
    assert_eq!(run(&bytes, &small()).unwrap_err(), limit);
    // A module's own maximum is not a host limit violation.
    let bytes = wat::parse_str(format!(
        r#"(module
            (memory (export "memory") 1 1)
            (data (i32.const 0) "{}")
            (func (export "projections_alloc") (param i32) (result i32) (i32.const 1024))
            (func (export "projections_compare") (param i32 i32) (result i64)
                (drop (memory.grow (i32.const 1)))
                (i64.const {})))"#,
        escape(COMPARISON.as_bytes()),
        COMPARISON.len()
    ))
    .unwrap();
    assert_eq!(run(&bytes, &small()).unwrap(), COMPARISON.as_bytes());
}

#[test]
fn stops_table_bombs() {
    let bytes = module_with(
        COMPARISON.as_bytes(),
        "(drop (table.grow $t (ref.null func) (i32.const 2000000)))",
        "(table $t 1 funcref)",
    );
    assert_eq!(run(&bytes, &small()).unwrap_err().code(), "table-limit");
}

#[test]
fn surfaces_comparator_errors() {
    let bytes = module(br#"{"error":"priority list is empty"}"#, "");
    let error = run(&bytes, &Limits::default()).unwrap_err();
    assert_eq!(error, ComparatorError::Comparator("priority list is empty".into()));
    assert_eq!(error.to_string(), "comparator failed: priority list is empty");
    for output in [r#"{"error":42}"#, r#"{"error":"x","steps":[]}"#] {
        let bytes = module(output.as_bytes(), "");
        assert_eq!(run(&bytes, &Limits::default()).unwrap_err().code(), "invalid-output", "{output}");
    }
}

#[test]
fn surfaces_traps() {
    let bytes = module(COMPARISON.as_bytes(), "unreachable");
    let error = run(&bytes, &Limits::default()).unwrap_err();
    assert_eq!(error.code(), "trap", "{error}");
    let bytes = module(COMPARISON.as_bytes(), "(drop (i32.load (i32.const 0x7fffffff)))");
    assert_eq!(run(&bytes, &Limits::default()).unwrap_err().code(), "trap");
}

#[test]
fn rejects_oversize_output() {
    let bytes = wat::parse_str(
        r#"(module
            (memory (export "memory") 1)
            (func (export "projections_alloc") (param i32) (result i32) (i32.const 1024))
            (func (export "projections_compare") (param i32 i32) (result i64) (i64.const 0xffffffff)))"#,
    )
    .unwrap();
    assert_eq!(
        run(&bytes, &Limits::default()).unwrap_err(),
        ComparatorError::OutputTooLarge {
            size: 0xffff_ffff,
            limit: 32 * 1024 * 1024,
        }
    );
    let limits = Limits {
        max_output_bytes: 10,
        ..Limits::default()
    };
    let bytes = module(COMPARISON.as_bytes(), "");
    assert_eq!(run(&bytes, &limits).unwrap_err().code(), "output-too-large");
}

#[test]
fn rejects_malformed_return_values() {
    // Output range beyond memory (pointer 0x10000 in a 2-page memory, 0x20000 bytes).
    let bytes = wat::parse_str(
        r#"(module
            (memory (export "memory") 2)
            (func (export "projections_alloc") (param i32) (result i32) (i32.const 1024))
            (func (export "projections_compare") (param i32 i32) (result i64)
                (i64.const 0x0001000000020000)))"#,
    )
    .unwrap();
    assert_eq!(run(&bytes, &Limits::default()).unwrap_err().code(), "invalid-return");
    // Allocation beyond memory.
    let bytes = wat::parse_str(
        r#"(module
            (memory (export "memory") 1)
            (func (export "projections_alloc") (param i32) (result i32) (i32.const -1))
            (func (export "projections_compare") (param i32 i32) (result i64) (i64.const 0)))"#,
    )
    .unwrap();
    let error = run(&bytes, &Limits::default()).unwrap_err();
    assert_eq!(error.code(), "invalid-return", "{error}");
}

#[test]
fn rejects_malformed_output() {
    for (output, message) in [
        (&b"\xff\xfe"[..], "not UTF-8"),
        (b"{\"protocolVersion\":0,", "not valid JSON"),
        (b"[]", "must be a JSON object"),
        (b"", "not valid JSON"),
        (br#"{"protocolVersion":1,"changes":[],"steps":[]}"#, "protocolVersion 0"),
        (br#"{"protocolVersion":0,"changes":{},"steps":[]}"#, "`changes` must be an array"),
        (br#"{"protocolVersion":0,"changes":[]}"#, "`steps` must be an array"),
        (
            br#"{"protocolVersion":0,"changes":[],"steps":[],"colors":{}}"#,
            "unknown field `colors`",
        ),
        (
            br#"{"protocolVersion":0,"changes":[],"steps":[],"order":"mirror"}"#,
            "`order` must be an object",
        ),
    ] {
        let bytes = module(output, "");
        let error = run(&bytes, &Limits::default()).unwrap_err();
        assert_eq!(error.code(), "invalid-output", "{error}");
        assert!(error.to_string().contains(message), "{error} should mention {message}");
    }
}

#[test]
fn rejects_invalid_input() {
    let comparator = ComparatorModule::load(&module(COMPARISON.as_bytes(), "")).unwrap();
    for (input, message) in [
        (&b"{"[..], "not valid JSON"),
        (b"\xff", "not UTF-8"),
        (
            br#"{"protocolVersion":0,"before":{},"after":{},"baseline":{}}"#,
            "`options` must be an object",
        ),
        (
            br#"{"protocolVersion":1,"before":{},"after":{},"baseline":{},"options":{}}"#,
            "protocolVersion 0",
        ),
        (
            br#"{"protocolVersion":0,"before":{},"after":{},"baseline":{},"options":{},"x":1}"#,
            "unknown field `x`",
        ),
    ] {
        let error = comparator.run(input, &Limits::default()).unwrap_err();
        assert_eq!(error.code(), "invalid-input", "{error}");
        assert!(error.to_string().contains(message), "{error} should mention {message}");
    }
    let limits = Limits {
        max_input_bytes: 8,
        ..Limits::default()
    };
    assert_eq!(
        comparator.run(INPUT, &limits).unwrap_err(),
        ComparatorError::InputTooLarge {
            size: INPUT.len(),
            limit: 8,
        }
    );
}

#[test]
fn runs_each_call_in_a_fresh_instance() {
    // A global counter would differ between runs if instances were reused.
    let bytes = wat::parse_str(format!(
        r#"(module
            (memory (export "memory") 1)
            (global $calls (mut i32) (i32.const 0))
            (data (i32.const 0) "{}")
            (func (export "projections_alloc") (param i32) (result i32) (i32.const 1024))
            (func (export "projections_compare") (param i32 i32) (result i64)
                (global.set $calls (i32.add (global.get $calls) (i32.const 1)))
                (if (i32.gt_u (global.get $calls) (i32.const 1)) (then unreachable))
                (i64.const {})))"#,
        escape(COMPARISON.as_bytes()),
        COMPARISON.len()
    ))
    .unwrap();
    let comparator = ComparatorModule::load(&bytes).unwrap();
    for _ in 0..3 {
        assert_eq!(comparator.run(INPUT, &Limits::default()).unwrap(), COMPARISON.as_bytes());
    }
}

#[test]
fn digests_bytes() {
    assert_eq!(
        digest(b""),
        "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
}

/// Appends a custom section, as the rules interpreter's build does.
fn with_section(mut bytes: Vec<u8>, name: &str, payload: &[u8]) -> Vec<u8> {
    let mut body = vec![u8::try_from(name.len()).unwrap()];
    body.extend_from_slice(name.as_bytes());
    body.extend_from_slice(payload);
    bytes.push(0);
    bytes.push(u8::try_from(body.len()).unwrap());
    bytes.extend(body);
    bytes
}

#[test]
fn a_rules_interpreter_is_identified_by_the_source_digest_its_build_embeds() {
    let plain = module(COMPARISON.as_bytes(), "");
    assert_eq!(interpreter_digest(&plain), digest(&plain));
    let source = format!("sha256:{}", "ab".repeat(32));
    let embedded = with_section(plain.clone(), "projections.interpreter", source.as_bytes());
    assert_eq!(interpreter_digest(&embedded), source);
    // A build on another host differs in bytes, not in identity.
    let other = with_section(
        with_section(plain.clone(), "name", b"\x00"),
        "projections.interpreter",
        source.as_bytes(),
    );
    assert_ne!(digest(&other), digest(&embedded));
    assert_eq!(interpreter_digest(&other), source);
    // Anything but a sha256 digest is ignored.
    let invalid = with_section(plain.clone(), "projections.interpreter", b"version 1");
    assert_eq!(interpreter_digest(&invalid), digest(&invalid));
    assert!(ComparatorModule::load(&embedded).is_ok());
}
