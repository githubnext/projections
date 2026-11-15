//! Reading a rules file into its model. Every expression is parsed once, with
//! its macros expanded and its calls instrumented for cost; functions are put
//! in dependency order, and a function may only call functions it doesn't
//! depend on, so evaluation always terminates. Every error names the line and
//! column it is about.

mod function;
mod model;
mod reader;
mod sections;
mod walk;

pub use model::{
    Check, Classify, Expression, Function, Location, Match, Metadata, NewStep, Param, Pass, Place, Rules, Source, Steps, Variable,
    diagnostic,
};
pub use walk::{calls, names};

use self::reader::Reader;
use crate::yaml::Document;
use cel::Env;
#[cfg(feature = "editing")]
use projections_engine::Diagnostic;
use projections_engine::Failure;
use std::collections::BTreeSet;
use std::sync::Arc;

pub const FORMAT: &str = "projections.comparator";

/// Names reserved for the default comparator's identity passes.
pub const DEFAULT_PASSES: [&str; 2] = ["exact", "claims"];

const KINDS: [&str; 3] = ["remove", "restructure", "add"];
const COLLECTIONS: [&str; 2] = ["entities", "relationships"];

pub fn environment() -> Arc<Env> {
    let mut env = Env::stdlib();
    env.add_extension(cel::extensions::strings).unwrap();
    env.add_extension(cel::extensions::lists).unwrap();
    env.add_extension(cel::extensions::math).unwrap();
    Arc::new(env)
}

fn identifier(name: &str) -> bool {
    name.chars().next().is_some_and(|c| c.is_ascii_alphabetic() || c == '_') && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// A value the rules file's format says is a CEL expression, as written,
/// whether or not it parses: what an editor highlights.
#[cfg(feature = "editing")]
pub struct Site {
    pub path: String,
    pub source: String,
}

/// A rules file read for an editor: the model, as much of it as reads, and
/// every CEL value in the file.
#[cfg(feature = "editing")]
pub struct Reading {
    pub rules: Rules,
    pub errors: Vec<Diagnostic>,
    pub sites: Vec<Site>,
}

impl Rules {
    pub fn parse(document: &Document, env: &Env) -> Result<Self, Failure> {
        let (rules, reader) = Rules::read_with(document, env, false, false);
        if reader.errors.is_empty() { Ok(rules) } else { Err(reader.errors) }
    }

    /// Reads rules with coverage probes in every expression, and the
    /// inventory of what they count in [`Rules::coverage`].
    pub fn parse_for_coverage(document: &Document, env: &Env) -> Result<Self, Failure> {
        let (rules, reader) = Rules::read_with(document, env, false, true);
        if reader.errors.is_empty() { Ok(rules) } else { Err(reader.errors) }
    }

    /// Reads a rules file for an editor, keeping what reads despite errors
    /// when `tolerant`, and every CEL value.
    #[cfg(feature = "editing")]
    pub fn read(document: &Document, env: &Env, tolerant: bool) -> Reading {
        let (rules, reader) = Rules::read_with(document, env, tolerant, false);
        Reading {
            rules,
            errors: reader.errors,
            sites: reader.sites,
        }
    }

    fn read_with<'a>(document: &'a Document, env: &'a Env, tolerant: bool, coverage: bool) -> (Rules, Reader<'a>) {
        #[cfg(not(feature = "editing"))]
        let _ = tolerant;
        let mut reader = Reader {
            env,
            #[cfg(feature = "editing")]
            tolerant,
            #[cfg(feature = "editing")]
            sites: Vec::new(),
            source: Source { document },
            text: Arc::from(document.source.as_str()),
            errors: Vec::new(),
            warnings: Vec::new(),
            chains: 0,
            params: Vec::new(),
            coverage: coverage.then(|| crate::coverage::Builder::new(&document.source)),
        };
        let value = &document.value;
        let mut rules = reader.read(value);
        let mut uses = BTreeSet::new();
        for expression in rules.expressions() {
            names(&expression.parsed, &mut uses);
        }
        rules.uses = uses;
        rules.warnings = std::mem::take(&mut reader.warnings);
        rules.chains = reader.chains;
        rules.coverage = reader.coverage.take().map(crate::coverage::Builder::finish);
        (rules, reader)
    }
}
