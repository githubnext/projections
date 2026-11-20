//! Writing the typed model as JSON: each type lists its entries, which
//! serialize to exactly the JSON the protocol defines, so `to_json` and the
//! bytes written agree.

use crate::model::{
    Change, Comparison, Context, Entity, Evidence, Extraction, Fields, ItemRef, Location, Number, Relationship, Reverse, Step,
};
use crate::volatility::{Declaration, Tolerance, Variation, Varied};
use serde::ser::{Serialize, Serializer};
use serde_json::{Value, json};

/// A model value as JSON.
pub(crate) fn to_value(value: &impl Serialize) -> Value {
    serde_json::to_value(value).expect("the model encodes as JSON")
}

/// One entry's value.
enum Field<'a> {
    Text(&'a str),
    Bool(bool),
    Number(Number),
    Count(usize),
    Fields(&'a Fields),
    Texts(&'a [String]),
    Names(&'a [&'static str]),
    Evidence(&'a [Evidence]),
    Location(&'a Location),
    Declarations(&'a [Declaration]),
    Tolerance(&'a Tolerance),
    Entities(&'a [Entity]),
    Relationships(&'a [Relationship]),
    Varied(&'a [Varied]),
    Context(&'a Context),
    Changes(&'a [Change]),
    Steps(&'a [Step]),
    Object(Vec<Entry<'a>>),
}

/// A key and, when the entry is written, its value.
type Entry<'a> = (&'static str, Option<Field<'a>>);

impl Serialize for Field<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Field::Text(text) => serializer.serialize_str(text),
            Field::Bool(value) => serializer.serialize_bool(*value),
            Field::Number(number) => number.serialize(serializer),
            Field::Count(count) => serializer.serialize_u64(*count as u64),
            Field::Fields(fields) => serializer.collect_map(*fields),
            Field::Texts(texts) => serializer.collect_seq(*texts),
            Field::Names(names) => serializer.collect_seq(*names),
            Field::Evidence(evidence) => serializer.collect_seq(*evidence),
            Field::Location(location) => location.serialize(serializer),
            Field::Declarations(declarations) => serializer.collect_seq(*declarations),
            Field::Tolerance(tolerance) => tolerance.serialize(serializer),
            Field::Entities(entities) => serializer.collect_seq(*entities),
            Field::Relationships(relationships) => serializer.collect_seq(*relationships),
            Field::Varied(varied) => serializer.collect_seq(*varied),
            Field::Context(context) => context.serialize(serializer),
            Field::Changes(changes) => serializer.collect_seq(*changes),
            Field::Steps(steps) => serializer.collect_seq(*steps),
            Field::Object(entries) => object(serializer, entries),
        }
    }
}

/// The entries that are written, as an object.
fn object<'a, S: Serializer>(serializer: S, entries: &'a [Entry<'a>]) -> Result<S::Ok, S::Error> {
    serializer.collect_map(entries.iter().filter_map(|(key, value)| value.as_ref().map(|value| (*key, value))))
}

/// A list, written only when it has members.
fn nonempty<T>(list: &[T]) -> Option<&[T]> {
    (!list.is_empty()).then_some(list)
}

/// Implements `Serialize` as an object of the type's entries.
macro_rules! entries {
    ($type:ty, |$this:ident| $entries:expr) => {
        impl Serialize for $type {
            fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
                let $this = self;
                object(serializer, &$entries)
            }
        }
    };
}

entries!(Location, |this| [
    ("line", Some(Field::Number(this.line))),
    ("column", this.column.map(Field::Number)),
]);

entries!(Evidence, |this| [
    ("kind", Some(Field::Text(&this.kind))),
    ("source", Some(Field::Text(&this.source))),
    ("location", this.location.as_ref().map(Field::Location)),
]);

entries!(ItemRef<'_>, |this| [
    ("id", Some(Field::Text(this.id))),
    ("kind", Some(Field::Text(this.kind))),
    ("label", this.label.map(Field::Text)),
    ("from", this.endpoints.map(|[from, _]| Field::Text(from))),
    ("to", this.endpoints.map(|[_, to]| Field::Text(to))),
    ("data", Some(Field::Fields(this.data))),
    ("previousIds", this.previous_ids.map(Field::Texts)),
    ("evidence", this.evidence.map(Field::Evidence)),
    ("confidence", this.confidence.map(|confidence| Field::Text(confidence.name()))),
]);

impl ItemRef<'_> {
    /// The item as JSON, as its normalized extraction lists it.
    pub fn to_json(&self) -> Value {
        to_value(self)
    }
}

impl Serialize for Entity {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.view().serialize(serializer)
    }
}

impl Serialize for Relationship {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.view().serialize(serializer)
    }
}

entries!(Tolerance, |this| [
    ("absolute", this.absolute.map(Field::Number)),
    ("relative", this.relative.map(Field::Number)),
    ("spread", this.spread.as_ref().map(|spread| Field::Text(spread.as_str()))),
    ("factor", this.factor.map(Field::Number)),
]);

entries!(Declaration, |this| [
    ("collection", Some(Field::Text(this.collection.name()))),
    ("kinds", this.kinds.as_deref().map(Field::Texts)),
    ("path", Some(Field::Text(this.path.as_str()))),
    ("generated", this.basis.as_ref().map(|_| Field::Bool(true))),
    ("basis", this.basis.as_ref().map(|basis| Field::Text(basis.as_str()))),
    ("tolerance", this.tolerance.as_ref().map(Field::Tolerance)),
]);

entries!(Extraction, |this| [
    ("protocolVersion", Some(Field::Number(this.protocol_version))),
    ("schema", Some(Field::Text(this.schema))),
    ("vocabularies", nonempty(&this.vocabularies).map(Field::Names)),
    ("missingInputs", nonempty(&this.missing_inputs).map(Field::Texts)),
    ("metadata", this.metadata.as_ref().map(Field::Fields)),
    ("volatile", nonempty(&this.volatile).map(Field::Declarations)),
    ("entities", Some(Field::Entities(&this.entities))),
    ("relationships", Some(Field::Relationships(&this.relationships))),
]);

impl Extraction {
    /// The normalized extraction as JSON.
    pub fn to_json(&self) -> Value {
        to_value(self)
    }
}

entries!(Varied, |this| [
    ("path", Some(Field::Text(&this.path))),
    ("within", Some(Field::Bool(this.within))),
    ("reason", this.reason.as_deref().map(Field::Text)),
    ("generated", this.generated.then_some(Field::Bool(true))),
    ("because", nonempty(&this.because).map(Field::Texts)),
]);

impl Varied {
    pub fn to_json(&self) -> Value {
        to_value(self)
    }
}

entries!(Change, |this| [
    ("id", Some(Field::Text(&this.id))),
    ("collection", Some(Field::Text(this.collection.name()))),
    ("before", Some(Field::Texts(&this.before))),
    ("after", Some(Field::Texts(&this.after))),
    ("status", Some(Field::Text(this.status.name()))),
    ("correspondence", Some(Field::Text(this.correspondence.name()))),
    ("varied", nonempty(&this.varied).map(Field::Varied)),
    ("summary", this.summary.as_deref().map(Field::Text)),
    ("context", this.context.as_ref().map(Field::Context)),
]);

entries!(Context, |this| [
    ("before", Some(Field::Texts(&this.before))),
    ("after", Some(Field::Texts(&this.after))),
    ("rules", nonempty(&this.rules).map(Field::Texts)),
]);

impl Change {
    pub fn to_json(&self) -> Value {
        to_value(self)
    }
}

entries!(Step, |this| [
    ("changes", Some(Field::Texts(&this.changes))),
    ("kind", this.kind.map(|kind| Field::Text(kind.name()))),
    ("summary", this.summary.as_deref().map(Field::Text)),
]);

impl Step {
    pub fn to_json(&self) -> Value {
        to_value(self)
    }
}

entries!(Comparison, |this| [
    ("protocolVersion", Some(Field::Count(0))),
    ("changes", Some(Field::Changes(&this.changes))),
    ("steps", Some(Field::Steps(&this.steps))),
    (
        "order",
        this.order.map(|reverse| Field::Object(vec![(
            "reverse",
            Some(Field::Text(match reverse {
                Reverse::Mirror => "mirror",
                Reverse::Explicit => "explicit",
            }))
        )]))
    ),
    ("reverseSteps", this.reverse_steps.as_deref().map(Field::Steps)),
    (
        "variation",
        this.variation.map(|counts| Field::Object(vec![
            ("within", Some(Field::Count(counts.within))),
            ("beyond", Some(Field::Count(counts.beyond))),
        ]))
    ),
    ("metadata", this.metadata.as_ref().map(Field::Fields)),
]);

impl Comparison {
    pub fn to_json(&self) -> Value {
        to_value(self)
    }
}

impl Variation {
    pub fn to_json(&self) -> Value {
        json!({
            "equal": self.equal,
            "within": self.within.iter().map(|within| {
                let mut value = json!({
                    "collection": within.collection, "id": within.id, "path": within.path,
                });
                if within.generated {
                    value["generated"] = json!(true);
                }
                value
            }).collect::<Vec<_>>(),
            "beyond": self.beyond.iter().map(|beyond| {
                let mut value = json!({"path": beyond.path, "reason": beyond.reason});
                if beyond.generated {
                    value["generated"] = json!(true);
                }
                if !beyond.because.is_empty() {
                    value["because"] = json!(beyond.because);
                }
                if let Some(collection) = &beyond.collection {
                    value["collection"] = json!(collection);
                }
                if let Some(id) = &beyond.id {
                    value["id"] = json!(id);
                }
                value
            }).collect::<Vec<_>>(),
        })
    }
}
