use super::{Collection, Fields, Number};
use crate::volatility::Declaration;

/// How sure an extractor is of an item.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Confidence {
    Authoritative,
    Derived,
    Inferred,
}

impl Confidence {
    pub const ALL: [Confidence; 3] = [Confidence::Authoritative, Confidence::Derived, Confidence::Inferred];

    pub fn name(self) -> &'static str {
        match self {
            Confidence::Authoritative => "authoritative",
            Confidence::Derived => "derived",
            Confidence::Inferred => "inferred",
        }
    }
}

/// A position in a source file: positive integers, kept in the form written.
#[derive(Debug, Clone, PartialEq)]
pub struct Location {
    pub line: Number,
    pub column: Option<Number>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Evidence {
    pub kind: String,
    pub source: String,
    pub location: Option<Location>,
}

/// An entity or a relationship. `S` holds what sets them apart.
/// `previousIds` and `evidence` keep whether they were written, even empty;
/// `data` is always an object.
#[derive(Debug, Clone, PartialEq)]
pub struct Item<S> {
    pub id: String,
    pub kind: String,
    pub shape: S,
    pub data: Fields,
    /// Distinct nonblank IDs, in UTF-16 order once normalized.
    pub previous_ids: Option<Vec<String>>,
    pub evidence: Option<Vec<Evidence>>,
    pub confidence: Option<Confidence>,
}

/// An entity's own part: its label, which it always has.
#[derive(Debug, Clone, PartialEq)]
pub struct Node {
    pub label: String,
}

/// A relationship's own part: an optional label and its endpoints, the IDs
/// of entities of the same extraction.
#[derive(Debug, Clone, PartialEq)]
pub struct Link {
    pub label: Option<String>,
    pub from: String,
    pub to: String,
}

pub type Entity = Item<Node>;
pub type Relationship = Item<Link>;

/// One item of either collection, as code that treats both alike reads it.
#[derive(Debug, Clone, Copy)]
pub struct ItemRef<'a> {
    pub collection: Collection,
    pub id: &'a str,
    pub kind: &'a str,
    pub label: Option<&'a str>,
    pub endpoints: Option<[&'a str; 2]>,
    pub data: &'a Fields,
    pub previous_ids: Option<&'a [String]>,
    pub evidence: Option<&'a [Evidence]>,
    pub confidence: Option<Confidence>,
}

impl<S> Item<S> {
    fn as_ref<'a>(&'a self, collection: Collection, label: Option<&'a str>, endpoints: Option<[&'a str; 2]>) -> ItemRef<'a> {
        ItemRef {
            collection,
            id: &self.id,
            kind: &self.kind,
            label,
            endpoints,
            data: &self.data,
            previous_ids: self.previous_ids.as_deref(),
            evidence: self.evidence.as_deref(),
            confidence: self.confidence,
        }
    }
}

impl Entity {
    pub fn view(&self) -> ItemRef<'_> {
        self.as_ref(Collection::Entities, Some(&self.shape.label), None)
    }
}

impl Relationship {
    pub fn view(&self) -> ItemRef<'_> {
        self.as_ref(
            Collection::Relationships,
            self.shape.label.as_deref(),
            Some([&self.shape.from, &self.shape.to]),
        )
    }
}

/// A validated, normalized extraction. Its facts hold by construction:
/// IDs are unique across both collections and sorted by UTF-16 code units,
/// every relationship's endpoints are entities of this extraction, identity
/// claims are unambiguous, and the domain schema's and vocabularies' rules
/// hold. Only the Engine's parser builds one.
#[derive(Debug, Clone)]
pub struct Extraction {
    /// Always 0, in the form written.
    pub(crate) protocol_version: Number,
    pub(crate) schema: &'static str,
    pub(crate) vocabularies: Vec<&'static str>,
    pub(crate) missing_inputs: Vec<String>,
    pub(crate) volatile: Vec<Declaration>,
    pub(crate) entities: Vec<Entity>,
    pub(crate) relationships: Vec<Relationship>,
    pub(crate) metadata: Option<Fields>,
}

impl Extraction {
    pub fn schema(&self) -> &'static str {
        self.schema
    }

    /// The vocabularies it declares.
    pub fn vocabularies(&self) -> &[&'static str] {
        &self.vocabularies
    }

    /// The volatile declarations, normalized and sorted.
    pub fn volatile(&self) -> &[Declaration] {
        &self.volatile
    }

    pub fn entities(&self) -> &[Entity] {
        &self.entities
    }

    pub fn relationships(&self) -> &[Relationship] {
        &self.relationships
    }

    /// Every item of one collection, in order.
    pub fn items(&self, collection: Collection) -> Vec<ItemRef<'_>> {
        match collection {
            Collection::Entities => self.entities.iter().map(Entity::view).collect(),
            Collection::Relationships => self.relationships.iter().map(Relationship::view).collect(),
        }
    }
}
