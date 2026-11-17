//! `mount`: a Rack application or engine at a path, named as Rails names it.

use super::Mapper;
use super::Route;
use super::matching::word_path;
use super::options::{Options, entries};
use crate::scope::normalize_path;
use anyhow::Result;
use projections_extractor_ruby_support::{Call, Expr, Kind};

/// ActiveSupport's `underscore`: `Sidekiq::Web` is `sidekiq/web`.
fn underscore(name: &str) -> String {
    let mut result = String::new();
    let chars: Vec<char> = name.replace("::", "/").chars().collect();
    for (i, c) in chars.iter().enumerate() {
        if c.is_uppercase() && i > 0 {
            let previous = chars[i - 1];
            let next_lower = chars.get(i + 1).is_some_and(|n| n.is_lowercase());
            if previous.is_lowercase() || previous.is_ascii_digit() || (previous.is_uppercase() && next_lower) {
                result.push('_');
            }
        }
        result.extend(c.to_lowercase());
    }
    result
}

impl Mapper<'_> {
    pub(super) fn mount(&mut self, expr: &Expr, call: &Call, mut options: Options) -> Result<()> {
        let (app, at) = match call.positional().next() {
            Some(app) => (app.clone(), options.take("at").and_then(|at| at.name().map(str::to_owned))),
            None => match call.pairs().find(|(k, _)| k.name().is_none()) {
                Some((app, at)) => (app.clone(), at.name().map(str::to_owned)),
                None => (
                    Expr {
                        kind: Kind::Nil,
                        line: expr.line,
                        text: String::new(),
                    },
                    None,
                ),
            },
        };
        let (Some(at), false) = (at, app.is_nil()) else {
            self.unresolved(&expr.text, expr.line, "Its application or path is computed");
            return Ok(());
        };
        let name = match (options.falsy("as"), options.name("as"), &app.kind) {
            (true, ..) => None,
            (_, Some(as_), _) => Some(as_),
            // A Rails engine is named by its `engine_name`, by default its namespace underscored.
            (_, None, Kind::Const(constant)) => Some(match constant.strip_suffix("::Engine") {
                Some(namespace) => underscore(namespace).replace('/', "_"),
                None => underscore(constant).replace('/', "_"),
            }),
            _ => None,
        };
        let frame = self.top().clone();
        let path = normalize_path(&format!("{}/{at}", frame.path));
        let name = self.name_for_action(name.as_deref(), Some(&at).filter(|a| word_path(a)).map(String::as_str));
        if let Some(name) = &name {
            self.names.insert(name.clone());
        }
        let mut constraints = frame.constraints.clone();
        if let Some(value) = options.get("constraints") {
            constraints.extend(entries(value));
        }
        self.routes.push(Route {
            verbs: vec!["ANY".into()],
            pattern: path.clone(),
            path,
            controller: None,
            action: None,
            endpoint: Some(app.text.clone()),
            name,
            constraints,
            defaults: frame.defaults.clone(),
            conditions: frame.conditions.clone(),
            mount: true,
            source: self.source.clone(),
            line: expr.line,
        });
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::underscore;

    #[test]
    fn underscores_constants_as_activesupport_does() {
        assert_eq!(underscore("Sidekiq::Web"), "sidekiq/web");
        assert_eq!(underscore("GraphiQL::Rails::Engine"), "graphi_ql/rails/engine");
        assert_eq!(underscore("HTTPClient"), "http_client");
    }
}
