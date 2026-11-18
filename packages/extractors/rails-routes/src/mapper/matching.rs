//! `match`, the verb methods and `root`: how one routing call becomes
//! routes, with their paths, names and endpoints (`Mapper#map_match`,
//! `#decomposed_match`, `#add_route`, `#name_for_action` and `Mapping`).

use super::options::{Options, entries, pair_text};
use super::{Mapper, Route};
use crate::scope::{Format, Level, normalize_name, normalize_path};
use anyhow::Result;
use projections_extractor_ruby_support::{Call, Expr, Kind};

/// A path argument: a string is a path, a symbol an action.
#[derive(Clone, Debug)]
enum PathArg {
    Path(String),
    Action(String),
}

/// The options `map_match` and `add_route` read themselves.
const MATCH_OPTIONS: &[&str] = &[
    "controller",
    "action",
    "path",
    "to",
    "via",
    "format",
    "anchor",
    "constraints",
    "as",
    "on",
    "defaults",
    "internal",
];

pub(super) fn word_path(action: &str) -> bool {
    !action.is_empty() && action.chars().all(|c| c.is_alphanumeric() || matches!(c, '_' | '-' | '/'))
}

/// `get "photos/search"` without `to:` means `photos#search`.
fn to_from_path(path: &str) -> Option<String> {
    let without_format = path.strip_suffix("(.:format)").unwrap_or(path);
    let trimmed = without_format.trim_start_matches('/');
    let (controller, action) = trimmed.rsplit_once('/')?;
    let valid = |s: &str| !s.is_empty() && s.chars().all(|c| c.is_alphanumeric() || matches!(c, '_' | '-' | '/'));
    (valid(controller) && valid(action)).then(|| format!("{controller}#{action}").replace('-', "_"))
}

impl Mapper<'_> {
    /// `get`, `post` and the other verb methods: `match` with `via:` the verb.
    pub(super) fn map_method(&mut self, expr: &Expr, call: &Call, mut options: Options, verb: &str) -> Result<()> {
        options.take("via");
        options.0.push((
            "via".into(),
            Expr {
                kind: Kind::Symbol(verb.to_lowercase()),
                line: expr.line,
                text: String::new(),
            },
        ));
        self.match_call(expr, call, options)
    }

    pub(super) fn match_call(&mut self, expr: &Expr, call: &Call, mut options: Options) -> Result<()> {
        let mut paths = Vec::new();
        for arg in call.positional() {
            match &arg.kind {
                Kind::Str { value, .. } => paths.push(PathArg::Path(value.clone())),
                Kind::Symbol(action) => paths.push(PathArg::Action(action.clone())),
                Kind::Array(_) => paths.extend(arg.names().unwrap_or_default().into_iter().map(PathArg::Path)),
                _ => {}
            }
        }
        if paths.is_empty() {
            // The hash form: `get "about" => "pages#about"`.
            let Some((path, to)) = call.pairs().find_map(|(k, v)| k.string().map(|p| (p.to_owned(), v.clone()))) else {
                self.unresolved(&expr.text, expr.line, "It names no path");
                return Ok(());
            };
            options.0.retain(|(k, _)| k != &path);
            match to.kind {
                Kind::Symbol(ref action) => options.0.push(("action".into(), literal_name(action, to.line))),
                Kind::Str { ref value, .. } if !value.contains('#') => options.0.push(("controller".into(), to.clone())),
                _ => options.0.push(("to".into(), to)),
            }
            paths.push(PathArg::Path(path));
        }
        self.map_match(expr, paths, options)
    }

    fn map_match(&mut self, expr: &Expr, paths: Vec<PathArg>, options: Options) -> Result<()> {
        if let Some(on) = options
            .name("on")
            .filter(|on| !matches!(on.as_str(), "member" | "collection" | "new"))
        {
            self.unresolved(&expr.text, expr.line, &format!("`on: :{on}` isn't member, collection or new"));
            return Ok(());
        }
        let via = options.names("via").or_else(|| self.top().via.clone());
        let Some(via) = via else {
            self.unresolved(&expr.text, expr.line, "`match` without `via:` raises an error in Rails");
            return Ok(());
        };
        let verbs: Vec<String> = if via.iter().any(|v| v == "all") {
            vec!["ANY".into()]
        } else {
            via.iter().map(|v| v.to_uppercase()).collect()
        };
        for path in paths {
            let mut route_options = options.clone();
            let option_path = route_options.name("path");
            let (action, path) = match path {
                PathArg::Path(path) => {
                    if !route_options.has("to") && !route_options.has("action") {
                        if let Some(to) = to_from_path(&path) {
                            let text = format!("{to:?}");
                            let kind = Kind::Str {
                                value: to,
                                interpolated: false,
                            };
                            route_options.0.push((
                                "to".into(),
                                Expr {
                                    kind,
                                    line: expr.line,
                                    text,
                                },
                            ));
                        }
                    }
                    (path.clone(), Some(path))
                }
                PathArg::Action(action) => (action, option_path),
            };
            self.decomposed_match(expr, &action, path.as_deref(), &route_options, &verbs)?;
        }
        Ok(())
    }

    pub(super) fn decomposed_match(
        &mut self,
        expr: &Expr,
        action: &str,
        path: Option<&str>,
        options: &Options,
        verbs: &[String],
    ) -> Result<()> {
        if let Some(on) = options.name("on") {
            let rest = options.without(&["on"]);
            return self.resource_level(expr, &on, |m| m.decomposed_match(expr, action, path, &rest, verbs));
        }
        match self.top().level {
            Level::Resources => self.resource_level(expr, "nested", |m| m.decomposed_match(expr, action, path, options, verbs)),
            Level::Resource => self.resource_level(expr, "member", |m| m.decomposed_match(expr, action, path, options, verbs)),
            _ => {
                self.add_route(expr, action, path, options, verbs);
                Ok(())
            }
        }
    }

    fn path_for_action(&self, action: Option<&str>, path: Option<&str>) -> String {
        let scope = &self.top().path;
        match path {
            Some(path) => format!("{scope}/{path}"),
            None if self.top().canonical_action(action) => scope.clone(),
            None => format!("{scope}/{}", action.unwrap_or_default()),
        }
    }

    /// `Mapper#name_for_action`: the route's name, or `None`.
    pub(super) fn name_for_action(&self, as_: Option<&str>, action: Option<&str>) -> Option<String> {
        let frame = self.top();
        let prefix = as_
            .or_else(|| action.filter(|a| !frame.canonical_action(Some(a))))
            .filter(|p| !p.is_empty() && *p != "/")
            .map(|p| normalize_name(&p.replace('-', "_")));
        let (collection, member) = match &frame.resource {
            Some(_) if as_.is_none() && action.is_none() => return None,
            Some(resource) => (Some(resource.collection_name()), Some(resource.member_name().to_owned())),
            None => (None, None),
        };
        let parts = frame.action_name(frame.as_.as_deref(), prefix.as_deref(), collection.as_deref(), member.as_deref());
        let candidate = parts.into_iter().flatten().filter(|p| !p.is_empty()).collect::<Vec<_>>().join("_");
        if candidate.is_empty() {
            return None;
        }
        let valid = candidate.starts_with(|c: char| c.is_ascii_alphabetic() || c == '_');
        (as_.is_some() || (valid && !self.names.contains(&candidate))).then_some(candidate)
    }

    fn add_route(&mut self, expr: &Expr, action: &str, path: Option<&str>, options: &Options, verbs: &[String]) {
        let frame = self.top().clone();
        let raw_path = self.path_for_action(Some(action), path);
        let mut default_action = options.name("action").or_else(|| frame.action.clone());
        let action = word_path(action).then_some(action);
        if let Some(action) = action.filter(|a| !a.contains('/')) {
            default_action.get_or_insert_with(|| action.replace('-', "_"));
        }
        let name = if options.falsy("as") {
            None
        } else {
            self.name_for_action(options.name("as").as_deref(), action)
        };
        let path = normalize_path(&raw_path);
        let format = options.get("format").map(super::format_of).or(frame.format).unwrap_or_default();
        let pattern = match format {
            Format::Required => format!("{path}.:format"),
            Format::Optional if !(path.ends_with('/') || path.ends_with("(.:format)") || path.ends_with(".:format")) => {
                format!("{path}(.:format)")
            }
            _ => path.clone(),
        };
        let default_controller = options.name("controller").or_else(|| frame.controller.clone());
        let (controller, action, endpoint) = match options.get("to") {
            Some(Expr {
                kind: Kind::Str { value, .. },
                ..
            }) => match value.split_once('#') {
                Some((controller, action)) => (Some(controller.to_owned()), Some(action.to_owned()), None),
                None => (default_controller, Some(value.clone()), None),
            },
            Some(to) => (None, None, Some(to.text.clone())),
            None => (default_controller, default_action, None),
        };
        // Without a controller, a namespace's module is the controller: `namespace :reports do get :sales end`.
        let controller = controller
            .map(|c| frame.qualify(&c))
            .or_else(|| frame.module.clone().filter(|_| endpoint.is_none()));
        if endpoint.is_none() && (controller.is_none() || (action.is_none() && !path.contains(":action"))) {
            let missing = if controller.is_none() { "controller" } else { "action" };
            self.unresolved(
                &expr.text,
                expr.line,
                &format!("Its {missing} isn't given, which raises an error in Rails"),
            );
            return;
        }
        let mut constraints = frame.constraints.clone();
        let mut defaults = frame.defaults.clone();
        if let Some(value) = options.get("constraints") {
            constraints.extend(entries(value));
        }
        if let Some(value) = options.get("defaults") {
            defaults.extend(entries(value));
        }
        for (key, value) in &options.without(MATCH_OPTIONS).0 {
            match value.kind {
                Kind::Regex(_) => constraints.push(pair_text(key, value)),
                _ => defaults.push(pair_text(key, value)),
            }
        }
        if let Some(name) = &name {
            self.names.insert(name.clone());
        }
        self.routes.push(Route {
            verbs: verbs.to_vec(),
            path,
            pattern,
            controller,
            action,
            endpoint,
            name,
            constraints,
            defaults,
            conditions: frame.conditions.clone(),
            mount: false,
            source: self.source.clone(),
            line: expr.line,
        });
    }

    pub(super) fn root(&mut self, expr: &Expr, call: &Call, mut options: Options) -> Result<()> {
        if let Some(to) = call.positional().next() {
            options.0.push(("to".into(), to.clone()));
        }
        if !options.has("as") {
            options.0.push(("as".into(), literal_name("root", expr.line)));
        }
        if !options.has("via") {
            options.0.push(("via".into(), literal_name("get", expr.line)));
        }
        let paths = vec![PathArg::Path("/".into())];
        if matches!(self.top().level, Level::Resources | Level::Resource) {
            let resource = self.top().resource.clone().expect("resource levels have a resource");
            let mut frame = self.top().clone();
            frame.level = Level::Root;
            frame.path = crate::scope::join_path(&frame.path, &resource.path);
            return self.within(frame, |m| m.map_match(expr, paths, options));
        }
        self.map_match(expr, paths, options)
    }
}

fn literal_name(name: &str, line: usize) -> Expr {
    Expr {
        kind: Kind::Symbol(name.to_owned()),
        line,
        text: format!(":{name}"),
    }
}

#[cfg(test)]
mod tests {
    use super::to_from_path;

    #[test]
    fn derives_endpoints_and_names_as_rails_does() {
        assert_eq!(to_from_path("photos/search").as_deref(), Some("photos#search"));
        assert_eq!(to_from_path("/admin/photo-albums/list").as_deref(), Some("admin/photo_albums#list"));
        assert_eq!(to_from_path("about"), None);
        assert_eq!(to_from_path("photos/:id"), None);
    }
}
