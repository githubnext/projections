//! Shared equivalence harness: the corpus of real extraction pairs, a seeded
//! generator of random ones, canonicalization and the mismatch report.
#![allow(dead_code)]

use projections_engine::{canonical, utf16_cmp};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};

/// Debug builds (as `cargo test` at the workspace root runs them) check a
/// tenth of the generated cases and skip the largest fixtures; release
/// builds, or `DECLARATIVE_FULL=1`, check everything.
pub fn quick() -> bool {
    cfg!(debug_assertions) && std::env::var_os("DECLARATIVE_FULL").is_none()
}

/// `count` generated cases, or a tenth of them in a quick run.
pub fn cases(count: usize) -> usize {
    if quick() { count.div_ceil(10) } else { count }
}

/// Runs `f` on a thread with a large stack: evaluation recurses as deep as
/// the rules nest expressions and function calls (a bound fixed by the rules,
/// not the input), and unoptimized builds need more than a test thread's
/// default stack for the API rules.
/// Runs a test on a thread with a 64 MiB stack. Every test runs on one:
/// unoptimized builds of the CEL evaluator use large frames, and rules nest
/// expressions and function calls.
pub fn with_stack(f: impl FnOnce() + Send + 'static) {
    std::thread::Builder::new()
        .stack_size(64 * 1024 * 1024)
        .spawn(f)
        .unwrap()
        .join()
        .unwrap_or_else(|panic| std::panic::resume_unwind(panic));
}

pub fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..")
}

pub fn read(path: &Path) -> Value {
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

/// The path of a comparator file, by comparator name.
pub fn rules_path(name: &str) -> PathBuf {
    let root = root();
    match name {
        "runtime-policy" => root.join("packages/comparators/runtime-policy/runtime-policy.comparator.yaml"),
        "agentic-workflows" => root.join("packages/comparators/agentic-workflows/agentic-workflows.comparator.yaml"),
        "api-compatibility" => root.join("packages/comparators/api-compatibility/api-compatibility.comparator.yaml"),
        "default-order" => root.join("packages/comparators/rules/tests/rules/default-order.yaml"),
        // The starter `projections init --comparator custom` scaffolds.
        "starter-kinds" => root.join("packages/cli/templates/starter.comparator.yaml"),
        "guide-priority" => root.join("docs/guides/order-of-changes.md"),
        name => root.join(format!("examples/comparators/{name}/{name}.comparator.yaml")),
    }
}

/// The guide's rules example: the YAML block that starts with its path.
const GUIDE_RULES: &str = "```yaml\n# .github/projections/dependencies/priority.comparator.yaml\n";

pub fn rules_text(name: &str) -> String {
    let text = std::fs::read_to_string(rules_path(name)).unwrap();
    if name != "guide-priority" {
        return text;
    }
    let start = text.find(GUIDE_RULES).expect("the guide's rules example") + "```yaml\n".len();
    let end = start + text[start..].find("\n```").unwrap() + 1;
    text[start..end].to_owned()
}

/// A rules file, read and checked: for coverage when `PROJECTIONS_RULES_COVERAGE`
/// names a directory, where its coverage is written when it is dropped (see
/// tools/scripts/rules-coverage.mjs).
pub fn comparator(name: &str) -> Covered {
    covered(name, &rules_text(name))
}

/// [`comparator`] for the rules `text`, a version of `name`'s whose lines
/// are `name`'s (with expressions added after them, say).
pub fn covered(name: &str, text: &str) -> Covered {
    let directory = std::env::var_os("PROJECTIONS_RULES_COVERAGE").map(PathBuf::from);
    let read = match directory {
        Some(_) => projections_comparator_rules::Comparator::with_coverage(text),
        None => projections_comparator_rules::Comparator::from_yaml(text),
    };
    let comparator = read.unwrap_or_else(|failure| {
        panic!(
            "{name}:\n{}",
            failure.iter().map(ToString::to_string).collect::<Vec<_>>().join("\n")
        )
    });
    Covered {
        comparator,
        name: name.to_owned(),
        directory,
    }
}

/// A comparator that writes its coverage to `directory`, if any, when dropped.
pub struct Covered {
    comparator: projections_comparator_rules::Comparator,
    name: String,
    directory: Option<PathBuf>,
}

impl std::ops::Deref for Covered {
    type Target = projections_comparator_rules::Comparator;
    fn deref(&self) -> &Self::Target {
        &self.comparator
    }
}

impl Drop for Covered {
    fn drop(&mut self) {
        use std::sync::atomic::{AtomicUsize, Ordering};
        static WRITTEN: AtomicUsize = AtomicUsize::new(0);
        let (Some(directory), Some(coverage)) = (&self.directory, self.comparator.coverage()) else {
            return;
        };
        let root = root().canonicalize().unwrap();
        let rules = rules_path(&self.name).canonicalize().unwrap();
        let comparator = rules.strip_prefix(&root).unwrap().to_string_lossy().replace('\\', "/");
        // The guide's example is a block of a Markdown file: its lines aren't the file's.
        if !comparator.ends_with(".yaml") {
            return;
        }
        let file = directory.join(format!(
            "rust-{}-{}-{}.json",
            self.name,
            std::process::id(),
            WRITTEN.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(directory).unwrap();
        std::fs::write(file, json!({"comparator": comparator, "coverage": coverage}).to_string()).unwrap();
    }
}

/// A comparison as compared: RFC 8785 JSON with `changes` in ID order. The
/// order of `changes` carries no meaning; the order of steps and of the
/// change IDs within a step does, and is kept.
pub fn canonicalize(comparison: &Value) -> String {
    let mut value = comparison.clone();
    if let Some(changes) = value["changes"].as_array_mut() {
        changes.sort_by(|a, b| utf16_cmp(a["id"].as_str().unwrap(), b["id"].as_str().unwrap()));
    }
    canonical(&value).unwrap()
}

/// Text in its normal form: whitespace runs as one space; numbers without a
/// trailing `.0`; an absent value, which JavaScript writes as `undefined`, as
/// `unknown`; and the parts of a list of reasons (`a; b`) in sorted order.
pub fn normal_text(text: &str) -> String {
    let collapsed = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut out = String::with_capacity(collapsed.len());
    let chars: Vec<char> = collapsed.chars().collect();
    let mut index = 0;
    while index < chars.len() {
        // `1.0` → `1`, but not `1.05` or `v1.0.2`.
        if chars[index] == '.'
            && index > 0
            && chars[index - 1].is_ascii_digit()
            && chars.get(index + 1) == Some(&'0')
            && !chars.get(index + 2).is_some_and(|c| c.is_ascii_digit() || *c == '.')
        {
            index += 2;
            continue;
        }
        out.push(chars[index]);
        index += 1;
    }
    let out = out.replace("undefined", "unknown");
    let mut parts: Vec<&str> = out.split("; ").collect();
    parts.sort();
    parts.join("; ")
}

/// A comparison without its changes' `context`.
pub fn without_context(comparison: &Value) -> Value {
    let mut comparison = comparison.clone();
    for change in comparison["changes"].as_array_mut().into_iter().flatten() {
        if let Some(fields) = change.as_object_mut() {
            fields.remove("context");
        }
    }
    comparison
}

/// A comparison in its semantic normal form: what equivalence compares.
/// Correspondences, statuses, steps and their order, classifications and
/// counts must agree; text agrees after [`normal_text`], and findings and
/// notices are compared as sets.
pub fn semantic(comparison: &Value) -> String {
    fn walk(value: &mut Value, key: &str) {
        match value {
            Value::String(text) => *text = normal_text(text),
            Value::Array(items) => {
                for item in items.iter_mut() {
                    walk(item, "");
                }
                if key == "findings" || key == "notices" {
                    items.sort_by_key(|item| canonical(item).unwrap());
                }
            }
            Value::Object(fields) => {
                for (key, item) in fields.iter_mut() {
                    walk(item, key);
                }
            }
            _ => {}
        }
    }
    let mut value: Value = serde_json::from_str(&canonicalize(comparison)).unwrap();
    walk(&mut value, "");
    canonical(&value).unwrap()
}

fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if path.is_dir() {
            if !["node_modules", "target", "dist", ".git"].contains(&name.as_str()) {
                walk(&path, out);
            }
        } else if name.ends_with(".json") {
            out.push(path);
        }
    }
}

fn is_extraction(value: &Value) -> bool {
    value["schema"].is_string() && value["entities"].is_array() && value["relationships"].is_array()
}

/// Every before/after pair of extraction fixtures in the repository:
/// `x-before.json` and `x-after.json`, `before.json` and `after.json`,
/// `before.expected.json` and `after.expected.json`, and `x-v1.json`, `x-v2.json`.
pub fn corpus() -> Vec<(String, Value, Value)> {
    let root = root();
    let mut files = Vec::new();
    for dir in ["packages/renderers", "examples", "packages/extractors", "packages/comparators"] {
        walk(&root.join(dir), &mut files);
    }
    files.sort();
    let mut pairs = Vec::new();
    for path in &files {
        // Case names and suffixes use `/` on every platform, so golden files recorded anywhere match.
        let text = path.to_string_lossy().replace('\\', "/");
        for (old, new) in [
            ("-before.json", "-after.json"),
            ("/before.json", "/after.json"),
            ("/before.expected.json", "/after.expected.json"),
            ("-v1.json", "-v2.json"),
        ] {
            if let Some(stem) = text.strip_suffix(old) {
                let other = PathBuf::from(format!("{stem}{new}"));
                let large = |path: &Path| std::fs::metadata(path).unwrap().len() > 200_000;
                if other.exists() && !(quick() && (large(path) || large(&other))) {
                    let (before, after) = (read(path), read(&other));
                    if is_extraction(&before) && is_extraction(&after) && before["schema"] == after["schema"] {
                        // Named without `packages/`, so case names stay as the golden files record them.
                        let name = path
                            .strip_prefix(&root)
                            .unwrap()
                            .to_string_lossy()
                            .replace('\\', "/")
                            .replace(old, "");
                        let name = name.strip_prefix("packages/").map(str::to_owned).unwrap_or(name);
                        pairs.push((name, before, after));
                    }
                }
            }
        }
    }
    pairs
}

/// A small deterministic generator (xorshift64*).
pub struct Random(u64);

impl Random {
    pub fn new(seed: u64) -> Self {
        Random(seed.wrapping_mul(0x9e37_79b9_7f4a_7c15) | 1)
    }
    pub fn next(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_f491_4f6c_dd1d)
    }
    pub fn below(&mut self, n: usize) -> usize {
        if n == 0 { 0 } else { (self.next() % n as u64) as usize }
    }
    pub fn chance(&mut self, percent: u64) -> bool {
        self.next() % 100 < percent
    }
    pub fn pick<'a, T>(&mut self, items: &'a [T]) -> &'a T {
        &items[self.below(items.len())]
    }
}

const NAMES: [&str; 12] = ["a", "b", "c", "d", "e", "f", "\u{e000}", "\u{1f600}", "a/b", "B", "x~1", "z"];

/// A random pair of `graph/v0` extractions sharing some entities, with
/// modified labels and data, random relationships, and random identity
/// claims (renames, splits, merges and some ambiguous groups).
pub fn random_pair(random: &mut Random) -> (Value, Value) {
    let entities = 1 + random.below(14);
    let ids: Vec<String> = (0..entities).map(|n| format!("{}{n}", random.pick(&NAMES))).collect();
    let mut before_entities = Vec::new();
    let mut after_entities = Vec::new();
    let mut before_ids = Vec::new();
    let mut after_ids = Vec::new();
    for id in &ids {
        let entity = |random: &mut Random| {
            let mut entity = json!({"id": id, "kind": "package", "label": id});
            if random.chance(50) {
                let weight = *random.pick(&[0.0, 1.0, 2.0, 2.5, -1.0, 7.0]);
                entity["data"] = json!({"weight": weight});
            }
            entity
        };
        match random.below(4) {
            0 => {
                before_entities.push(entity(random));
                before_ids.push(id.clone());
            }
            1 => {
                after_entities.push(entity(random));
                after_ids.push(id.clone());
            }
            _ => {
                let first = entity(random);
                let mut second = first.clone();
                if random.chance(30) {
                    second["label"] = json!(format!("{id}!"));
                }
                before_entities.push(first);
                after_entities.push(second);
                before_ids.push(id.clone());
                after_ids.push(id.clone());
            }
        }
    }
    // Claims from after entities to before entities that aren't also after IDs.
    let only_before: Vec<String> = before_ids.iter().filter(|id| !after_ids.contains(id)).cloned().collect();
    let only_after: Vec<String> = after_ids.iter().filter(|id| !before_ids.contains(id)).cloned().collect();
    for entity in after_entities.iter_mut() {
        let id = entity["id"].as_str().unwrap().to_owned();
        if only_after.contains(&id) && !only_before.is_empty() && random.chance(50) {
            let mut claims = vec![random.pick(&only_before).clone()];
            if random.chance(15) {
                claims.push(random.pick(&only_before).clone());
            }
            claims.dedup();
            entity["previousIds"] = json!(claims);
        }
    }
    let relationships = |random: &mut Random, ids: &[String], prefix: &str| {
        let mut list = Vec::new();
        if ids.is_empty() {
            return list;
        }
        for n in 0..random.below(ids.len() * 2) {
            let from = random.pick(ids).clone();
            let to = random.pick(ids).clone();
            let id = if random.chance(70) {
                format!("{from}->{to}")
            } else {
                format!("{prefix}{n}")
            };
            if list.iter().any(|r: &Value| r["id"] == id) {
                continue;
            }
            let mut relationship = json!({"id": id, "kind": "dependency", "from": from, "to": to});
            if random.chance(20) {
                relationship["data"] = json!({"weight": random.below(5) as f64});
            }
            list.push(relationship);
        }
        list
    };
    let before_relationships = relationships(random, &before_ids, "r");
    let prefix = if random.chance(50) { "r" } else { "s" };
    let after_relationships = relationships(random, &after_ids, prefix);
    let extraction =
        |entities, relationships| json!({"protocolVersion": 0, "schema": "graph/v0", "entities": entities, "relationships": relationships});
    (
        extraction(before_entities, before_relationships),
        extraction(after_entities, after_relationships),
    )
}

pub struct Report {
    pub name: String,
    pub cases: usize,
    pub identical: usize,
    pub canonical: usize,
    pub semantic: usize,
    pub errors: usize,
    pub mismatches: Vec<Value>,
}

impl Report {
    pub fn new(name: &str) -> Self {
        Report {
            name: name.into(),
            cases: 0,
            identical: 0,
            canonical: 0,
            semantic: 0,
            errors: 0,
            mismatches: Vec::new(),
        }
    }

    /// Records one case: both comparisons, or both failures (compared by code
    /// when `codes` is set, else only as failures).
    pub fn record(&mut self, case: &str, expected: Result<Value, String>, actual: Result<Value, String>) {
        self.cases += 1;
        match (expected, actual) {
            (Ok(expected), Ok(actual)) => {
                if serde_json::to_string(&expected).unwrap() == serde_json::to_string(&actual).unwrap() {
                    self.identical += 1;
                }
                if canonicalize(&expected) == canonicalize(&actual) {
                    self.canonical += 1;
                    self.semantic += 1;
                } else if semantic(&expected) == semantic(&actual) {
                    self.semantic += 1;
                } else {
                    self.mismatches.push(json!({"case": case, "expected": expected, "actual": actual}));
                }
            }
            (Err(expected), Err(actual)) => {
                let code = |error: &str| error.split(':').next().unwrap().to_owned();
                if code(&expected) == code(&actual) {
                    self.errors += 1;
                    self.canonical += 1;
                    self.semantic += 1;
                } else {
                    self.mismatches.push(json!({"case": case, "expectedError": expected, "actualError": actual}));
                }
            }
            (expected, actual) => self.mismatches.push(json!({"case": case, "expected": format!("{expected:?}").chars().take(2000).collect::<String>(), "actual": format!("{actual:?}").chars().take(2000).collect::<String>()})),
        }
    }

    /// Writes `target/rules-equivalence/<name>.json` and fails on any mismatch.
    pub fn finish(self) {
        let dir = root().join("target/rules-equivalence");
        std::fs::create_dir_all(&dir).unwrap();
        let summary = json!({
            "comparator": self.name, "cases": self.cases, "identicalBytes": self.identical,
            "canonicallyEqual": self.canonical, "semanticallyEqual": self.semantic, "matchingErrors": self.errors,
            "mismatches": self.mismatches.len(),
        });
        let report = json!({"summary": summary, "mismatches": self.mismatches.iter().take(20).collect::<Vec<_>>()});
        std::fs::write(
            dir.join(format!("{}.json", self.name)),
            serde_json::to_string_pretty(&report).unwrap(),
        )
        .unwrap();
        eprintln!("{}", summary);
        assert!(
            self.mismatches.is_empty(),
            "{} mismatches; first: {}",
            self.mismatches.len(),
            serde_json::to_string_pretty(&self.mismatches[0])
                .unwrap()
                .chars()
                .take(6000)
                .collect::<String>()
        );
    }
}

/// The golden file of an original comparator, by name.
pub fn golden_path(name: &str) -> PathBuf {
    root().join(format!("packages/comparators/rules/tests/golden/{name}.json"))
}

/// Writes a golden file as recorded: the header, then one case per line.
pub fn write_golden(path: &Path, golden: &Value) {
    let lines: Vec<String> = golden["cases"]
        .as_array()
        .unwrap()
        .iter()
        .map(|case| serde_json::to_string(case).unwrap())
        .collect();
    let header = json!({"comparator": golden["comparator"], "original": golden["original"]});
    let header = serde_json::to_string(&header).unwrap();
    std::fs::write(
        path,
        format!("{},\"cases\":[\n{}\n]}}\n", &header[..header.len() - 1], lines.join(",\n")),
    )
    .unwrap();
}

/// The identity of a case's input: `sha256:<hex>` of the RFC 8785 JSON of
/// `{before, after, options}`. A golden comparison holds only while its
/// fixtures are unchanged.
pub fn input_digest(before: &Value, after: &Value, options: &Value) -> String {
    use sha2::{Digest, Sha256};
    let text = canonical(&json!({"before": before, "after": after, "options": options})).unwrap();
    let hash = Sha256::digest(text.as_bytes());
    format!("sha256:{}", hash.iter().map(|b| format!("{b:02x}")).collect::<String>())
}

/// The comparisons of an original comparator, recorded for every fixed case
/// of its equivalence test before the original was deleted with the module
/// comparator kind: `golden/<name>.json`, each case its input digest and the
/// original's canonical comparison, its error code, or `sameAs` an earlier
/// case with the same comparison. The rules must agree with each in semantic
/// normal form ([`semantic`]); errors agree by code.
///
/// A case whose fixtures changed since (its input digest differs) is stale:
/// there is no original left to record it again, so it is skipped and
/// counted. `GOLDEN_REBASE=1` records each stale or unrecorded case from the
/// rules' own comparison, marked `"baseline": "rules"`: a regression
/// baseline, not the original's verdict.
pub struct Golden {
    name: String,
    rebased: Vec<Value>,
    cases: std::collections::HashMap<String, Value>,
    checked: usize,
    stale: Vec<String>,
    unrecorded: Vec<String>,
    mismatches: Vec<Value>,
}

impl Golden {
    pub fn open(name: &str) -> Self {
        let golden = read(&golden_path(name));
        let cases = golden["cases"]
            .as_array()
            .unwrap()
            .iter()
            .map(|case| (case["case"].as_str().unwrap().to_owned(), case.clone()))
            .collect();
        Golden {
            name: name.into(),
            rebased: Vec::new(),
            cases,
            checked: 0,
            stale: Vec::new(),
            unrecorded: Vec::new(),
            mismatches: Vec::new(),
        }
    }

    fn expected(&self, case: &Value) -> Result<Value, String> {
        if let Some(error) = case["error"].as_str() {
            return Err(error.to_owned());
        }
        match case["sameAs"].as_str() {
            Some(first) => self.expected(&self.cases[first]),
            None => Ok(case["comparison"].clone()),
        }
    }

    /// Checks the rules' result for one fixed case against the original's.
    pub fn check(&mut self, case: &str, before: &Value, after: &Value, options: &Value, actual: Result<Value, String>) {
        let rebase = |actual: &Result<Value, String>| {
            let mut rebased = json!({"case": case, "input": input_digest(before, after, options), "baseline": "rules"});
            match actual {
                Ok(comparison) => rebased["comparison"] = comparison.clone(),
                Err(error) => rebased["error"] = json!(error.split(':').next().unwrap()),
            }
            rebased
        };
        let Some(golden) = self.cases.get(case) else {
            if std::env::var_os("GOLDEN_REBASE").is_some() {
                self.rebased.push(rebase(&actual));
            } else {
                self.unrecorded.push(case.to_owned());
            }
            return;
        };
        if golden["input"] != input_digest(before, after, options) {
            if std::env::var_os("GOLDEN_REBASE").is_some() {
                self.rebased.push(rebase(&actual));
            } else {
                self.stale.push(case.to_owned());
            }
            return;
        }
        self.checked += 1;
        let code = |error: &str| error.split(':').next().unwrap().to_owned();
        let agree = match (self.expected(golden), &actual) {
            // The originals predate context, the core's structural context every comparison now has.
            (Ok(expected), Ok(actual)) => semantic(&expected) == semantic(&without_context(actual)),
            (Err(expected), Err(actual)) => expected == code(actual),
            _ => false,
        };
        if !agree {
            let expected = self.expected(golden);
            self.mismatches.push(json!({"case": case,
                "expected": format!("{expected:?}").chars().take(4000).collect::<String>(),
                "actual": format!("{actual:?}").chars().take(4000).collect::<String>()}));
        }
    }

    /// Writes `target/rules-equivalence/<name>.json` and fails on any mismatch.
    pub fn finish(self) {
        let summary = json!({"comparator": self.name, "goldenCases": self.cases.len(),
            "checked": self.checked, "stale": self.stale.len(), "unrecorded": self.unrecorded.len(),
            "mismatches": self.mismatches.len()});
        let dir = root().join("target/rules-equivalence");
        std::fs::create_dir_all(&dir).unwrap();
        let report = json!({"summary": summary, "stale": self.stale, "unrecorded": self.unrecorded,
            "mismatches": self.mismatches.iter().take(20).collect::<Vec<_>>()});
        std::fs::write(
            dir.join(format!("{}.json", self.name)),
            serde_json::to_string_pretty(&report).unwrap(),
        )
        .unwrap();
        eprintln!("{summary}");
        if !self.rebased.is_empty() {
            let path = golden_path(&self.name);
            let mut golden = read(&path);
            let rebased: std::collections::HashMap<String, Value> = self
                .rebased
                .iter()
                .map(|case| (case["case"].as_str().unwrap().to_owned(), case.clone()))
                .collect();
            let cases = golden["cases"].as_array_mut().unwrap();
            let mut seen = std::collections::HashSet::new();
            for case in cases.iter_mut() {
                if let Some(new) = rebased.get(case["case"].as_str().unwrap()) {
                    seen.insert(new["case"].as_str().unwrap().to_owned());
                    *case = new.clone();
                }
            }
            // Cases no original recorded (fixtures added since) join as rules baselines.
            for new in &self.rebased {
                if !seen.contains(new["case"].as_str().unwrap()) {
                    cases.push(new.clone());
                }
            }
            write_golden(&path, &golden);
            eprintln!("{}: {} cases recorded from the rules", self.name, self.rebased.len());
        }
        assert!(
            self.mismatches.is_empty(),
            "{} mismatches with the original; first: {}",
            self.mismatches.len(),
            serde_json::to_string_pretty(&self.mismatches[0]).unwrap()
        );
        assert!(self.checked > 0, "no golden case of {} was checked", self.name);
    }
}

/// A case no original recorded (a random one): the rules compare it, their
/// comparison valid for both extractions, or fail as a comparator may, on
/// input that doesn't normalize or options or data they reject.
pub fn runs(case: &str, result: &Result<Value, String>) {
    if let Err(error) = result {
        assert!(error == "input" || error.starts_with("comparator-error"), "{case}: {error}");
    }
}
