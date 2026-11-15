//! Counted files, code, comment and blank lines by language, using tokei's
//! language definitions and line counter.

use anyhow::{Result, bail, ensure};
use projections_extractor_sdk::{Context, Descriptor, Trust, array, extraction, glob, globs, object, text};
use regex::Regex;
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use tokei::{Config, LanguageType};

pub const ID: &str = "code-statistics";

/// The pinned tokei release (see Cargo.toml); its language definitions decide every count.
const TOKEI: &str = "tokei 15.0.0";

const MAX_FILE_BYTES: u64 = 8 * 1024 * 1024;

const DEFAULT_EXCLUDES: [&str; 19] = [
    "**/node_modules/**",
    "**/.git/**",
    "**/dist/**",
    "**/build/**",
    "**/out/**",
    "**/bin/**",
    "**/obj/**",
    "**/target/**",
    "**/vendor/**",
    "**/__pycache__/**",
    "**/.venv/**",
    "**/venv/**",
    "**/coverage/**",
    "**/.next/**",
    "**/.nuxt/**",
    "**/*.min.js",
    "**/*.min.css",
    "**/*.lock",
    "**/package-lock.json",
];

/// Test files by common convention across ecosystems.
pub const DEFAULT_TESTS: [&str; 10] = [
    "**/test/**",
    "**/tests/**",
    "**/__tests__/**",
    "**/spec/**",
    "**/*.test.*",
    "**/*.spec.*",
    "**/*_test.*",
    "**/*_spec.*",
    "**/test_*.py",
    "**/*Tests.cs",
];

pub fn descriptor() -> Descriptor {
    Descriptor {
        id: ID,
        title: "Code statistics",
        description: "Counted files, code, comment and blank lines by language, split into test and other files",
        schema: "metrics/v0",
        renderer: "code-statistics",
        trust: Trust::None,
        access: projections_extractor_sdk::Access::Files,
        determinism: projections_extractor_sdk::Determinism::Pure,
        inputs: json!({"include":"Array of globs to count; default every file","exclude":"Array of globs to skip in addition to the defaults","defaultExcludes":"Set false to count dependency, output and lockfile paths too","languages":"Map of file extension to a tokei language name","tests":"Array of globs classifying test files; default common test conventions; [] classifies none"}),
        template_inputs: None,
        detects: &["*", "**/*"],
    }
}

pub fn requires_trust(_inputs: &Value) -> bool {
    false
}

pub fn collect(cx: &Context) -> Result<Value> {
    statistics(cx, cx.files()?, cx.definition())
}

/// The language tokei assigns a path by filename or extension.
///
/// tokei falls back to reading a shebang from extensionless files by opening the
/// path itself. Extractors read only through the host's no-follow reader, so the
/// path is placed under a NUL component that no file system can open: tokei sees
/// the real filename and extension, and its shebang probe always fails.
fn detect(relative: &str) -> Option<LanguageType> {
    let virtual_path = PathBuf::from("\0").join(relative);
    LanguageType::from_path(virtual_path, &Config::default())
}

fn language(name: &str, label: &str) -> Result<LanguageType> {
    LanguageType::from_name(name)
        .or_else(|| LanguageType::from_str(name).ok())
        .ok_or_else(|| anyhow::anyhow!("{label} must name a tokei language, not \"{name}\""))
}

#[derive(Default)]
struct Lines {
    files: u64,
    code: u64,
    comment: u64,
    blank: u64,
}

impl Lines {
    fn add(&mut self, code: u64, comment: u64, blank: u64) {
        self.files += 1;
        self.code += code;
        self.comment += comment;
        self.blank += blank;
    }
    fn lines(&self) -> u64 {
        self.code + self.comment + self.blank
    }
}

#[derive(Default)]
struct Tally {
    all: Lines,
    tests: Lines,
    bytes: u64,
    evidence: Vec<Value>,
}

fn statistics(cx: &Context, files: &[String], definition: &Value) -> Result<Value> {
    let inputs = &definition["inputs"];
    let mut overrides = BTreeMap::new();
    if let Some(languages) = inputs.get("languages") {
        for (extension, name) in object(languages, "inputs.languages")? {
            let name = text(name, "inputs.languages value")?;
            ensure!(
                extension.len() > 1 && extension.starts_with('.'),
                "inputs.languages keys must be file extensions beginning with \".\""
            );
            let language = language(name, &format!("inputs.languages.{extension}"))?;
            overrides.insert(extension[1..].to_lowercase(), language);
        }
    }
    if let Some(defaults) = inputs.get("defaultExcludes") {
        ensure!(defaults.is_boolean(), "inputs.defaultExcludes must be a boolean");
    }
    let mut excluded = globs(inputs.get("exclude"), "inputs.exclude")?;
    if inputs["defaultExcludes"] != false {
        for pattern in DEFAULT_EXCLUDES {
            excluded.push(glob(pattern)?);
        }
    }
    let included = globs(inputs.get("include"), "inputs.include")?;
    let tests: Vec<Regex> = match inputs.get("tests") {
        Some(value) => {
            array(value, "inputs.tests")?;
            globs(Some(value), "inputs.tests")?
        }
        None => DEFAULT_TESTS.iter().map(|g| glob(g)).collect::<Result<_>>()?,
    };
    let config = Config {
        treat_doc_strings_as_comments: Some(true),
        ..Config::default()
    };

    let mut tallies: BTreeMap<&'static str, Tally> = BTreeMap::new();
    let mut skipped = BTreeMap::from([("unrecognized", 0u64), ("binary", 0), ("oversize", 0), ("unreadable", 0)]);
    let mut ordered = files.to_vec();
    ordered.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
    for relative in ordered {
        if (!included.is_empty() && !included.iter().any(|g| g.is_match(&relative))) || excluded.iter().any(|g| g.is_match(&relative)) {
            continue;
        }
        let extension = Path::new(&relative).extension().map(|e| e.to_string_lossy().to_lowercase());
        let language = extension.and_then(|e| overrides.get(&e).copied()).or_else(|| detect(&relative));
        let Some(language) = language else {
            *skipped.get_mut("unrecognized").unwrap() += 1;
            continue;
        };
        let content = (|| -> Result<Vec<u8>> {
            let entry = cx.entry(&relative)?;
            ensure!(!entry.symlink, "Not a regular file");
            if entry.size > MAX_FILE_BYTES {
                bail!("oversize");
            }
            cx.read_bytes(&relative, MAX_FILE_BYTES as usize)
        })();
        let content = match content {
            Ok(c) => c,
            Err(e) => {
                let key = if e.to_string() == "oversize" { "oversize" } else { "unreadable" };
                *skipped.get_mut(key).unwrap() += 1;
                continue;
            }
        };
        if content.iter().take(8000).any(|b| *b == 0) {
            *skipped.get_mut("binary").unwrap() += 1;
            continue;
        }
        let stats = language.parse_from_slice(&content, &config).summarise();
        let (code, comment, blank) = (stats.code as u64, stats.comments as u64, stats.blanks as u64);
        let tally = tallies.entry(language.name()).or_default();
        tally.all.add(code, comment, blank);
        if tests.iter().any(|g| g.is_match(&relative)) {
            tally.tests.add(code, comment, blank);
        }
        tally.bytes += content.len() as u64;
        if tally.evidence.len() < 25 {
            tally.evidence.push(json!({"kind":"counted-file","source":relative}));
        }
    }
    let entities = tallies
        .into_iter()
        .map(|(language, t)| {
            json!({
                "id":format!("language:{language}"),"kind":"language","label":language,
                "data":{"language":language,"files":t.all.files,"code":t.all.code,"comment":t.all.comment,
                    "blank":t.all.blank,"lines":t.all.lines(),"bytes":t.bytes,
                    "testFiles":t.tests.files,"testCode":t.tests.code,"testComment":t.tests.comment,
                    "testBlank":t.tests.blank,"testLines":t.tests.lines(),
                    "value":t.all.code,"unit":"lines of code"},
                "confidence":"derived","evidence":t.evidence,
            })
        })
        .collect();
    Ok(extraction(
        "metrics/v0",
        entities,
        vec![],
        Some(json!({
            "counter":TOKEI,
            "counting":"Physical lines per file, classified by tokei. A line holding both code and a comment counts as code; documentation strings count as comments; code embedded in another language counts as its host file's language.",
            "skipped":skipped,
            "limitations":[
                "Only files tokei recognizes by filename or extension are counted; every other file, including an extensionless script recognizable only by its shebang, is ignored rather than guessed at.",
                "Test files are classified by path globs, not by their contents."
            ]
        })),
    ))
}
