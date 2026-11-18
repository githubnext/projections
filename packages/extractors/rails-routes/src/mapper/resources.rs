//! `resources` and `resource`, and the member, collection, new and nested
//! scopes inside them (`Mapper::Resources`).

use super::Mapper;
use super::options::Options;
use crate::resource::{self, Resource};
use crate::scope::{Level, join_name, join_path};
use anyhow::Result;
use projections_extractor_ruby_support::{Call, Expr, Stmt};
use std::rc::Rc;

/// The options a resource reads itself; the others scope it.
const RESOURCE_OPTIONS: &[&str] = &["as", "controller", "path", "only", "except", "param", "concerns"];

impl Mapper<'_> {
    pub(super) fn resources_call(&mut self, expr: &Expr, call: &Call, options: Options, singleton: bool) -> Result<()> {
        let names: Option<Vec<String>> = call.positional().map(|p| p.name().map(str::to_owned)).collect();
        let Some(names) = names.filter(|n| !n.is_empty()) else {
            self.unresolved(&expr.text, expr.line, "Its resource name is computed");
            return Ok(());
        };
        let body = Self::block(call).to_vec();
        for name in names {
            self.resource(expr, &name, options.clone(), &body, singleton)?;
        }
        Ok(())
    }

    /// `Mapper#apply_common_behavior_for`, then the resource itself.
    fn resource(&mut self, expr: &Expr, name: &str, mut options: Options, body: &[Stmt], singleton: bool) -> Result<()> {
        if options.truthy("shallow") {
            options.take("shallow");
            let mut frame = self.top().clone();
            frame.shallow = true;
            return self.within(frame, |m| m.resource(expr, name, options, body, singleton));
        }
        if self.top().resource_scope() {
            return self.resource_level(expr, "nested", |m| m.resource(expr, name, options, body, singleton));
        }
        let scope_options = options.without(RESOURCE_OPTIONS);
        if !scope_options.is_empty() {
            let frame = self.scope(&scope_options, None);
            let options = options.only(RESOURCE_OPTIONS);
            return self.within(frame, |m| m.resource(expr, name, options, body, singleton));
        }
        let mut frame = self.top().clone();
        frame.level = if singleton { Level::Resource } else { Level::Resources };
        let (only, except) = match (options.has("only") || options.has("except"), &frame.only, &frame.except) {
            (false, only, except) => (only.clone(), except.clone()),
            (true, ..) => (options.names("only"), options.names("except")),
        };
        let resource_options = resource::Options {
            as_: options.name("as"),
            path: options.name("path"),
            controller: options.name("controller"),
            param: options.name("param"),
            only,
            except,
        };
        let resource = Rc::new(Resource::new(
            name,
            singleton,
            frame.shallow,
            self.api_only,
            &resource_options,
            self.inflections,
        ));
        frame.shallow_depth += usize::from(resource.shallow);
        frame.controller = Some(resource.controller.clone());
        frame.resource = Some(resource.clone());
        let concerns = options.names("concerns").unwrap_or_default();
        self.within(frame, |m| {
            m.run(body)?;
            m.concerns_call(expr, &concerns)?;
            m.default_routes(expr, &resource)
        })
    }

    fn default_routes(&mut self, expr: &Expr, resource: &Resource) -> Result<()> {
        let route =
            |m: &mut Self, verb: &str, action: &str| m.decomposed_match(expr, action, None, &Options::default(), &[verb.to_owned()]);
        let has = |action: &str| resource.has_action(action);
        if !resource.singleton {
            self.resource_level(expr, "collection", |m| {
                if has("index") {
                    route(m, "GET", "index")?;
                }
                if has("create") {
                    route(m, "POST", "create")?;
                }
                Ok(())
            })?;
        }
        if has("new") {
            self.resource_level(expr, "new", |m| route(m, "GET", "new"))?;
        }
        self.resource_level(expr, "member", |m| {
            for (verb, action) in [
                ("GET", "edit"),
                ("GET", "show"),
                ("PATCH", "update"),
                ("PUT", "update"),
                ("DELETE", "destroy"),
            ] {
                if has(action) {
                    route(m, verb, action)?;
                }
            }
            Ok(())
        })?;
        if resource.singleton && has("create") {
            self.resource_level(expr, "collection", |m| route(m, "POST", "create"))?;
        }
        Ok(())
    }

    /// `member`, `collection`, `new` or `nested` with a block.
    pub(super) fn resource_block(&mut self, expr: &Expr, kind: &str, body: &[Stmt]) -> Result<()> {
        let body = body.to_vec();
        self.resource_level(expr, kind, |m| m.run(&body))
    }

    /// `Mapper#shallow?`: inside a shallow scope, except for a singleton.
    fn shallow(&self) -> bool {
        let frame = self.top();
        frame.shallow && frame.resource.as_ref().is_some_and(|r| !r.singleton)
    }

    /// `Mapper#shallow_scope`: the shallow path and name prefix replace the scope's own.
    fn shallow_frame(&self) -> crate::scope::Frame {
        let mut frame = self.top().clone();
        frame.path = frame.shallow_path.clone().unwrap_or_default();
        frame.as_ = frame.shallow_prefix.clone();
        frame
    }

    /// Runs `body` in a resource's member, collection, new or nested scope.
    pub(super) fn resource_level(&mut self, expr: &Expr, kind: &str, body: impl FnOnce(&mut Self) -> Result<()>) -> Result<()> {
        let Some(resource) = self.top().resource.clone().filter(|_| self.top().resource_scope()) else {
            self.unresolved(&expr.text, expr.line, &format!("`{kind}` is only valid inside a resource"));
            return Ok(());
        };
        let shallow = self.shallow();
        let mut frame = if shallow && (kind == "member" || (kind == "nested" && self.top().shallow_depth >= 1)) {
            self.shallow_frame()
        } else {
            self.top().clone()
        };
        let (level, path) = match kind {
            "member" => (Level::Member, resource.member_scope()),
            "collection" => (Level::Collection, resource.collection_scope()),
            "new" => (Level::New, resource.new_scope("new")),
            _ => (Level::Nested, resource.nested_scope()),
        };
        frame.level = level;
        frame.path = join_path(&frame.path, &path);
        if level == Level::Nested {
            frame.as_ = Some(join_name(frame.as_.as_deref(), resource.member_name()));
        }
        self.within(frame, body)
    }
}
