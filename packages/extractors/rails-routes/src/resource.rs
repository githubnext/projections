//! Resources as ActionDispatch models them (`Mapper::Resource` and
//! `Mapper::SingletonResource`): their names, paths, controllers and actions.

use projections_extractor_ruby_support::inflect::Inflections;

#[derive(Clone, Debug)]
pub struct Resource {
    pub path: String,
    pub controller: String,
    pub param: String,
    pub singleton: bool,
    pub shallow: bool,
    only: Option<Vec<String>>,
    except: Option<Vec<String>>,
    api_only: bool,
    plural: String,
    singular: String,
}

/// The options `resources` and `resource` read themselves.
#[derive(Clone, Debug, Default)]
pub struct Options {
    pub as_: Option<String>,
    pub path: Option<String>,
    pub controller: Option<String>,
    pub param: Option<String>,
    pub only: Option<Vec<String>>,
    pub except: Option<Vec<String>>,
}

impl Resource {
    pub fn new(entities: &str, singleton: bool, shallow: bool, api_only: bool, options: &Options, inflections: &Inflections) -> Self {
        let name = options.as_.clone().unwrap_or_else(|| entities.to_owned());
        let (plural, singular) = if singleton {
            (inflections.pluralize(&name), name.clone())
        } else {
            (name.clone(), inflections.singularize(&name))
        };
        let controller = options.controller.clone().unwrap_or_else(|| {
            if singleton {
                // A singleton's controller is plural, from its own name rather than `as:`.
                inflections.pluralize(entities)
            } else {
                entities.to_owned()
            }
        });
        Resource {
            path: options.path.clone().unwrap_or_else(|| entities.to_owned()),
            controller,
            param: options.param.clone().unwrap_or_else(|| "id".to_owned()),
            singleton,
            shallow,
            only: options.only.clone(),
            except: options.except.clone(),
            api_only,
            plural,
            singular,
        }
    }

    fn default_actions(&self) -> &'static [&'static str] {
        match (self.singleton, self.api_only) {
            (false, false) => &["index", "create", "new", "show", "update", "destroy", "edit"],
            (false, true) => &["index", "create", "show", "update", "destroy"],
            (true, false) => &["show", "create", "update", "destroy", "new", "edit"],
            (true, true) => &["show", "create", "update", "destroy"],
        }
    }

    pub fn has_action(&self, action: &str) -> bool {
        let available = match &self.only {
            Some(only) => only.iter().any(|a| a == action),
            None => self.default_actions().contains(&action),
        };
        available && !self.except.as_ref().is_some_and(|except| except.iter().any(|a| a == action))
    }

    pub fn member_name(&self) -> &str {
        &self.singular
    }

    pub fn collection_name(&self) -> String {
        if self.singleton {
            self.singular.clone()
        } else if self.singular == self.plural {
            format!("{}_index", self.plural)
        } else {
            self.plural.clone()
        }
    }

    pub fn collection_scope(&self) -> String {
        self.path.clone()
    }

    pub fn member_scope(&self) -> String {
        if self.singleton {
            self.path.clone()
        } else {
            format!("{}/:{}", self.path, self.param)
        }
    }

    pub fn new_scope(&self, new_path: &str) -> String {
        format!("{}/{new_path}", self.path)
    }

    pub fn nested_param(&self) -> String {
        format!("{}_{}", self.singular, self.param)
    }

    pub fn nested_scope(&self) -> String {
        if self.singleton {
            self.path.clone()
        } else {
            format!("{}/:{}", self.path, self.nested_param())
        }
    }
}
