//! The routing scope: what each `scope`, `namespace`, resource and member
//! block contributes to the routes inside it, as ActionDispatch's
//! `Mapper::Scope` merges it.

use crate::resource::Resource;
use regex::Regex;
use std::rc::Rc;
use std::sync::LazyLock;

/// ActionDispatch's scope levels: where a route is being declared.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub enum Level {
    #[default]
    Plain,
    Resources,
    Resource,
    Nested,
    Member,
    Collection,
    New,
    Root,
}

/// A route's `(.:format)` suffix: optional (the default), required or absent.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub enum Format {
    #[default]
    Optional,
    Required,
    Off,
}

#[derive(Clone, Debug, Default)]
pub struct Frame {
    pub path: String,
    pub shallow_path: Option<String>,
    pub as_: Option<String>,
    pub shallow_prefix: Option<String>,
    pub module: Option<String>,
    pub controller: Option<String>,
    pub action: Option<String>,
    /// Requirements as written: `subdomain: "api"`, `id: /\d+/`, a constraint object.
    pub constraints: Vec<String>,
    pub defaults: Vec<String>,
    /// Ruby conditions the routes are declared under: `if Rails.env.development?`.
    pub conditions: Vec<String>,
    pub shallow: bool,
    pub level: Level,
    pub resource: Option<Rc<Resource>>,
    /// Shallow resources among the enclosing resource scopes.
    pub shallow_depth: usize,
    pub only: Option<Vec<String>>,
    pub except: Option<Vec<String>>,
    pub via: Option<Vec<String>>,
    pub format: Option<Format>,
}

static SQUEEZE: LazyLock<Regex> = LazyLock::new(|| Regex::new("/+").unwrap());
static OPTIONAL_SLASH: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"/(\(+)/?").unwrap());
static LEADING_OPTIONAL: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(\(+)/").unwrap());
static ALL_OPTIONAL: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(\(+[^)]+\))(\(+/:[^)]+\))*$").unwrap());

/// `ActionDispatch::Routing::Mapper.normalize_path`: one leading slash, no
/// repeated or trailing ones, and `/(` turned into `(/`, except that a path
/// made only of optional segments keeps its leading `/`.
pub fn normalize_path(path: &str) -> String {
    let mut path = SQUEEZE.replace_all(&format!("/{path}"), "/").into_owned();
    if path != "/" && path.ends_with('/') {
        path.pop();
    }
    let path = OPTIONAL_SLASH.replace_all(&path, "$1/").into_owned();
    if ALL_OPTIONAL.is_match(&path) {
        return LEADING_OPTIONAL.replace(&path, "/$1").into_owned();
    }
    path
}

/// `Mapper.normalize_name`: a path as a route name segment.
pub fn normalize_name(name: &str) -> String {
    normalize_path(name)[1..].replace('/', "_")
}

pub fn join_path(parent: &str, child: &str) -> String {
    normalize_path(&format!("{parent}/{child}"))
}

pub fn join_name(parent: Option<&str>, child: &str) -> String {
    match parent {
        Some(parent) => format!("{parent}_{child}"),
        None => child.to_owned(),
    }
}

impl Frame {
    /// Whether this is a resource's own scope, where nested declarations nest.
    pub fn resource_scope(&self) -> bool {
        matches!(self.level, Level::Resources | Level::Resource)
    }

    /// Whether the scope is a resource's collection, member or new action.
    pub fn resource_method_scope(&self) -> bool {
        matches!(self.level, Level::Collection | Level::Member | Level::New)
    }

    pub fn canonical_action(&self, action: Option<&str>) -> bool {
        self.resource_method_scope() && action.is_some_and(|a| ["index", "create", "new", "show", "update", "destroy"].contains(&a))
    }

    /// The parts of a route name, in order, for this level: `Scope#action_name`.
    pub fn action_name<'a>(
        &self,
        name_prefix: Option<&'a str>,
        prefix: Option<&'a str>,
        collection: Option<&'a str>,
        member: Option<&'a str>,
    ) -> Vec<Option<&'a str>> {
        match self.level {
            Level::Nested => vec![name_prefix, prefix],
            Level::Collection => vec![prefix, name_prefix, collection],
            Level::New => vec![prefix, Some("new"), name_prefix, member],
            Level::Member => vec![prefix, name_prefix, member],
            Level::Root => vec![name_prefix, collection, prefix],
            _ => vec![name_prefix, member, prefix],
        }
    }

    /// The module-qualified controller: `admin/photos` in `namespace :admin`;
    /// a leading `/` opts out of the module.
    pub fn qualify(&self, controller: &str) -> String {
        match (controller.strip_prefix('/'), &self.module) {
            (Some(absolute), _) => absolute.to_owned(),
            (None, Some(module)) => format!("{module}/{controller}"),
            (None, None) => controller.to_owned(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::normalize_path;

    #[test]
    fn normalizes_paths_as_actiondispatch_does() {
        assert_eq!(normalize_path(""), "/");
        assert_eq!(normalize_path("//photos//new/"), "/photos/new");
        assert_eq!(normalize_path("(:locale)"), "/(:locale)");
        assert_eq!(normalize_path("/(:locale)/photos"), "(/:locale)/photos");
    }
}
