use super::matching::{ids, listed, matches, shown};
use super::model::{ChangeExpectation, Failure, Selector, Suite};
use serde_json::Value;

impl Suite {
    pub(super) fn change(&self, at: &str, expectation: &ChangeExpectation, changes: &[Value]) -> Vec<Failure> {
        let in_collection = |change: &&Value| {
            expectation
                .collection
                .as_deref()
                .is_none_or(|collection| change["collection"] == collection)
        };
        let (selected, token, field): (Vec<&Value>, &str, &str) = match &expectation.selector {
            Selector::Id(id) => (
                changes
                    .iter()
                    .filter(|change| change["id"] == id.as_str())
                    .filter(in_collection)
                    .collect(),
                id,
                "id",
            ),
            Selector::Item(item) => (
                changes
                    .iter()
                    .filter(|change| ids(&change["before"]).contains(&item.as_str()) || ids(&change["after"]).contains(&item.as_str()))
                    .filter(in_collection)
                    .collect(),
                item,
                "item",
            ),
        };
        let change = match selected.as_slice() {
            [change] => *change,
            [] => {
                let lowered = token.to_lowercase();
                let mut similar: Vec<&str> = changes
                    .iter()
                    .filter_map(|change| change["id"].as_str())
                    .filter(|id| {
                        let id = id.to_lowercase();
                        id.contains(&lowered) || lowered.contains(&id)
                    })
                    .collect();
                if similar.is_empty() {
                    similar = changes.iter().filter_map(|change| change["id"].as_str()).collect();
                }
                return vec![self.failure(
                    format!("{at}/{field}"),
                    format!(
                        "No change {} `{token}`{}; the changes include {}",
                        if field == "id" { "has the ID" } else { "includes the item" },
                        expectation
                            .collection
                            .as_deref()
                            .map_or(String::new(), |collection| format!(" in {collection}")),
                        if similar.is_empty() {
                            "nothing".into()
                        } else {
                            listed(&similar)
                        }
                    ),
                )];
            }
            many => {
                let candidates: Vec<String> = many
                    .iter()
                    .map(|change| {
                        format!(
                            "{} ({})",
                            change["id"].as_str().unwrap_or_default(),
                            change["collection"].as_str().unwrap_or_default()
                        )
                    })
                    .collect();
                return vec![self.failure(
                    format!("{at}/{field}"),
                    format!(
                        "{} changes include `{token}`: {}; select one by `id`, or narrow it with `collection`",
                        many.len(),
                        candidates.join(", ")
                    ),
                )];
            }
        };
        let id = change["id"].as_str().unwrap_or_default();
        expectation
            .fields
            .iter()
            .filter(|(key, value)| !matches(value, change.get(key.as_str())))
            .map(|(key, value)| {
                self.mismatched(
                    format!("{at}/{key}"),
                    format!(
                        "Change `{id}` has {key} {}; expected {}",
                        shown(change.get(key.as_str())),
                        shown(Some(value))
                    ),
                    value.clone(),
                    change.get(key.as_str()).cloned().unwrap_or(Value::Null),
                )
            })
            .collect()
    }
}
