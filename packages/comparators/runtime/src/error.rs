use std::fmt;

/// Why a comparator module could not be loaded or run.
#[derive(Clone, Debug, PartialEq, Eq)]
#[non_exhaustive]
pub enum ComparatorError {
    /// The bytes are not a valid WebAssembly module for this runtime.
    InvalidModule(String),
    /// The module imports something. Comparator modules must have zero imports.
    ForbiddenImport {
        /// The first few imports, as `module.name`.
        imports: Vec<String>,
        /// Total number of imports.
        count: usize,
    },
    /// A required export is missing.
    MissingExport(&'static str),
    /// A required export has the wrong kind or signature.
    InvalidExport {
        name: &'static str,
        expected: &'static str,
        found: String,
    },
    /// The input is not a structurally valid comparator input.
    InvalidInput(String),
    /// The input exceeds the configured cap.
    InputTooLarge { size: usize, limit: usize },
    /// The fuel budget ran out (for example, an infinite loop).
    OutOfFuel { budget: u64 },
    /// The module tried to grow its memory beyond the cap.
    MemoryLimit { limit_bytes: usize },
    /// The module tried to grow a table beyond the cap.
    TableLimit { limit_elements: usize },
    /// The module trapped.
    Trap(String),
    /// An export returned a pointer or length outside the module's memory.
    InvalidReturn(String),
    /// The output exceeds the configured cap.
    OutputTooLarge { size: usize, limit: usize },
    /// The output is not UTF-8 JSON in the shape of a comparison or error.
    InvalidOutput(String),
    /// The comparator reported `{"error": "message"}`.
    Comparator(String),
}

impl ComparatorError {
    /// A stable code shared with the TypeScript runtime.
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidModule(_) => "invalid-module",
            Self::ForbiddenImport { .. } => "forbidden-import",
            Self::MissingExport(_) => "missing-export",
            Self::InvalidExport { .. } => "invalid-export",
            Self::InvalidInput(_) => "invalid-input",
            Self::InputTooLarge { .. } => "input-too-large",
            Self::OutOfFuel { .. } => "out-of-fuel",
            Self::MemoryLimit { .. } => "memory-limit",
            Self::TableLimit { .. } => "table-limit",
            Self::Trap(_) => "trap",
            Self::InvalidReturn(_) => "invalid-return",
            Self::OutputTooLarge { .. } => "output-too-large",
            Self::InvalidOutput(_) => "invalid-output",
            Self::Comparator(_) => "comparator-error",
        }
    }
}

impl fmt::Display for ComparatorError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidModule(message) => write!(f, "invalid comparator module: {message}"),
            Self::ForbiddenImport { imports, count } => {
                write!(
                    f,
                    "comparator modules must have zero imports, but this module has {count}: {}",
                    imports.join(", ")
                )?;
                if *count > imports.len() {
                    write!(f, ", …")?;
                }
                Ok(())
            }
            Self::MissingExport(name) => write!(f, "comparator module does not export `{name}`"),
            Self::InvalidExport { name, expected, found } => write!(f, "comparator export `{name}` must be {expected}, but is {found}"),
            Self::InvalidInput(message) => write!(f, "invalid comparator input: {message}"),
            Self::InputTooLarge { size, limit } => write!(f, "comparator input is {size} bytes, exceeding the {limit}-byte limit"),
            Self::OutOfFuel { budget } => write!(f, "comparator exceeded its execution budget of {budget} fuel units"),
            Self::MemoryLimit { limit_bytes } => write!(f, "comparator tried to grow its memory beyond the {limit_bytes}-byte limit"),
            Self::TableLimit { limit_elements } => write!(f, "comparator tried to grow a table beyond {limit_elements} elements"),
            Self::Trap(message) => write!(f, "comparator trapped: {message}"),
            Self::InvalidReturn(message) => {
                write!(f, "comparator returned an invalid value: {message}")
            }
            Self::OutputTooLarge { size, limit } => write!(f, "comparator output is {size} bytes, exceeding the {limit}-byte limit"),
            Self::InvalidOutput(message) => write!(f, "invalid comparator output: {message}"),
            Self::Comparator(message) => write!(f, "comparator failed: {message}"),
        }
    }
}

impl std::error::Error for ComparatorError {}
