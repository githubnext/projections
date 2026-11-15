//! Kubernetes label selectors and the workloads a policy or selector applies to.

use crate::terms::Terms;
use anyhow::{Result, bail, ensure};
use serde_json::{Map, Value, json};

/// One label requirement, normalized so equivalent spellings compare equal:
/// `matchLabels: {a: x}` and `a In [x]` are the same requirement.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Requirement {
    pub key: String,
    pub operator: String,
    pub values: Vec<String>,
}

impl Requirement {
    fn text(&self) -> String {
        let values = self.values.join(", ");
        match (self.operator.as_str(), self.values.len()) {
            ("In", 1) => format!("{}={}", self.key, values),
            ("NotIn", 1) => format!("{}!={}", self.key, values),
            ("In", _) => format!("{} in ({values})", self.key),
            ("NotIn", _) => format!("{} notin ({values})", self.key),
            ("Exists", _) => self.key.clone(),
            ("DoesNotExist", _) => format!("!{}", self.key),
            (operator, _) => format!("{} {operator} ({values})", self.key),
        }
    }
}

/// A label selector. `None` means the field was absent (`null`); an empty
/// requirement list is `{}`, which matches everything.
pub type Selector = Option<Vec<Requirement>>;

fn scalar(value: &Value, label: &str) -> Result<String> {
    Ok(match value {
        Value::String(text) => text.clone(),
        Value::Number(number) => number.to_string(),
        Value::Bool(flag) => flag.to_string(),
        _ => bail!("{label} must be a string"),
    })
}

pub fn selector(value: Option<&Value>, label: &str) -> Result<Selector> {
    let Some(value) = value.filter(|value| !value.is_null()) else {
        return Ok(None);
    };
    let Some(object) = value.as_object() else {
        bail!("{label} must be a label selector");
    };
    let mut requirements = vec![];
    for (field, content) in object {
        match field.as_str() {
            "matchLabels" if content.is_null() => {}
            "matchLabels" => {
                let Some(labels) = content.as_object() else {
                    bail!("{label}.matchLabels must be a map");
                };
                for (key, value) in labels {
                    requirements.push(Requirement {
                        key: key.clone(),
                        operator: "In".into(),
                        values: vec![scalar(value, &format!("{label}.matchLabels.{key}"))?],
                    });
                }
            }
            "matchExpressions" if content.is_null() => {}
            "matchExpressions" => {
                let Some(expressions) = content.as_array() else {
                    bail!("{label}.matchExpressions must be a list");
                };
                for (index, expression) in expressions.iter().enumerate() {
                    let path = format!("{label}.matchExpressions[{index}]");
                    let key = expression["key"].as_str().filter(|key| !key.is_empty());
                    let operator = expression["operator"].as_str();
                    let (Some(key), Some(operator)) = (key, operator) else {
                        bail!("{path} needs a key and an operator");
                    };
                    ensure!(
                        ["In", "NotIn", "Exists", "DoesNotExist"].contains(&operator),
                        "{path}.operator {operator} is not In, NotIn, Exists or DoesNotExist"
                    );
                    let mut values = match &expression["values"] {
                        Value::Null => vec![],
                        Value::Array(values) => values
                            .iter()
                            .map(|value| scalar(value, &format!("{path}.values")))
                            .collect::<Result<_>>()?,
                        _ => bail!("{path}.values must be a list"),
                    };
                    values.sort();
                    values.dedup();
                    requirements.push(Requirement {
                        key: key.into(),
                        operator: operator.into(),
                        values,
                    });
                }
            }
            other => bail!("{label}.{other} is not a label selector field"),
        }
    }
    requirements.sort();
    requirements.dedup();
    Ok(Some(requirements))
}

/// Whether `labels` satisfy every requirement, with Tetragon's semantics: `NotIn`
/// matches an absent label.
pub fn matches(requirements: &[Requirement], labels: &std::collections::BTreeMap<String, String>) -> bool {
    requirements.iter().all(|requirement| {
        let value = labels.get(&requirement.key);
        match requirement.operator.as_str() {
            "In" => value.is_some_and(|value| requirement.values.contains(value)),
            "NotIn" => value.is_none_or(|value| !requirement.values.contains(value)),
            "Exists" => value.is_some(),
            "DoesNotExist" => value.is_none(),
            _ => false,
        }
    })
}

/// Each requirement as code in kubectl's selector syntax, joined by commas.
pub fn selector_terms(selector: &[Requirement]) -> Terms {
    selector.iter().enumerate().fold(Terms::new(), |terms, (index, requirement)| {
        let terms = if index > 0 { terms.text(", ") } else { terms };
        terms.code(&requirement.text())
    })
}

pub fn selector_json(selector: &Selector) -> Value {
    match selector {
        None => Value::Null,
        Some(requirements) => Value::Array(
            requirements
                .iter()
                .map(|requirement| json!({"key":requirement.key,"operator":requirement.operator,"values":requirement.values}))
                .collect(),
        ),
    }
}

/// The workloads a policy, or a selector's `matchWorkloads`, applies to, after
/// Tetragon's filtering truth table:
/// <https://tetragon.io/docs/concepts/tracing-policy/k8s-filtering/#filtering-semantics>.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Workloads {
    /// Every host and pod workload: all three selectors omitted.
    pub all: bool,
    pub host: bool,
    /// Pods selected, `Some(vec![])` for every pod; `None` for no pods.
    pub pods: Selector,
    pub containers: Selector,
    /// The namespace of a namespaced policy, `Some("")` when it is taken from
    /// where the policy is applied.
    pub namespace: Option<String>,
}

impl Workloads {
    pub fn from(spec: &Map<String, Value>, label: &str, namespace: Option<String>) -> Result<Self> {
        let pods = selector(spec.get("podSelector"), &format!("{label}.podSelector"))?;
        let containers = selector(spec.get("containerSelector"), &format!("{label}.containerSelector"))?;
        let host = match selector(spec.get("hostSelector"), &format!("{label}.hostSelector"))? {
            None => false,
            Some(requirements) => {
                ensure!(requirements.is_empty(), "{label}.hostSelector must be null or {{}}");
                true
            }
        };
        if let Some(namespace) = namespace {
            ensure!(!host, "{label}.hostSelector must be null in a TracingPolicyNamespaced");
            return Ok(Self {
                all: false,
                host: false,
                pods: Some(pods.unwrap_or_default()),
                containers,
                namespace: Some(namespace),
            });
        }
        if pods.is_none() && containers.is_none() && !host {
            return Ok(Self {
                all: true,
                host: true,
                pods: Some(vec![]),
                containers: None,
                namespace: None,
            });
        }
        let pods = match pods {
            Some(pods) => Some(pods),
            None if containers.is_some() => Some(vec![]),
            None => None,
        };
        Ok(Self {
            all: false,
            host,
            pods,
            containers,
            namespace: None,
        })
    }

    pub fn terms(&self) -> Terms {
        if self.all {
            return Terms::new().text("all host and pod workloads");
        }
        let mut parts = vec![];
        if self.host {
            parts.push(Terms::new().text("host workloads"));
        }
        if let Some(pods) = &self.pods {
            let mut terms = match &self.namespace {
                Some(namespace) if namespace.is_empty() => Terms::new().text("pods in the namespace the policy is applied to"),
                Some(namespace) => Terms::new().text("pods in namespace ").code(namespace),
                None if pods.is_empty() => Terms::new().text("all pods"),
                None => Terms::new().text("pods"),
            };
            if !pods.is_empty() {
                terms = terms.text(" where ").extend(selector_terms(pods));
            }
            if let Some(containers) = self.containers.as_ref().filter(|c| !c.is_empty()) {
                terms = Terms::new()
                    .text("containers where ")
                    .extend(selector_terms(containers))
                    .text(" in ")
                    .extend(terms);
            }
            parts.push(terms);
        }
        match parts.len() {
            0 => Terms::new().text("no workloads"),
            _ => parts.into_iter().enumerate().fold(Terms::new(), |all, (index, part)| {
                (if index > 0 { all.text(" and ") } else { all }).extend(part)
            }),
        }
    }

    pub fn text(&self) -> String {
        self.terms().display()
    }

    pub fn data(&self) -> Value {
        json!({
            "subjectKind":"workloads","all":self.all,"host":self.host,
            "namespace":self.namespace,"pods":selector_json(&self.pods),
            "containers":selector_json(&self.containers),"display":self.terms().prose(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn workloads(spec: Value, namespace: Option<&str>) -> String {
        Workloads::from(spec.as_object().unwrap(), "spec", namespace.map(str::to_owned))
            .unwrap()
            .text()
    }

    #[test]
    fn follows_the_filtering_truth_table() {
        assert_eq!(workloads(json!({}), None), "all host and pod workloads");
        assert_eq!(workloads(json!({"hostSelector":{}}), None), "host workloads");
        assert_eq!(
            workloads(json!({"podSelector":{"matchLabels":{"app":"a"}}}), None),
            "pods where app=a"
        );
        assert_eq!(
            workloads(json!({"containerSelector":{"matchLabels":{"name":"c"}}}), None),
            "containers where name=c in all pods"
        );
        assert_eq!(
            workloads(
                json!({"hostSelector":{},"podSelector":{"matchExpressions":[{"key":"app","operator":"In","values":["b","a"]}]}}),
                None
            ),
            "host workloads and pods where app in (a, b)"
        );
        assert_eq!(workloads(json!({}), Some("checkout")), "pods in namespace checkout");
        assert_eq!(workloads(json!({}), Some("")), "pods in the namespace the policy is applied to");
    }

    #[test]
    fn equivalent_selectors_converge() {
        let a = selector(Some(&json!({"matchLabels":{"app":"a"}})), "s").unwrap();
        let b = selector(
            Some(&json!({"matchExpressions":[{"key":"app","operator":"In","values":["a"]}]})),
            "s",
        )
        .unwrap();
        assert_eq!(a, b);
    }

    #[test]
    fn rejects_invalid_selectors() {
        for (value, message) in [
            (json!({"hostSelector":{"matchLabels":{"a":"b"}}}), "null or {}"),
            (json!({"podSelector":{"nope":1}}), "not a label selector field"),
            (
                json!({"podSelector":{"matchExpressions":[{"key":"a","operator":"Like"}]}}),
                "is not In",
            ),
        ] {
            let error = Workloads::from(value.as_object().unwrap(), "spec", None).unwrap_err();
            assert!(error.to_string().contains(message), "{error}");
        }
    }
}
