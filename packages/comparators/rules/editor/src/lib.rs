//! The rules language for editors: semantic tokens, diagnostics, hovers and
//! completions for rules files and their tests, from the same reader and
//! checker that load them. Built as `rules-editor.wasm`, whose
//! `projections_rules_editor` the VS Code extension calls; it is a separate
//! module from the interpreter, `rules.wasm`, so viewers never download it.
//!
//! A request is JSON, `{"op", "source", "kind"?, "line"?, "column"?}`, where
//! `kind` is `rules` (the default) or `tests` (a `*.comparator.test.yaml`), and
//! positions are 1-based lines and 1-based columns in Unicode scalar values,
//! as the YAML reader counts them:
//!
//! - `tokens`: `{"tokens": [{line, column, length, type, modifiers}]}`, the
//!   CEL in every value the format says is an expression, and the types of
//!   function signatures, with LSP's standard token types and modifiers;
//! - `diagnostics`: `{"diagnostics": [{severity, code, path, message, line,
//!   column, endLine, endColumn}]}`, exactly what loading the file reports;
//! - `hover`: `{"hover": {markdown, line, column, endLine, endColumn} | null}`;
//! - `complete`: `{"items": [{label, kind, detail, documentation, insert}],
//!   "range": {line, column, endColumn} | null}`.
//!
//! None of this changes the language: it reads `language.json`'s macros,
//! library and types, and adds only what editors show.

mod complete;
mod diagnostics;
pub mod docs;
mod hover;
pub mod map;
mod resolve;
mod tokens;
#[cfg(target_arch = "wasm32")]
mod wasm;

use map::{Place, lines, locate};
use projections_comparator_rules::check::{self, Scope};
use projections_comparator_rules::rules::{Rules, environment};
use projections_comparator_rules::types::{self, Ty};
use projections_comparator_rules::yaml::{self, Document};
use serde_json::{Value, json};
use std::collections::{BTreeSet, HashMap};
use tokens::Lexeme;

/// One CEL value in the file, with where each of its characters is written.
pub(crate) struct Cel {
    pub path: String,
    pub chars: Vec<char>,
    pub places: Vec<Option<Place>>,
    pub lexemes: Vec<Lexeme>,
}

impl Cel {
    /// The character offset in this expression at a source position: on a
    /// character, or just after the last character of a run.
    pub fn offset(&self, line: usize, column: usize) -> Option<usize> {
        for (index, place) in self.places.iter().enumerate() {
            let Some(place) = place else { continue };
            if place.line == line && place.column <= column && column < place.column + place.width {
                return Some(index);
            }
        }
        self.places.iter().enumerate().find_map(|(index, place)| {
            let place = (*place)?;
            let after = place.line == line && place.column + place.width == column;
            let next = self.places.get(index + 1).copied().flatten();
            (after && next.is_none_or(|next| next.line != line || next.column != column)).then_some(index + 1)
        })
    }

    pub fn text(&self, start: usize, end: usize) -> String {
        self.chars[start..end.min(self.chars.len())].iter().collect()
    }
}

/// A rules file, read for an editor: as much of its model as reads, the
/// scopes its expressions see, and every CEL value with its positions.
pub(crate) struct Analysis {
    pub document: Option<Document>,
    pub scopes: HashMap<String, Scope>,
    pub cels: Vec<Cel>,
    /// The function signatures' type strings, as values with positions.
    pub types: Vec<(Vec<char>, Vec<Option<Place>>)>,
    /// The `options` keys the file reads.
    pub options: BTreeSet<String>,
}

impl Analysis {
    pub fn new(source: &str) -> Analysis {
        let Ok(document) = yaml::parse(source) else {
            return Analysis {
                document: None,
                scopes: HashMap::new(),
                cels: Vec::new(),
                types: Vec::new(),
                options: BTreeSet::new(),
            };
        };
        let source_lines = lines(source);
        let place = |path: &str, value: &str| match document.positions.get(path) {
            Some(position) => locate(&source_lines, position, value),
            None => vec![None; value.chars().count()],
        };
        let reading = Rules::read(&document, &environment(), true);
        let scopes = check::scopes(&reading.rules);
        let cels: Vec<Cel> = reading
            .sites
            .iter()
            .map(|site| Cel {
                path: site.path.clone(),
                chars: site.source.chars().collect(),
                places: place(&site.path, &site.source),
                lexemes: tokens::lex(&site.source),
            })
            .collect();
        let mut types = Vec::new();
        if let Some(functions) = document.value["functions"].as_object() {
            for (name, function) in functions {
                let base = projections_engine::pointer("/functions", name);
                let mut add = |path: String, value: &Value| {
                    if let Some(text) = value.as_str() {
                        types.push((text.chars().collect(), place(&path, text)));
                    }
                };
                add(format!("{base}/returns"), &function["returns"]);
                for (index, param) in function["params"].as_array().into_iter().flatten().enumerate() {
                    add(format!("{base}/params/{index}/type"), &param["type"]);
                }
            }
        }
        let mut options = BTreeSet::new();
        for cel in &cels {
            tokens::option_keys(cel, &mut options);
        }
        Analysis {
            scopes,
            cels,
            types,
            options,
            document: Some(document),
        }
    }

    /// The CEL value at a source position, and the character offset in it.
    pub fn at(&self, line: usize, column: usize) -> Option<(&Cel, usize)> {
        self.cels
            .iter()
            .find_map(|cel| cel.offset(line, column).map(|offset| (cel, offset)))
    }

    /// What an expression sees: its recorded scope, or the inputs.
    pub fn scope(&self, path: &str) -> Scope {
        self.scopes.get(path).cloned().unwrap_or_else(check::inputs)
    }

    /// The file's own function, by name, from its YAML.
    pub fn function(&self, name: &str) -> Option<&Value> {
        self.document
            .as_ref()?
            .value
            .get("functions")?
            .get(name)
            .filter(|function| function.is_object())
    }

    /// The names of the file's functions.
    pub fn functions(&self) -> Vec<String> {
        self.document
            .as_ref()
            .and_then(|document| document.value["functions"].as_object())
            .map(|functions| functions.keys().cloned().collect())
            .unwrap_or_default()
    }

    /// The parameters of the function an expression belongs to.
    pub fn params(&self, path: &str) -> Vec<(String, Ty)> {
        let Some(name) = path.strip_prefix("/functions/").and_then(|rest| rest.split('/').next()) else {
            return Vec::new();
        };
        let name = name.replace("~1", "/").replace("~0", "~");
        let Some(function) = self.function(&name) else {
            return Vec::new();
        };
        function["params"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|param| match param {
                Value::String(name) => Some((name.clone(), Ty::Dyn)),
                Value::Object(_) => Some((
                    param["name"].as_str()?.to_owned(),
                    param["type"].as_str().and_then(|text| types::parse(text).ok()).unwrap_or(Ty::Dyn),
                )),
                _ => None,
            })
            .collect()
    }

    /// A function's signature as written: `name(param: type, …) -> type`.
    pub fn signature(&self, name: &str) -> Option<String> {
        let function = self.function(name)?;
        let params: Vec<String> = function["params"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|param| match param {
                Value::String(name) => name.clone(),
                _ => match (param["name"].as_str(), param["type"].as_str()) {
                    (Some(name), Some(ty)) => format!("{name}: {ty}"),
                    (Some(name), None) => name.to_owned(),
                    _ => "?".to_owned(),
                },
            })
            .collect();
        let returns = function["returns"].as_str().map(|ty| format!(" -> {ty}")).unwrap_or_default();
        Some(format!("{name}({}){returns}", params.join(", ")))
    }

    /// A function's declared result type.
    pub fn returns(&self, name: &str) -> Ty {
        self.function(name)
            .and_then(|function| function["returns"].as_str())
            .and_then(|text| types::parse(text).ok())
            .unwrap_or(Ty::Dyn)
    }

    /// A variable's declaration visible from an expression: its YAML (with
    /// `expression` and `description`) and type.
    pub fn variable(&self, path: &str, name: &str) -> Option<(&Value, Ty)> {
        let ty = self.scope(path).names().get(&format!("variables.{name}")).cloned()?;
        let value = &self.document.as_ref()?.value;
        // The nearest section's variables, then the file's.
        let mut candidates = Vec::new();
        let parts: Vec<&str> = path.split('/').collect();
        for end in (1..parts.len()).rev() {
            candidates.push(format!("{}/variables", parts[..end].join("/")));
        }
        candidates.push("/variables".to_owned());
        candidates.into_iter().find_map(|pointer| {
            value
                .pointer(&pointer)?
                .as_array()?
                .iter()
                .find(|variable| variable["name"] == name)
                .map(|variable| (variable, ty.clone()))
        })
    }
}

/// Answers one editor request (see the module documentation).
pub fn call(input: &[u8]) -> Vec<u8> {
    let output = std::str::from_utf8(input)
        .map_err(|_| "Requests are UTF-8 JSON".to_owned())
        .and_then(|text| serde_json::from_str::<Value>(text).map_err(|error| error.to_string()))
        .and_then(|request| respond(&request))
        .unwrap_or_else(|message| json!({"error": message}));
    serde_json::to_vec(&output).expect("JSON values serialize")
}

fn respond(request: &Value) -> Result<Value, String> {
    let source = request["source"].as_str().ok_or("Expected `source`, the file's text")?;
    let tests = match request.get("kind").and_then(Value::as_str) {
        None | Some("rules") => false,
        Some("tests") => true,
        Some(_) => return Err("`kind` must be rules or tests".to_owned()),
    };
    let position = || -> Result<(usize, usize), String> {
        let read = |key: &str| {
            request[key]
                .as_u64()
                .filter(|value| *value >= 1)
                .map(|value| value as usize)
                .ok_or(format!("Expected `{key}`, 1-based"))
        };
        Ok((read("line")?, read("column")?))
    };
    match request["op"].as_str() {
        Some("tokens") => Ok(json!({"tokens": if tests {
            Vec::new()
        } else {
            tokens::tokens(&Analysis::new(source))
        }})),
        Some("diagnostics") => Ok(json!({"diagnostics": diagnostics::diagnostics(source, tests)})),
        Some("hover") => {
            let (line, column) = position()?;
            Ok(json!({"hover": if tests {
                Value::Null
            } else {
                hover::hover(&Analysis::new(source), line, column)
            }}))
        }
        Some("complete") => {
            let (line, column) = position()?;
            Ok(if tests {
                json!({"items": [], "range": null})
            } else {
                complete::complete(&Analysis::new(source), line, column)
            })
        }
        _ => Err("`op` must be tokens, diagnostics, hover or complete".to_owned()),
    }
}
