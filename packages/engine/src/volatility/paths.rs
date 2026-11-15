use crate::model::{Datum, Fields};
use crate::pointer;

use super::MAX_POINTER_BYTES;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Segment {
    Key(String),
    Any,
}

/// Parses a declared pointer: `/data/` and at least one more segment, RFC
/// 6901 escapes, `*` for any key or index. The segments are those below
/// `data`.
pub(crate) fn segments(raw: &str) -> Result<Vec<Segment>, &'static str> {
    if raw.len() > MAX_POINTER_BYTES {
        return Err("Pointer exceeds 1024 bytes");
    }
    let Some(rest) = raw.strip_prefix("/data/") else {
        return Err("Expected a JSON pointer under /data/");
    };
    let mut result = Vec::new();
    for segment in rest.split('/') {
        if segment == "*" {
            result.push(Segment::Any);
            continue;
        }
        let mut key = String::new();
        let mut chars = segment.chars();
        while let Some(c) = chars.next() {
            if c == '~' {
                match chars.next() {
                    Some('0') => key.push('~'),
                    Some('1') => key.push('/'),
                    _ => return Err("Expected ~0 or ~1 after ~"),
                }
            } else {
                key.push(c);
            }
        }
        result.push(Segment::Key(key));
    }
    Ok(result)
}

pub(crate) fn wildcards(segments: &[Segment]) -> usize {
    segments.iter().filter(|segment| **segment == Segment::Any).count()
}

/// A concrete path below an item's `data`: its keys, and the pointer into
/// the item they spell.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Concrete {
    pub(crate) keys: Vec<String>,
    pub(crate) pointer: String,
}

impl Concrete {
    fn new(keys: Vec<String>) -> Concrete {
        let pointer = keys.iter().fold("/data".to_owned(), |path, key| pointer(&path, key));
        Concrete { keys, pointer }
    }
}

/// A level of an item's `data`: the object itself, or a value inside it.
#[derive(Clone, Copy)]
enum Node<'a> {
    Data(&'a Fields),
    Value(&'a Datum),
}

impl<'a> Node<'a> {
    fn child(self, key: &str) -> Option<Node<'a>> {
        match self {
            Node::Data(fields) => fields.get(key).map(Node::Value),
            Node::Value(value) => value.child(key).map(Node::Value),
        }
    }

    fn keys(self) -> Vec<String> {
        match self {
            Node::Data(fields) => fields.keys().cloned().collect(),
            Node::Value(value) => value.keys(),
        }
    }
}

/// Every concrete path a declared path matches in either item's `data`,
/// with the keys its `*` segments bound.
pub(crate) fn expand(segments: &[Segment], data: [Option<&Fields>; 2]) -> Vec<(Concrete, Vec<String>)> {
    let mut out = Vec::new();
    walk(
        segments,
        data.map(|data| data.map(Node::Data)),
        &mut Vec::new(),
        &mut Vec::new(),
        &mut out,
    );
    out
}

fn walk(
    segments: &[Segment],
    sides: [Option<Node>; 2],
    keys: &mut Vec<String>,
    bound: &mut Vec<String>,
    out: &mut Vec<(Concrete, Vec<String>)>,
) {
    if sides.iter().all(Option::is_none) {
        return;
    }
    let Some((segment, rest)) = segments.split_first() else {
        out.push((Concrete::new(keys.clone()), bound.clone()));
        return;
    };
    let wild = *segment == Segment::Any;
    let all = match segment {
        Segment::Key(key) => vec![key.clone()],
        Segment::Any => {
            let mut all = sides[0].map(Node::keys).unwrap_or_default();
            for key in sides[1].map(Node::keys).unwrap_or_default() {
                if !all.contains(&key) {
                    all.push(key);
                }
            }
            all
        }
    };
    for key in all {
        let next = sides.map(|side| side.and_then(|node| node.child(&key)));
        if wild {
            bound.push(key.clone());
        }
        keys.push(key);
        walk(rest, next, keys, bound, out);
        keys.pop();
        if wild {
            bound.pop();
        }
    }
}

/// A declared path with its `*` segments bound, in order, to `bound`, which
/// has at least as many keys as the path has `*` segments.
pub(crate) fn render(segments: &[Segment], bound: &[String]) -> Concrete {
    let mut wild = 0;
    let keys = segments
        .iter()
        .map(|segment| match segment {
            Segment::Key(key) => key.clone(),
            Segment::Any => {
                wild += 1;
                bound[wild - 1].clone()
            }
        })
        .collect();
    Concrete::new(keys)
}
