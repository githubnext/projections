//! The repository's Kubernetes workloads, and which policies' scopes cover them.

use crate::policy::Model;
use crate::scope::{Workloads, matches};
use anyhow::{Result, ensure};
use projections_extractor_sdk::{globs, key, parse_yaml_documents, read_source, text};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

const WORKLOAD_KINDS: &[&str] = &["Deployment", "StatefulSet", "DaemonSet", "ReplicaSet", "Job", "CronJob", "Pod"];

/// The repository's Kubernetes workloads and which policies cover them.
pub fn workloads(model: &mut Model, root: &Path, files: &[String], patterns: &Value, namespace: Option<&str>) -> Result<()> {
    let include = globs(Some(patterns), "inputs.workloadPaths")?;
    let mut matched: Vec<&String> = files.iter().filter(|file| include.iter().any(|glob| glob.is_match(file))).collect();
    matched.sort();
    ensure!(!matched.is_empty(), "inputs.workloadPaths matches no files");
    let mut seen = BTreeSet::new();
    for file in matched {
        let source = read_source(root, file)?;
        if !WORKLOAD_KINDS.iter().any(|kind| source.contains(kind)) {
            continue;
        }
        for document in parse_yaml_documents(&source, file)? {
            let items: Vec<&Value> = if document["kind"].as_str().is_some_and(|kind| kind.ends_with("List")) {
                document["items"].as_array().map(|items| items.iter().collect()).unwrap_or_default()
            } else {
                vec![&document]
            };
            for item in items {
                let kind = item["kind"].as_str().unwrap_or_default();
                if !WORKLOAD_KINDS.contains(&kind) {
                    continue;
                }
                workload(model, item, kind, file, namespace, &mut seen)?;
            }
        }
    }
    model.limitations.insert(
        "Workload coverage is derived from each policy's own scope and the workloads' pod template labels and containers; rule-level `matchWorkloads`, pods created outside these manifests and host processes aren't included.".into(),
    );
    Ok(())
}

/// Whether a policy's scope covers a workload: `None` for no, `Some(None)` for
/// every container, `Some(Some(names))` for the containers a container selector picks.
fn covers(
    scope: &Workloads,
    namespace: &str,
    labels: &BTreeMap<String, String>,
    containers: &[(String, String)],
) -> Option<Option<Vec<String>>> {
    if scope.all {
        return Some(None);
    }
    let pods = scope.pods.as_ref()?;
    if let Some(policy_namespace) = &scope.namespace
        && (policy_namespace.is_empty() || policy_namespace != namespace)
    {
        return None;
    }
    if !matches(pods, labels) {
        return None;
    }
    match scope.containers.as_ref().filter(|selector| !selector.is_empty()) {
        None => Some(None),
        Some(selector) => {
            let picked: Vec<String> = containers
                .iter()
                .filter(|(name, repo)| {
                    matches(
                        selector,
                        &BTreeMap::from([("name".to_owned(), name.clone()), ("repo".to_owned(), repo.clone())]),
                    )
                })
                .map(|(name, _)| name.clone())
                .collect();
            (!picked.is_empty()).then_some(Some(picked))
        }
    }
}

/// One workload, recorded as an entity, and the policies that cover it.
fn workload(model: &mut Model, item: &Value, kind: &str, file: &str, namespace: Option<&str>, seen: &mut BTreeSet<String>) -> Result<()> {
    let name = text(&item["metadata"]["name"], &format!("{file}: {kind} metadata.name"))?;
    let workload_namespace = item["metadata"]["namespace"].as_str().or(namespace).unwrap_or("default");
    let template = match kind {
        "Pod" => item,
        "CronJob" => &item["spec"]["jobTemplate"]["spec"]["template"],
        _ => &item["spec"]["template"],
    };
    let mut labels: BTreeMap<String, String> = template["metadata"]["labels"]
        .as_object()
        .map(|labels| {
            labels
                .iter()
                .map(|(k, v)| (k.clone(), v.as_str().map(str::to_owned).unwrap_or_else(|| v.to_string())))
                .collect()
        })
        .unwrap_or_default();
    let pod_labels = labels.clone();
    labels.insert("k8s:io.kubernetes.pod.namespace".into(), workload_namespace.to_owned());
    let containers: Vec<(String, String)> = template["spec"]["containers"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|container| {
            let image = container["image"].as_str().unwrap_or_default();
            let repo = image.split('@').next().unwrap_or(image);
            let repo = match repo.rsplit_once(':') {
                Some((head, tag)) if !tag.contains('/') => head,
                _ => repo,
            };
            (container["name"].as_str().unwrap_or_default().to_owned(), repo.to_owned())
        })
        .collect();
    let id = key(&["workload", kind, workload_namespace, name]);
    ensure!(
        seen.insert(id.clone()),
        "{kind} {name} in namespace {workload_namespace} is declared more than once (again in {file})"
    );
    model.entities.push(json!({
        "id":id,"kind":"workload","label":name,"confidence":"authoritative",
        "data":{"resource":kind,"name":name,"namespace":workload_namespace,"labels":pod_labels,
            "containers":containers.iter().map(|(name, repo)| json!({"name":name,"repo":repo})).collect::<Vec<_>>(),"path":file},
        "evidence":[{"kind":"kubernetes-manifest","source":file}],
    }));
    let scopes: Vec<(String, Workloads)> = model.scopes.clone();
    for (policy, scope) in scopes {
        if let Some(covered) = covers(&scope, workload_namespace, &labels, &containers) {
            let mut relationship = json!({
                "id":format!("covers:{policy}/{}", id.split_once(':').map_or(id.as_str(), |(_, rest)| rest)),
                "kind":"covers","from":policy,"to":id,"confidence":"derived",
            });
            if let Some(covered) = covered {
                relationship["data"] = json!({"containers":covered});
            }
            model.relationships.push(relationship);
        }
    }
    Ok(())
}
