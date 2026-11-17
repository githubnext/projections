//! Rails routes: the route table a Rails application's `config/routes.rb`
//! declares, read without running Ruby or booting the application.
//!
//! The routing DSL is evaluated as ActionDispatch's `Mapper` evaluates it, so
//! resources, namespaces, scopes, shallow nesting, concerns and `draw` expand
//! to the routes, names and controllers `bin/rails routes` prints. Anything
//! that needs the running application (routes added by gems, computed
//! arguments, loops) is listed as unresolved rather than guessed.

mod build;
mod mapper;
mod resource;
mod scope;

pub use build::signature;
pub use mapper::{Route, Unresolved};

use anyhow::{Result, bail};
use projections_extractor_ruby_support::{Stmt, inflect::Inflections, parse};
use projections_extractor_sdk::{Context, Descriptor, Trust, strings};
use serde_json::{Value, json};

pub const ID: &str = "rails-routes";

pub fn descriptor() -> Descriptor {
    Descriptor {
        id: ID,
        title: "Rails routes",
        description: "Rails config/routes.rb: each route's verb, path, controller action and name",
        schema: "api/v0",
        renderer: "api",
        trust: Trust::None,
        access: projections_extractor_sdk::Access::Files,
        determinism: projections_extractor_sdk::Determinism::Pure,
        inputs: json!({
            "routes": "Routes file or files; otherwise discovers each application's config/routes.rb",
            "inflections": "Inflections initializer; default config/initializers/inflections.rb beside config/routes.rb",
        }),
        template_inputs: None,
        detects: &["config/routes.rb", "**/config/routes.rb"],
    }
}

pub fn requires_trust(_inputs: &Value) -> bool {
    false
}

const LIMITATIONS: [&str; 5] = [
    "The routes config/routes.rb declares, read statically: routes a gem adds (devise_for and the like), routes built in loops or from computed values, and engines' own routes are listed as unresolved or as their mount, not expanded.",
    "Constraint objects and lambdas, and conditions such as `if Rails.env.development?`, are recorded as written, not evaluated: a route under a condition is listed with it.",
    "Resource names are singularized and pluralized with ActiveSupport's default inflections plus the irregular, uncountable, plural and singular rules the inflections initializer declares.",
    "config.api_only is read from config/application.rb when it is assigned literally.",
    "Routes are listed by path, not in the order Rails matches them.",
];

/// Directories whose routes describe other applications: tests' dummy apps, fixtures, vendored code.
const IGNORED: [&str; 8] = ["test", "tests", "spec", "fixtures", "examples", "vendor", "node_modules", "tmp"];

/// The application root of a routes file: `web/` for `web/config/routes.rb`.
fn application_root(path: &str) -> Option<&str> {
    let root = path.strip_suffix("config/routes.rb")?;
    (root.is_empty() || root.ends_with('/')).then_some(root)
}

fn ignored(path: &str) -> bool {
    path.split('/').rev().skip(1).any(|segment| IGNORED.contains(&segment))
}

/// Whether `config/application.rb` sets `config.api_only = true`.
pub fn api_only(application: &str) -> bool {
    application.lines().any(|line| {
        let line = line.trim();
        line.strip_prefix("config.api_only").is_some_and(|rest| {
            let rest = rest.trim_start();
            rest.strip_prefix('=')
                .is_some_and(|value| value.split('#').next().unwrap_or("").trim() == "true")
        })
    })
}

/// The statements of each `routes.draw` (or `append`/`prepend`) block,
/// wherever it is: some applications draw inside another block.
fn draw_blocks(statements: &[Stmt]) -> Vec<&[Stmt]> {
    let mut blocks = Vec::new();
    for statement in statements {
        match statement {
            Stmt::Expr(expr) => {
                let Some(call) = expr.call() else { continue };
                let Some(block) = &call.block else { continue };
                let routes = call.receiver.as_deref().is_some_and(|r| r.text.ends_with("routes"));
                if routes && matches!(call.name.as_str(), "draw" | "append" | "prepend") {
                    blocks.push(block.body.as_slice());
                } else {
                    blocks.extend(draw_blocks(&block.body));
                }
            }
            Stmt::If { then, otherwise, .. } => {
                blocks.extend(draw_blocks(then));
                blocks.extend(draw_blocks(otherwise));
            }
            Stmt::Other { .. } => {}
        }
    }
    blocks
}

/// Reads a repository-relative file, `None` when it doesn't exist.
pub type Read<'a> = dyn Fn(&str) -> Result<Option<String>> + 'a;

/// One application's routes file and how to read the files it draws.
pub struct Application<'a> {
    /// The application's root directory, `""` or ending in `/`.
    pub root: &'a str,
    pub path: &'a str,
    pub source: &'a str,
    pub api_only: bool,
    pub inflections: &'a Inflections,
    pub read: &'a Read<'a>,
}

/// The routes and unresolved declarations of one application.
pub fn evaluate(application: &Application) -> Result<(Vec<Route>, Vec<Unresolved>)> {
    let statements = parse(application.source, application.path)?;
    let blocks = draw_blocks(&statements);
    if blocks.is_empty() {
        bail!("{} has no routes.draw block; it isn't a Rails routes file", application.path);
    }
    let directory = application.path.rsplit_once('/').map_or("", |(d, _)| d);
    let load = |name: &str| -> Result<Option<(String, Vec<Stmt>)>> {
        let path = if directory.is_empty() {
            format!("routes/{name}.rb")
        } else {
            format!("{directory}/routes/{name}.rb")
        };
        match (application.read)(&path)? {
            Some(source) => {
                let statements = parse(&source, &path)?;
                Ok(Some((path, statements)))
            }
            None => Ok(None),
        }
    };
    let mut mapper = mapper::Mapper::new(application.path, application.inflections, application.api_only, &load);
    for block in blocks {
        mapper.run(block)?;
    }
    Ok((mapper.routes, mapper.unresolved))
}

/// The entities of one application's routes.
pub fn entities(application: &Application) -> Result<(Vec<Value>, usize)> {
    let (routes, unresolved) = evaluate(application)?;
    let app = application.root.trim_end_matches('/');
    Ok((build::entities(app, &routes, &unresolved), unresolved.len()))
}

/// The routes files to read: those selected, or every application's.
fn routes_files(cx: &Context, files: &[String], definition: &Value) -> Result<Vec<String>> {
    let selected = match definition["inputs"].get("routes") {
        Some(Value::String(path)) => vec![path.clone()],
        Some(value) => strings(value, "inputs.routes")?,
        None => {
            return Ok(files
                .iter()
                .filter(|f| !ignored(f) && application_root(f).is_some())
                .cloned()
                .collect());
        }
    };
    let mut present = Vec::new();
    for path in selected {
        // A revision before the routes file existed has no routes.
        if cx.input_exists(&path)? {
            present.push(path);
        }
    }
    Ok(present)
}

fn inflections(cx: &Context, definition: &Value, root: &str, read: &Read) -> Result<Inflections> {
    let mut inflections = Inflections::default();
    let initializer = match definition["inputs"].get("inflections") {
        Some(value) => projections_extractor_sdk::text(value, "inputs.inflections")?.to_owned(),
        None => format!("{root}config/initializers/inflections.rb"),
    };
    if let Some(source) = read(&initializer)? {
        inflections.read(&parse(&source, &initializer)?);
        for rule in &inflections.unread {
            cx.diagnose(&format!("{initializer}: inflection rule not read: {rule}"));
        }
    }
    Ok(inflections)
}

pub fn collect(cx: &Context) -> Result<Value> {
    let (files, definition) = (cx.files()?, cx.definition());
    let read = |path: &str| -> Result<Option<String>> {
        if files.iter().any(|f| f == path) {
            cx.read_source(path).map(Some)
        } else {
            Ok(None)
        }
    };
    let mut entities = Vec::new();
    let mut applications = Vec::new();
    let mut unresolved = 0;
    for path in routes_files(cx, files, definition)? {
        let root = application_root(&path).unwrap_or_default();
        let inflections = inflections(cx, definition, root, &read)?;
        let api_only = read(&format!("{root}config/application.rb"))?.is_some_and(|source| api_only(&source));
        let source = cx.read_source(&path)?;
        let application = Application {
            root,
            path: &path,
            source: &source,
            api_only,
            inflections: &inflections,
            read: &read,
        };
        let (found, count) = self::entities(&application)?;
        unresolved += count;
        entities.extend(found);
        applications.push(json!({"routes": path, "apiOnly": api_only}));
    }
    if unresolved > 0 {
        cx.diagnose(&format!(
            "{unresolved} routing declarations weren't expanded; they are listed as unresolved entities"
        ));
    }
    Ok(json!({
        "protocolVersion": 0,
        "schema": "api/v0",
        "entities": entities,
        "relationships": [],
        "metadata": {
            "framework": "rails",
            "authority": "Rails config/routes.rb, evaluated statically by Projections",
            "applications": applications,
            "unresolved": unresolved,
            "limitations": LIMITATIONS,
        },
    }))
}

#[cfg(test)]
mod tests {
    use super::{api_only, application_root};

    #[test]
    fn finds_applications_and_api_mode() {
        assert_eq!(application_root("config/routes.rb"), Some(""));
        assert_eq!(application_root("web/config/routes.rb"), Some("web/"));
        assert_eq!(application_root("webconfig/routes.rb"), None);
        assert!(api_only(
            "module App\n  class Application\n    config.api_only = true # JSON only\n"
        ));
        assert!(!api_only("    # config.api_only = true\n    config.api_only = false\n"));
    }
}
