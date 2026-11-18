//! Targets and what each depends on.

use super::{Env, call, member, required, unsupported};
use crate::manifest::{Condition, DependencyKind, Target, TargetDependency, Unsupported};
use crate::syntax::{Expr, argument};

/// Each target declaration and the kind SwiftPM records for it.
const KINDS: [(&str, &str); 7] = [
    ("target", "regular"),
    ("executableTarget", "executable"),
    ("testTarget", "test"),
    ("systemLibrary", "system"),
    ("binaryTarget", "binary"),
    ("plugin", "plugin"),
    ("macro", "macro"),
];

pub(super) fn target(env: &Env, expr: &Expr) -> Result<Target, Unsupported> {
    let (declaration, args) = call(env, expr, "target")?;
    let Some((_, kind)) = KINDS.iter().find(|(name, _)| *name == declaration) else {
        return Err(unsupported(
            expr.line(),
            format!("`.{declaration}` isn't a target this reader knows"),
        ));
    };
    let name = required(env, &args, "name", "a target")?;
    let path = env.optional_string(&args, "path", &format!("target `{name}`'s `path`"))?;
    let what = format!("target `{name}`'s `dependencies`");
    let dependencies = match argument(&args, "dependencies") {
        Some(value) => env
            .list(value, &what)?
            .iter()
            .map(|item| dependency(env, item, &what))
            .collect::<Result<_, _>>()?,
        None => Vec::new(),
    };
    Ok(Target {
        name,
        kind: (*kind).to_owned(),
        path,
        dependencies,
    })
}

fn dependency(env: &Env, expr: &Expr, what: &str) -> Result<TargetDependency, Unsupported> {
    if let Expr::Str(name) = env.resolve(expr)? {
        return Ok(TargetDependency {
            kind: DependencyKind::ByName,
            name,
            condition: Condition::default(),
        });
    }
    let (declaration, args) = call(env, expr, "product")?;
    let kind = match declaration.as_str() {
        "target" => DependencyKind::Target,
        "byName" => DependencyKind::ByName,
        "product" => DependencyKind::Product {
            package: env.optional_string(&args, "package", what)?,
        },
        other => {
            return Err(unsupported(
                expr.line(),
                format!("`.{other}` in {what} isn't a dependency this reader knows"),
            ));
        }
    };
    let name = required(env, &args, "name", what)?;
    let condition = match argument(&args, "condition") {
        Some(condition) => self::condition(env, condition, what)?,
        None => Condition::default(),
    };
    Ok(TargetDependency { kind, name, condition })
}

/// `.when(platforms: […], traits: […])`.
fn condition(env: &Env, expr: &Expr, what: &str) -> Result<Condition, Unsupported> {
    let (declaration, args) = call(env, expr, "when")?;
    if declaration != "when" || args.iter().any(|arg| !matches!(arg.label.as_deref(), Some("platforms" | "traits"))) {
        return Err(unsupported(
            expr.line(),
            format!("a condition in {what} isn't one this reader knows"),
        ));
    }
    let platforms = match argument(&args, "platforms") {
        Some(value) => env
            .list(value, what)?
            .iter()
            .map(|item| member(env, item, "a platform"))
            .collect::<Result<_, _>>()?,
        None => Vec::new(),
    };
    let traits = match argument(&args, "traits") {
        Some(value) => env
            .list(value, what)?
            .iter()
            .map(|item| env.string(item, "a trait"))
            .collect::<Result<_, _>>()?,
        None => Vec::new(),
    };
    Ok(Condition { platforms, traits })
}
