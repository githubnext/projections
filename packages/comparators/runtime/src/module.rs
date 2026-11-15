use super::digest::{digest, interpreter_digest, rules_digest};
use super::envelope::{check_function, check_input, check_output, describe, parse_object, read_output};
use super::error::ComparatorError;
use super::limiter::Limiter;
use super::{
    ALLOC_EXPORT, COMPARE_EXPORT, DEFAULT_MAX_INPUT_BYTES, LISTED_IMPORTS, Limits, MAX_TABLE_ELEMENTS, MEMORY_EXPORT, RULES_COVER_EXPORT,
    RULES_INSPECT_EXPORT,
};
use serde_json::{Map, Value};
use std::fmt;
use wasmi::{CompilationMode, Config, Engine, ExternType, Linker, Module, ResourceLimiter, Store, TrapCode, ValType};

pub(super) fn configure(config: &mut Config) -> &mut Config {
    config
        .consume_fuel(true)
        .compilation_mode(CompilationMode::Eager)
        .wasm_multi_memory(false)
        .wasm_custom_page_sizes(false)
}

#[derive(Clone)]
pub(super) enum Kind {
    WebAssembly,
    /// A rules file, run by the rules comparator module, and its canonical form.
    Rules(Vec<u8>, String, Vec<Value>),
}

/// A validated comparator, ready to run any number of times: one of
/// Projections' own modules ([`ComparatorModule::load`]) or a rules file run by
/// the interpreter ([`ComparatorModule::load_rules`]). Cloning shares the
/// compiled module.
#[derive(Clone)]
pub struct ComparatorModule {
    engine: Engine,
    module: Module,
    digest: String,
    /// What a rules comparator built on this module is identified by.
    interpreter: String,
    kind: Kind,
}

impl fmt::Debug for ComparatorModule {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ComparatorModule")
            .field("digest", &self.digest)
            .field("rules", &self.is_rules())
            .finish_non_exhaustive()
    }
}

impl ComparatorModule {
    /// Validates and compiles one of Projections' comparator modules, the
    /// default comparator (`default-comparator.wasm`) or the rules interpreter
    /// (`rules.wasm`), against the internal ABI.
    ///
    /// Rejects malformed Wasm, any import, and missing or mistyped
    /// `memory`, `projections_alloc` or `projections_compare` exports.
    pub fn load(bytes: &[u8]) -> Result<Self, ComparatorError> {
        let mut config = Config::default();
        let engine = Engine::new(configure(&mut config));
        let module = Module::new(&engine, bytes).map_err(|error| ComparatorError::InvalidModule(error.to_string()))?;

        let count = module.imports().len();
        if count > 0 {
            let imports = module
                .imports()
                .take(LISTED_IMPORTS)
                .map(|import| format!("{}.{}", import.module(), import.name()))
                .collect();
            return Err(ComparatorError::ForbiddenImport { imports, count });
        }

        match module.get_export(MEMORY_EXPORT) {
            None => return Err(ComparatorError::MissingExport(MEMORY_EXPORT)),
            Some(ExternType::Memory(memory)) if !memory.is_64() => {}
            Some(other) => {
                return Err(ComparatorError::InvalidExport {
                    name: MEMORY_EXPORT,
                    expected: "a 32-bit linear memory",
                    found: describe(&other),
                });
            }
        }
        check_function(&module, ALLOC_EXPORT, &[ValType::I32], &[ValType::I32], "a function (i32) -> (i32)")?;
        check_function(
            &module,
            COMPARE_EXPORT,
            &[ValType::I32, ValType::I32],
            &[ValType::I64],
            "a function (i32, i32) -> (i64)",
        )?;

        Ok(Self {
            engine,
            module,
            digest: digest(bytes),
            interpreter: interpreter_digest(bytes),
            kind: Kind::WebAssembly,
        })
    }

    /// Prepares a rules comparator: the rules comparator module
    /// (`rules.wasm`) and a rules file's UTF-8 text. The module checks the
    /// rules here, in the sandbox, and every problem it finds is reported as
    /// [`ComparatorError::InvalidModule`]; the digest is [`rules_digest`].
    pub fn load_rules(interpreter: &[u8], rules: &[u8]) -> Result<Self, ComparatorError> {
        Self::rules(&Self::load(interpreter)?, rules)
    }

    /// [`ComparatorModule::load_rules`] with the rules comparator module
    /// already loaded, so a host compiles the interpreter once and checks each
    /// rules file against it.
    pub fn rules(interpreter: &ComparatorModule, rules: &[u8]) -> Result<Self, ComparatorError> {
        if !matches!(interpreter.kind, Kind::WebAssembly) {
            return Err(ComparatorError::InvalidModule(
                "the rules interpreter must be a WebAssembly comparator module".into(),
            ));
        }
        let mut loaded = interpreter.clone();
        check_function(
            &loaded.module,
            RULES_INSPECT_EXPORT,
            &[ValType::I32, ValType::I32],
            &[ValType::I64],
            "a function (i32, i32) -> (i64)",
        )?;
        if rules.len() > DEFAULT_MAX_INPUT_BYTES {
            return Err(ComparatorError::InvalidModule(format!(
                "a rules file is limited to {DEFAULT_MAX_INPUT_BYTES} bytes"
            )));
        }
        let output = loaded.call(RULES_INSPECT_EXPORT, rules, &Limits::rules())?;
        let report = parse_object(&output, "the rules check").map_err(ComparatorError::InvalidOutput)?;
        match (report.get("canonical"), report.get("diagnostics")) {
            (Some(Value::String(canonical)), _) => {
                loaded.digest = rules_digest(&loaded.interpreter, canonical);
                loaded.kind = Kind::Rules(
                    rules.to_vec(),
                    canonical.clone(),
                    match report.get("warnings") {
                        Some(Value::Array(warnings)) => warnings.clone(),
                        _ => Vec::new(),
                    },
                );
                Ok(loaded)
            }
            (_, Some(Value::Array(diagnostics))) => Err(ComparatorError::InvalidModule(
                diagnostics
                    .iter()
                    .map(|diagnostic| {
                        format!(
                            "{} at {}: {}",
                            diagnostic["code"].as_str().unwrap_or("invalid-rules"),
                            match diagnostic["path"].as_str().unwrap_or("") {
                                "" => "/",
                                path => path,
                            },
                            diagnostic["message"].as_str().unwrap_or("")
                        )
                    })
                    .collect::<Vec<_>>()
                    .join("\n"),
            )),
            _ => Err(ComparatorError::InvalidOutput(
                "the rules check returned neither a canonical form nor diagnostics".into(),
            )),
        }
    }

    /// Runs one export that takes and returns bytes, packed as
    /// `projections_compare`'s.
    pub(super) fn call(&self, export: &'static str, input: &[u8], limits: &Limits) -> Result<Vec<u8>, ComparatorError> {
        let mut store = Store::new(&self.engine, Limiter::new(limits.max_memory_bytes));
        store.limiter(|limiter| limiter as &mut dyn ResourceLimiter);
        store.set_fuel(limits.fuel).expect("the engine is configured to consume fuel");
        let outcome = self.execute_export(&mut store, export, input, limits);
        if store.data().memory_exceeded {
            return Err(ComparatorError::MemoryLimit {
                limit_bytes: limits.max_memory_bytes,
            });
        }
        outcome
    }

    /// The comparator's digest, `sha256:<hex>`: the module bytes for a
    /// module, or [`rules_digest`] for a rules file.
    pub fn digest(&self) -> &str {
        &self.digest
    }

    /// Whether this is a rules comparator.
    pub fn is_rules(&self) -> bool {
        matches!(self.kind, Kind::Rules(..))
    }

    /// A rules comparator's canonical rules (RFC 8785 JSON of the parsed
    /// file), which its digest covers.
    pub fn rules_canonical(&self) -> Option<&str> {
        match &self.kind {
            Kind::Rules(_, canonical, _) => Some(canonical),
            _ => None,
        }
    }

    /// A rules comparator's lint warnings, `{code, path, message}` each: the
    /// rules load and run, but should change.
    pub fn rules_warnings(&self) -> &[Value] {
        match &self.kind {
            Kind::Rules(_, _, warnings) => warnings,
            _ => &[],
        }
    }

    /// Runs the comparator on UTF-8 JSON input and returns its UTF-8 JSON
    /// comparison. A reported `{"error": ...}` becomes [`ComparatorError::Comparator`].
    pub fn run(&self, input_json: &[u8], limits: &Limits) -> Result<Vec<u8>, ComparatorError> {
        let output = self.execute(COMPARE_EXPORT, input_json, limits)?;
        check_output(&output)?;
        Ok(output)
    }

    /// Runs a rules comparator with rule coverage
    /// (`projections_rules_cover`): its comparison, or why there is none,
    /// and the `projections.rules-coverage` report of what the comparison
    /// ran, which a failed comparison has too (unless the rules didn't load
    /// or the sandbox stopped the run).
    pub fn compare_with_coverage(&self, input: &Value, limits: &Limits) -> (Result<Value, ComparatorError>, Option<Value>) {
        if !self.is_rules() {
            return (Err(ComparatorError::MissingExport(RULES_COVER_EXPORT)), None);
        }
        let output = serde_json::to_vec(input)
            .map_err(|error| ComparatorError::InvalidInput(error.to_string()))
            .and_then(|bytes| self.execute(RULES_COVER_EXPORT, &bytes, limits))
            .and_then(|output| parse_object(&output, "output").map_err(ComparatorError::InvalidOutput));
        let mut output = match output {
            Ok(output) => output,
            Err(error) => return (Err(error), None),
        };
        let coverage = output.remove("coverage").filter(Value::is_object);
        let result = match (output.remove("comparison"), output.remove("error")) {
            (Some(comparison), None) => serde_json::to_vec(&comparison)
                .map_err(|error| ComparatorError::InvalidOutput(error.to_string()))
                .and_then(|bytes| check_output(&bytes))
                .map(|()| comparison),
            (None, Some(Value::String(message))) => Err(ComparatorError::Comparator(message)),
            _ => Err(ComparatorError::InvalidOutput(
                "a coverage result must be {\"comparison\"} or {\"error\"}, with \"coverage\"".into(),
            )),
        };
        (result, coverage)
    }

    /// Runs `export` on comparator input: checks the input, gives a rules
    /// comparator its rules, and enforces the limits.
    fn execute(&self, export: &'static str, input_json: &[u8], limits: &Limits) -> Result<Vec<u8>, ComparatorError> {
        if input_json.len() > limits.max_input_bytes || input_json.len() > i32::MAX as usize {
            return Err(ComparatorError::InputTooLarge {
                size: input_json.len(),
                limit: limits.max_input_bytes.min(i32::MAX as usize),
            });
        }
        check_input(input_json)?;
        // A rules comparator's module takes the rules file in `options.rules`
        // and the definition's options in `options.options`.
        let wrapped;
        let input_json = match &self.kind {
            Kind::Rules(rules, _, _) => {
                let mut input = parse_object(input_json, "input").map_err(ComparatorError::InvalidInput)?;
                let options = input.remove("options").unwrap_or(Value::Object(Map::new()));
                let rules = String::from_utf8(rules.clone()).map_err(|error| ComparatorError::InvalidInput(error.to_string()))?;
                input.insert("options".into(), serde_json::json!({"rules": rules, "options": options}));
                wrapped = serde_json::to_vec(&input).map_err(|error| ComparatorError::InvalidInput(error.to_string()))?;
                &wrapped[..]
            }
            _ => input_json,
        };
        let mut store = Store::new(&self.engine, Limiter::new(limits.max_memory_bytes));
        store.limiter(|limiter| limiter as &mut dyn ResourceLimiter);
        store.set_fuel(limits.fuel).expect("the engine is configured to consume fuel");
        let outcome = self.execute_export(&mut store, export, input_json, limits);
        // A denied growth is reported even if the module recovered and returned.
        let limiter = store.data();
        if limiter.memory_exceeded {
            return Err(ComparatorError::MemoryLimit {
                limit_bytes: limits.max_memory_bytes,
            });
        }
        if limiter.table_exceeded {
            return Err(ComparatorError::TableLimit {
                limit_elements: MAX_TABLE_ELEMENTS,
            });
        }
        outcome
    }

    /// Serializes `input`, runs the comparator and parses its comparison.
    pub fn compare(&self, input: &Value, limits: &Limits) -> Result<Value, ComparatorError> {
        let bytes = serde_json::to_vec(input).map_err(|error| ComparatorError::InvalidInput(error.to_string()))?;
        let output = self.run(&bytes, limits)?;
        serde_json::from_slice(&output).map_err(|error| ComparatorError::InvalidOutput(error.to_string()))
    }

    pub(super) fn execute_export(
        &self,
        store: &mut Store<Limiter>,
        export: &'static str,
        input: &[u8],
        limits: &Limits,
    ) -> Result<Vec<u8>, ComparatorError> {
        let trap = |error: wasmi::Error| match error.as_trap_code() {
            Some(TrapCode::OutOfFuel) => ComparatorError::OutOfFuel { budget: limits.fuel },
            _ => ComparatorError::Trap(error.to_string()),
        };
        let instance = Linker::<Limiter>::new(&self.engine)
            .instantiate_and_start(&mut *store, &self.module)
            .map_err(trap)?;
        let memory = instance
            .get_memory(&*store, MEMORY_EXPORT)
            .ok_or(ComparatorError::MissingExport(MEMORY_EXPORT))?;
        let alloc = instance
            .get_typed_func::<i32, i32>(&*store, ALLOC_EXPORT)
            .map_err(|_| ComparatorError::MissingExport(ALLOC_EXPORT))?;
        let function = instance
            .get_typed_func::<(i32, i32), i64>(&*store, export)
            .map_err(|_| ComparatorError::MissingExport(export))?;
        let length = i32::try_from(input.len()).expect("inputs are capped below 2 GiB");
        let pointer = alloc.call(&mut *store, length).map_err(trap)?;
        let start = pointer as u32 as usize;
        memory.write(&mut *store, start, input).map_err(|_| {
            ComparatorError::InvalidReturn(format!(
                "projections_alloc({length}) returned {start}, which does not address {length} bytes of its {}-byte memory",
                memory.data_size(&*store)
            ))
        })?;
        let packed = function.call(&mut *store, (pointer, length)).map_err(trap)? as u64;
        read_output(store, &memory, packed, export, limits)
    }
}
