use super::model::{ChangeExpectation, Expectations, Selector, StepExpectation};
use super::read::Reader;
use super::{COLLECTIONS, CORRESPONDENCES, KINDS, STATUSES};
use projections_engine::pointer;
use serde_json::{Map, Value};

/// The fields a change expectation checks.
const CHECKED: [&str; 6] = ["status", "correspondence", "summary", "before", "after", "context"];

impl Reader {
    pub(super) fn expectations(&mut self, value: &Value, path: &str) -> Option<Expectations> {
        let fields = self.object(
            value,
            path,
            "`expect`",
            &["order", "steps", "changes", "count", "metadata", "error"],
        )?;
        let mut expect = Expectations::default();
        if let Some(order) = fields.get("order") {
            expect.order = self.strings(order, &pointer(path, "order"), "`order`");
            if expect.order.as_ref().is_some_and(|order| order.len() < 2) {
                self.error(&pointer(path, "order"), "`order` lists at least two IDs, earliest first");
            }
        }
        if let Some(steps) = fields.get("steps") {
            let at = pointer(path, "steps");
            match steps.as_array() {
                Some(items) => {
                    let mut parsed = Vec::new();
                    for (index, item) in items.iter().enumerate() {
                        parsed.push(self.step(item, &pointer(&at, &index.to_string())));
                    }
                    expect.steps = parsed.into_iter().collect();
                }
                None => self.error(&at, "`steps` must be the list of steps, in order"),
            }
        }
        if let Some(changes) = fields.get("changes") {
            let at = pointer(path, "changes");
            match changes.as_array() {
                Some(items) => {
                    for (index, item) in items.iter().enumerate() {
                        if let Some(change) = self.change(item, &pointer(&at, &index.to_string())) {
                            expect.changes.push(change);
                        }
                    }
                }
                None => self.error(&at, "`changes` must be a list of change expectations"),
            }
        }
        if let Some(count) = fields.get("count") {
            let at = pointer(path, "count");
            if let Some(counts) = self.object(count, &at, "`count`", &["changes", "steps"]) {
                for (key, value) in counts {
                    match value.as_u64() {
                        Some(number) if key == "changes" => expect.count_changes = Some(number),
                        Some(number) => expect.count_steps = Some(number),
                        None => self.error(&pointer(&at, key), format!("`count.{key}` must be a non-negative integer")),
                    }
                }
            }
        }
        if let Some(metadata) = fields.get("metadata") {
            if metadata.is_object() {
                expect.metadata = Some(metadata.clone());
            } else {
                self.error(&pointer(path, "metadata"), "`metadata` must be a mapping");
            }
        }
        if let Some(error) = fields.get("error") {
            expect.error = self.string(error, &pointer(path, "error"), "`error`");
        }
        Some(expect)
    }

    pub(super) fn step(&mut self, value: &Value, path: &str) -> Option<StepExpectation> {
        let fields = self.object(value, path, "A step", &["kind", "summary", "changes"])?;
        let mut step = StepExpectation::default();
        if let Some(kind) = fields.get("kind") {
            self.one_of(kind, &pointer(path, "kind"), "A step's `kind`", &KINDS);
            step.kind = Some(kind.clone());
        }
        if let Some(summary) = fields.get("summary") {
            if !summary.is_string() && !summary.is_null() {
                self.error(&pointer(path, "summary"), "`summary` must be a string or null");
            }
            step.summary = Some(summary.clone());
        }
        if let Some(changes) = fields.get("changes") {
            step.changes = self.strings(changes, &pointer(path, "changes"), "A step's `changes`");
        }
        Some(step)
    }

    /// A change's expected `context`: null for none, or the IDs of either
    /// revision and the rules that added them, each checked exactly.
    fn context(&mut self, value: &Value, path: &str) {
        if value.is_null() {
            return;
        }
        let Some(fields) = self.object(value, path, "`context`", &["before", "after", "rules"]) else {
            return;
        };
        if fields.is_empty() {
            self.error(
                path,
                "`context` checks at least one of `before`, `after` or `rules`; null expects none",
            );
        }
        for (key, value) in fields {
            self.strings(value, &pointer(path, key), &format!("`context.{key}`"));
        }
    }

    pub(super) fn change(&mut self, value: &Value, path: &str) -> Option<ChangeExpectation> {
        let fields = self.object(
            value,
            path,
            "A change expectation",
            &[
                "item",
                "id",
                "collection",
                "status",
                "correspondence",
                "summary",
                "before",
                "after",
                "context",
            ],
        )?;
        let selector = match (fields.get("item"), fields.get("id")) {
            (Some(item), None) => Selector::Item(self.string(item, &pointer(path, "item"), "`item`")?),
            (None, Some(id)) => Selector::Id(self.string(id, &pointer(path, "id"), "`id`")?),
            _ => {
                self.error(path, "A change expectation selects its change with exactly one of `item` or `id`");
                return None;
            }
        };
        let collection = fields.get("collection").map(|collection| {
            self.one_of(collection, &pointer(path, "collection"), "`collection`", &COLLECTIONS);
            collection.as_str().unwrap_or_default().to_owned()
        });
        let mut checked = Map::new();
        for (key, value) in fields {
            let at = pointer(path, key);
            match key.as_str() {
                "status" => self.one_of(value, &at, "`status`", &STATUSES),
                "correspondence" => self.one_of(value, &at, "`correspondence`", &CORRESPONDENCES),
                "summary" if !value.is_string() && !value.is_null() => self.error(&at, "`summary` must be a string or null"),
                "before" | "after" => {
                    self.strings(value, &at, &format!("`{key}`"));
                }
                "context" => self.context(value, &at),
                _ => {}
            }
            if CHECKED.contains(&key.as_str()) {
                checked.insert(key.clone(), value.clone());
            }
        }
        if checked.is_empty() {
            self.error(
                path,
                "A change expectation checks at least one of `status`, `correspondence`, `summary`, `before`, `after` or `context`",
            );
        }
        Some(ChangeExpectation {
            selector,
            collection,
            fields: checked,
        })
    }
}
