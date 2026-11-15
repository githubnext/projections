//! Collects each document's events, then builds its nodes, replaying an
//! anchored node's events for each alias as serde_yaml did.

use super::scalar::{self, Scalar};
use anyhow::{Result, anyhow, bail};
use serde_json::{Map, Number, Value};
use std::collections::{HashMap, HashSet};
use yaml_rust2::Event;
use yaml_rust2::parser::{Parser, Tag};
use yaml_rust2::scanner::{Marker, TScalarStyle};

/// Deepest nesting of sequences and mappings, aliases included.
const MAX_DEPTH: usize = 128;
/// Alias jumps allowed per event of a document.
const JUMPS_PER_EVENT: usize = 100;

#[derive(Default)]
pub(super) struct Document {
    events: Vec<(Event, Marker)>,
    /// Anchor ID to the index of its node's first event.
    anchors: HashMap<usize, usize>,
}

/// The documents of a stream, each ending at its end marker. An empty stream
/// has one empty document.
pub(super) struct Stream<'a> {
    parser: Option<Parser<std::str::Chars<'a>>>,
    yielded: bool,
}

impl Iterator for Stream<'_> {
    type Item = Result<Document>;

    fn next(&mut self) -> Option<Self::Item> {
        let parser = self.parser.as_mut()?;
        let mut document = Document::default();
        loop {
            let (event, marker) = match parser.next_token() {
                Ok(next) => next,
                Err(error) => {
                    self.parser = None;
                    let marker = error.marker();
                    return Some(Err(anyhow!("{} at {}", error.info(), at(marker))));
                }
            };
            match event {
                Event::StreamStart | Event::DocumentStart | Event::Nothing => {}
                Event::StreamEnd => {
                    self.parser = None;
                    return (!std::mem::replace(&mut self.yielded, true)).then_some(Ok(document));
                }
                Event::DocumentEnd => {
                    self.yielded = true;
                    return Some(Ok(document));
                }
                Event::Scalar(_, _, anchor, _) | Event::SequenceStart(anchor, _) | Event::MappingStart(anchor, _) => {
                    if anchor != 0 {
                        document.anchors.insert(anchor, document.events.len());
                    }
                    document.events.push((event, marker));
                }
                Event::Alias(_) | Event::SequenceEnd | Event::MappingEnd => document.events.push((event, marker)),
            }
        }
    }
}

impl Document {
    pub(super) fn stream(source: &str) -> Stream<'_> {
        // libyaml skipped a leading byte order mark; yaml-rust2 would read it as content.
        let source = source.strip_prefix('\u{feff}').unwrap_or(source);
        Stream {
            parser: Some(Parser::new_from_str(source)),
            yielded: false,
        }
    }

    /// The document's root node; an empty document is null.
    pub(super) fn root(&self) -> Result<Node> {
        if self.events.is_empty() {
            return Ok(Node::Scalar(Scalar::Null));
        }
        let mut builder = Builder {
            document: self,
            jumps: 0,
            depth: 0,
        };
        builder.node(&mut 0)
    }
}

fn at(marker: &Marker) -> String {
    format!("line {} column {}", marker.line(), marker.col() + 1)
}

/// A YAML node before conversion to JSON, whose keys may be any node.
#[derive(Debug, Clone, PartialEq)]
pub(super) enum Node {
    Scalar(Scalar),
    Sequence(Vec<Node>),
    Mapping(Vec<(Node, Node)>),
}

/// A node as a mapping key: equal when serde_yaml's values were equal (so `1`
/// and `0x1` are the same key, `1` and `"1"` or `1.0` are not).
#[derive(Hash, PartialEq, Eq)]
enum Key {
    Null,
    Bool(bool),
    Int(i128),
    Float(u64),
    String(String),
    Sequence(Vec<Key>),
    Mapping(Vec<(Key, Key)>),
}

impl Node {
    fn key(&self) -> Key {
        match self {
            Node::Scalar(Scalar::Null) => Key::Null,
            Node::Scalar(Scalar::Bool(boolean)) => Key::Bool(*boolean),
            Node::Scalar(Scalar::Int(int)) => Key::Int(*int),
            // Nodes are finite; 0.0 and -0.0 are equal.
            Node::Scalar(Scalar::Float(float)) => Key::Float(if *float == 0.0 { 0 } else { float.to_bits() }),
            Node::Scalar(Scalar::String(text)) => Key::String(text.clone()),
            Node::Sequence(items) => Key::Sequence(items.iter().map(Node::key).collect()),
            Node::Mapping(entries) => Key::Mapping(entries.iter().map(|(k, v)| (k.key(), v.key())).collect()),
        }
    }

    pub(super) fn into_json(self) -> Result<Value> {
        Ok(match self {
            Node::Scalar(Scalar::Null) => Value::Null,
            Node::Scalar(Scalar::Bool(boolean)) => Value::Bool(boolean),
            Node::Scalar(Scalar::Int(int)) => int_json(int),
            Node::Scalar(Scalar::Float(float)) => Number::from_f64(float).map_or(Value::Null, Value::Number),
            Node::Scalar(Scalar::String(text)) => Value::String(text),
            Node::Sequence(items) => Value::Array(items.into_iter().map(Node::into_json).collect::<Result<_>>()?),
            Node::Mapping(entries) => {
                let mut map = Map::new();
                for (key, value) in entries {
                    map.insert(key.into_key()?, value.into_json()?);
                }
                Value::Object(map)
            }
        })
    }

    /// The JSON key for a scalar key, written as JSON writes the number or boolean.
    fn into_key(self) -> Result<String> {
        match self {
            Node::Scalar(Scalar::String(text)) => Ok(text),
            Node::Scalar(Scalar::Bool(boolean)) => Ok(boolean.to_string()),
            Node::Scalar(Scalar::Int(int)) => Ok(int_json(int).to_string()),
            Node::Scalar(Scalar::Float(float)) => Number::from_f64(float)
                .map(|n| n.to_string())
                .ok_or_else(|| anyhow!("float key must be finite")),
            _ => bail!("key must be a string"),
        }
    }
}

fn int_json(int: i128) -> Value {
    match u64::try_from(int) {
        Ok(unsigned) => Value::from(unsigned),
        Err(_) => Value::from(int as i64),
    }
}

fn describe(key: &Node) -> String {
    match key {
        Node::Scalar(Scalar::String(text)) => format!("{text:?}"),
        Node::Scalar(Scalar::Null) => "null".to_owned(),
        Node::Scalar(Scalar::Bool(boolean)) => boolean.to_string(),
        Node::Scalar(Scalar::Int(int)) => int.to_string(),
        Node::Scalar(Scalar::Float(float)) => float.to_string(),
        Node::Sequence(_) => "(a sequence)".to_owned(),
        Node::Mapping(_) => "(a mapping)".to_owned(),
    }
}

struct Builder<'a> {
    document: &'a Document,
    jumps: usize,
    depth: usize,
}

impl<'a> Builder<'a> {
    fn event(&self, position: usize) -> Result<&'a (Event, Marker)> {
        self.document
            .events
            .get(position)
            .ok_or_else(|| anyhow!("unexpected end of YAML document"))
    }

    fn node(&mut self, position: &mut usize) -> Result<Node> {
        let (event, marker) = self.event(*position)?;
        *position += 1;
        match event {
            Event::Alias(anchor) => {
                self.jumps += 1;
                if self.jumps > self.document.events.len() * JUMPS_PER_EVENT {
                    bail!("repetition limit exceeded: aliases expand too far");
                }
                let mut target = *self
                    .document
                    .anchors
                    .get(anchor)
                    .ok_or_else(|| anyhow!("unknown anchor at {}", at(marker)))?;
                self.node(&mut target)
            }
            Event::Scalar(text, style, _, tag) => {
                let tag = global(tag.as_ref(), marker)?;
                let scalar = scalar::resolve(text.clone(), *style == TScalarStyle::Plain, tag.as_deref())
                    .map_err(|error| anyhow!("{error} at {}", at(marker)))?;
                if let Scalar::Float(float) = scalar
                    && !float.is_finite()
                {
                    bail!("YAML values must be finite at {}", at(marker));
                }
                Ok(Node::Scalar(scalar))
            }
            Event::SequenceStart(_, tag) => {
                global(tag.as_ref(), marker)?;
                self.enter(marker)?;
                let mut items = Vec::new();
                while !matches!(self.event(*position)?.0, Event::SequenceEnd) {
                    items.push(self.node(position)?);
                }
                *position += 1;
                self.depth -= 1;
                Ok(Node::Sequence(items))
            }
            Event::MappingStart(_, tag) => {
                global(tag.as_ref(), marker)?;
                self.enter(marker)?;
                let mut entries = Vec::new();
                let mut keys = HashSet::new();
                while !matches!(self.event(*position)?.0, Event::MappingEnd) {
                    let key_marker = self.event(*position)?.1;
                    let key = self.node(position)?;
                    if !keys.insert(key.key()) {
                        bail!("Duplicate YAML key {} at {}", describe(&key), at(&key_marker));
                    }
                    let value = self.node(position)?;
                    entries.push((key, value));
                }
                *position += 1;
                self.depth -= 1;
                Ok(Node::Mapping(entries))
            }
            _ => bail!("unexpected YAML event at {}", at(marker)),
        }
    }

    fn enter(&mut self, marker: &Marker) -> Result<()> {
        if self.depth == MAX_DEPTH {
            bail!("recursion limit exceeded at {}", at(marker));
        }
        self.depth += 1;
        Ok(())
    }
}

/// A node's resolved global tag; local tags (`!name`) have no meaning here.
fn global(tag: Option<&Tag>, marker: &Marker) -> Result<Option<String>> {
    let Some(tag) = tag else { return Ok(None) };
    let full = format!("{}{}", tag.handle, tag.suffix);
    if full.starts_with('!') {
        bail!("Local YAML tag {full} isn't supported at {}", at(marker));
    }
    Ok(Some(full))
}
