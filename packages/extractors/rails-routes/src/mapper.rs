//! Evaluates a routes file's DSL as ActionDispatch's `Mapper` does, without
//! running Ruby: each call adds routes or scopes the calls in its block. What
//! can't be known without running the application (methods from gems, computed
//! arguments, loops) is recorded as unresolved, never guessed.

mod matching;
mod mount;
mod options;
mod resources;

pub use options::Options;

use crate::scope::{Format, Frame, join_name, join_path};
use anyhow::Result;
use options::{entries, literal_arguments, pair_text};
use projections_extractor_ruby_support::{Call, Expr, Kind, Stmt, inflect::Inflections};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, PartialEq)]
pub struct Route {
    /// HTTP verbs, or `ANY` for `via: :all` and mounts.
    pub verbs: Vec<String>,
    /// The path pattern without its format suffix.
    pub path: String,
    /// The pattern as Rails prints it, with `(.:format)` when the route has one.
    pub pattern: String,
    pub controller: Option<String>,
    pub action: Option<String>,
    /// A non-controller endpoint as written: `redirect("/new")`, a Rack app, a mounted engine.
    pub endpoint: Option<String>,
    pub name: Option<String>,
    pub constraints: Vec<String>,
    pub defaults: Vec<String>,
    pub conditions: Vec<String>,
    pub mount: bool,
    pub source: String,
    pub line: usize,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Unresolved {
    pub text: String,
    pub reason: String,
    pub source: String,
    pub line: usize,
    pub conditions: Vec<String>,
}

/// Loads `config/routes/<name>.rb` for `draw(name)`: its path and statements, if it exists.
pub type Loader<'a> = dyn Fn(&str) -> Result<Option<(String, Vec<Stmt>)>> + 'a;

pub struct Mapper<'a> {
    stack: Vec<Frame>,
    pub routes: Vec<Route>,
    pub unresolved: Vec<Unresolved>,
    names: BTreeSet<String>,
    concerns: BTreeMap<String, Vec<Stmt>>,
    inflections: &'a Inflections,
    api_only: bool,
    source: String,
    load: &'a Loader<'a>,
    drawing: Vec<String>,
    /// Options `with_options` blocks give every call inside them, innermost last.
    merged: Vec<Options>,
    /// `with_options` block parameters, whose calls are the mapper's own.
    aliases: Vec<String>,
}

const VERBS: [&str; 6] = ["get", "post", "put", "patch", "delete", "options"];
/// The routing DSL's other methods the reader evaluates.
const DSL: [&str; 20] = [
    "match",
    "root",
    "resources",
    "resource",
    "namespace",
    "scope",
    "controller",
    "defaults",
    "constraints",
    "shallow",
    "member",
    "collection",
    "new",
    "nested",
    "concern",
    "concerns",
    "mount",
    "draw",
    "direct",
    "with_options",
];

impl<'a> Mapper<'a> {
    pub fn new(source: &str, inflections: &'a Inflections, api_only: bool, load: &'a Loader<'a>) -> Self {
        Mapper {
            stack: vec![Frame::default()],
            routes: vec![],
            unresolved: vec![],
            names: BTreeSet::new(),
            concerns: BTreeMap::new(),
            inflections,
            api_only,
            source: source.to_owned(),
            load,
            drawing: vec![],
            merged: vec![],
            aliases: vec![],
        }
    }

    fn top(&self) -> &Frame {
        self.stack.last().expect("the root frame stays")
    }

    /// Runs `body` with `frame` as the innermost scope.
    fn within(&mut self, frame: Frame, body: impl FnOnce(&mut Self) -> Result<()>) -> Result<()> {
        self.stack.push(frame);
        let result = body(self);
        self.stack.pop();
        result
    }

    fn unresolved(&mut self, text: &str, line: usize, reason: &str) {
        let conditions = self.top().conditions.clone();
        self.unresolved.push(Unresolved {
            text: text.to_owned(),
            reason: reason.to_owned(),
            source: self.source.clone(),
            line,
            conditions,
        });
    }

    /// Evaluates the statements of a `draw` block or a routing block.
    pub fn run(&mut self, statements: &[Stmt]) -> Result<()> {
        for statement in statements {
            match statement {
                Stmt::Expr(expr) => match expr.call() {
                    Some(call) if call.receiver.as_ref().is_none_or(|r| self.aliases.contains(&r.text)) => self.call(expr, call)?,
                    _ => self.unresolved(&expr.text, expr.line, "Ruby the routes reader doesn't evaluate"),
                },
                Stmt::If {
                    condition,
                    negated,
                    then,
                    otherwise,
                    ..
                } => {
                    let (holds, fails) = if *negated { ("unless", "if") } else { ("if", "unless") };
                    for (keyword, branch) in [(holds, then), (fails, otherwise)] {
                        let mut frame = self.top().clone();
                        frame.conditions.push(format!("{keyword} {condition}"));
                        self.within(frame, |mapper| mapper.run(branch))?;
                    }
                }
                Stmt::Other { line, text } => self.unresolved(text, *line, "Ruby the routes reader doesn't evaluate"),
            }
        }
        Ok(())
    }

    fn block(call: &Call) -> &[Stmt] {
        call.block.as_ref().map_or(&[], |b| b.body.as_slice())
    }

    fn call(&mut self, expr: &Expr, call: &Call) -> Result<()> {
        let name = call.name.as_str();
        if !VERBS.contains(&name) && !DSL.contains(&name) && name != "resolve" {
            let reason = format!("`{name}` isn't part of Rails' routing DSL (it may come from a gem), so its routes aren't expanded");
            self.unresolved(&expr.text, expr.line, &reason);
            return Ok(());
        }
        // Constraint objects, endpoints, requirements and defaults may be computed; what decides routes may not.
        let computed_positional = matches!(name, "concern" | "draw" | "constraints" | "defaults");
        // A mount's application may be computed; its path is checked when it is read.
        if name != "mount" && !literal_arguments(call, computed_positional) {
            self.unresolved(
                &expr.text,
                expr.line,
                "Its arguments are computed, so its routes aren't known without running the application",
            );
            return Ok(());
        }
        // `mount App => "/path"` keys its application, not an option.
        let options = if name == "mount" {
            Some(Options::named(call))
        } else {
            Options::of(call)
        };
        let Some(mut options) = options else {
            self.unresolved(&expr.text, expr.line, "Its options are computed");
            return Ok(());
        };
        // `with_options`: the call's own options win over the block's.
        for merged in self.merged.iter().rev() {
            for (key, value) in &merged.0 {
                if !options.has(key) {
                    options.0.push((key.clone(), value.clone()));
                }
            }
        }
        match name {
            _ if VERBS.contains(&name) => self.map_method(expr, call, options, &name.to_uppercase()),
            "match" => self.match_call(expr, call, options),
            "root" => self.root(expr, call, options),
            "resources" | "resource" => self.resources_call(expr, call, options, name == "resource"),
            "namespace" => self.namespace(expr, call, options),
            "scope" => {
                let path: Option<Vec<String>> = call.positional().map(|p| p.name().map(str::to_owned)).collect();
                let Some(path) = path else {
                    self.unresolved(&expr.text, expr.line, "Its path is computed");
                    return Ok(());
                };
                let frame = self.scope(&options, (!path.is_empty()).then(|| path.join("/")));
                self.within(frame, |m| m.run(Self::block(call)))
            }
            "controller" => {
                let mut options = options;
                if let Some(controller) = call.positional().next() {
                    options.0.push(("controller".into(), controller.clone()));
                }
                let frame = self.scope(&options, None);
                self.within(frame, |m| m.run(Self::block(call)))
            }
            "defaults" | "constraints" => {
                let value = call.positional().next().cloned().or_else(|| {
                    let pairs: Vec<_> = call.pairs().map(|(k, v)| (k.clone(), v.clone())).collect();
                    (!pairs.is_empty()).then(|| Expr {
                        kind: Kind::Hash(pairs),
                        line: expr.line,
                        text: String::new(),
                    })
                });
                let mut frame = self.top().clone();
                let added = value.as_ref().map(entries).unwrap_or_default();
                if name == "defaults" {
                    frame.defaults.extend(added);
                } else {
                    frame.constraints.extend(added);
                }
                self.within(frame, |m| m.run(Self::block(call)))
            }
            "shallow" => {
                let mut frame = self.top().clone();
                frame.shallow = true;
                self.within(frame, |m| m.run(Self::block(call)))
            }
            "member" | "collection" | "new" | "nested" if call.block.is_some() => self.resource_block(expr, name, Self::block(call)),
            "concern" => {
                match (call.positional().next().and_then(Expr::name), &call.block) {
                    (Some(concern), Some(block)) if call.positional().count() == 1 => {
                        self.concerns.insert(concern.to_owned(), block.body.clone());
                    }
                    _ => self.unresolved(&expr.text, expr.line, "A concern defined by an object, not a block, isn't expanded"),
                }
                Ok(())
            }
            "concerns" => {
                let names: Vec<String> = call.positional().filter_map(|p| p.names()).flatten().collect();
                self.concerns_call(expr, &names)
            }
            "mount" => self.mount(expr, call, options),
            "with_options" => {
                let Some(block) = &call.block else { return Ok(()) };
                self.merged.push(options);
                self.aliases.extend(block.params.iter().cloned());
                let result = self.run(&block.body);
                self.aliases.truncate(self.aliases.len() - block.params.len());
                self.merged.pop();
                result
            }
            "draw" => self.draw(expr, call),
            // `direct`, `resolve` and `member` and the like without a block: URL helpers or no-ops that add no routes.
            _ => Ok(()),
        }
    }

    fn concerns_call(&mut self, expr: &Expr, names: &[String]) -> Result<()> {
        for name in names {
            match self.concerns.get(name).cloned() {
                Some(body) => self.run(&body)?,
                None => self.unresolved(&expr.text, expr.line, &format!("No concern named `{name}` is declared before it")),
            }
        }
        Ok(())
    }

    fn draw(&mut self, expr: &Expr, call: &Call) -> Result<()> {
        let Some(name) = call
            .positional()
            .next()
            .and_then(Expr::name)
            .filter(|n| !self.drawing.contains(&n.to_string()))
        else {
            self.unresolved(&expr.text, expr.line, "The routes file it draws isn't named literally");
            return Ok(());
        };
        let Some((path, statements)) = (self.load)(name)? else {
            self.unresolved(&expr.text, expr.line, &format!("config/routes/{name}.rb doesn't exist"));
            return Ok(());
        };
        let outer = std::mem::replace(&mut self.source, path);
        self.drawing.push(name.to_owned());
        let result = self.run(&statements);
        self.drawing.pop();
        self.source = outer;
        result
    }

    fn namespace(&mut self, expr: &Expr, call: &Call, options: Options) -> Result<()> {
        let Some(path) = call.positional().next().and_then(Expr::name).map(str::to_owned) else {
            self.unresolved(&expr.text, expr.line, "Its name is computed");
            return Ok(());
        };
        let mut options = options;
        let as_ = options.name("as").unwrap_or_else(|| path.clone());
        let path_option = options
            .take("path")
            .and_then(|p| p.name().map(str::to_owned))
            .unwrap_or_else(|| path.clone());
        let mut frame = self.top().clone();
        frame.path = join_path(&frame.path, &path_option);
        let module = options.name("module").unwrap_or_else(|| path.clone());
        let mut scoped = options.without(&["as", "module"]);
        scoped.0.extend([
            ("module".into(), literal(&module)),
            ("as".into(), literal(&as_)),
            ("shallow_path".into(), literal(&path_option)),
            ("shallow_prefix".into(), literal(&as_)),
        ]);
        self.within(frame, |m| {
            let frame = m.scope(&scoped, None);
            m.within(frame, |m| m.run(Self::block(call)))
        })
    }

    /// The frame `scope(path, options)` opens: `Mapper#scope`'s merges.
    fn scope(&self, options: &Options, path: Option<String>) -> Frame {
        let parent = self.top();
        let mut frame = parent.clone();
        let nested = parent.level == crate::scope::Level::Nested;
        let path = path.or_else(|| options.name("path"));
        if let Some(path) = &path {
            frame.path = join_path(&parent.path, path);
        }
        let as_ = options.name("as");
        let shallow_path = options.name("shallow_path").or_else(|| path.clone().filter(|_| !nested));
        let shallow_prefix = options.name("shallow_prefix").or_else(|| as_.clone().filter(|_| !nested));
        if let Some(child) = shallow_path {
            frame.shallow_path = Some(join_path(parent.shallow_path.as_deref().unwrap_or(""), &child));
        }
        if let Some(child) = shallow_prefix {
            frame.shallow_prefix = Some(join_name(parent.shallow_prefix.as_deref(), &child));
        }
        if let Some(child) = as_ {
            frame.as_ = Some(join_name(parent.as_.as_deref(), &child));
        }
        if let Some(child) = options.name("module") {
            frame.module = Some(match &parent.module {
                Some(module) => format!("{module}/{child}"),
                None => child,
            });
        }
        for (key, target) in [("controller", &mut frame.controller), ("action", &mut frame.action)] {
            if let Some(value) = options.name(key) {
                *target = Some(value);
            }
        }
        if let Some(constraints) = options.get("constraints") {
            frame.constraints.extend(entries(constraints));
        }
        if let Some(defaults) = options.get("defaults") {
            frame.defaults.extend(entries(defaults));
        }
        if options.has("shallow") {
            frame.shallow = options.truthy("shallow");
        }
        if options.has("only") || options.has("except") {
            frame.only = options.names("only");
            frame.except = options.names("except");
        }
        if let Some(via) = options.names("via") {
            frame.via = Some(via);
        }
        if let Some(format) = options.get("format") {
            frame.format = Some(format_of(format));
        }
        for (key, value) in &options.without(SCOPE_OPTIONS).0 {
            match value.kind {
                Kind::Regex(_) => frame.constraints.push(pair_text(key, value)),
                _ => frame.defaults.push(pair_text(key, value)),
            }
        }
        frame
    }
}

/// The options `scope` reads itself; others become requirements or defaults.
const SCOPE_OPTIONS: &[&str] = &[
    "path",
    "as",
    "module",
    "controller",
    "action",
    "constraints",
    "defaults",
    "shallow",
    "shallow_path",
    "shallow_prefix",
    "only",
    "except",
    "via",
    "format",
    "path_names",
];

fn format_of(value: &Expr) -> Format {
    match value.kind {
        Kind::Bool(true) => Format::Required,
        Kind::Bool(false) => Format::Off,
        _ => Format::Optional,
    }
}

fn literal(text: &str) -> Expr {
    Expr {
        kind: Kind::Str {
            value: text.to_owned(),
            interpolated: false,
        },
        line: 0,
        text: format!("{text:?}"),
    }
}
