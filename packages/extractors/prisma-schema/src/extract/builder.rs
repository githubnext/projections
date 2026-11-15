//! Accumulates entities and relationships, rejecting repeated identities.

use super::id;
use crate::parse::Span;
use anyhow::{Result, bail};
use serde_json::{Value, json};
use std::collections::BTreeSet;

pub(super) struct Builder<'a> {
    paths: &'a [String],
    pub(super) entities: Vec<Value>,
    pub(super) relationships: Vec<Value>,
    pub(super) ids: BTreeSet<String>,
}

impl Builder<'_> {
    fn evidence(&self, span: Span) -> Value {
        json!([{"kind":"prisma-schema","source":self.paths[span.file],"location":{"line":span.line}}])
    }
    fn claim(&mut self, identity: &str, span: Span) -> Result<()> {
        if !self.ids.insert(identity.to_owned()) {
            bail!(
                "Prisma schema at {}:{} declares {identity} more than once",
                self.paths[span.file],
                span.line
            );
        }
        Ok(())
    }
    pub(super) fn entity(&mut self, kind: &str, identity: String, label: &str, data: Value, span: Span) -> Result<String> {
        self.claim(&identity, span)?;
        self.entities
            .push(json!({"id":identity,"kind":kind,"label":label,"data":data,"confidence":"authoritative","evidence":self.evidence(span)}));
        Ok(identity)
    }
    pub(super) fn relationship(
        &mut self,
        kind: &str,
        from: &str,
        to: &str,
        discriminator: &str,
        data: Option<Value>,
        span: Span,
    ) -> Result<()> {
        let identity = id(kind, &[from, to, discriminator]);
        self.claim(&identity, span)?;
        let mut item = json!({"id":identity,"kind":kind,"from":from,"to":to,"confidence":"authoritative","evidence":self.evidence(span)});
        if let Some(data) = data {
            item["data"] = data;
        }
        self.relationships.push(item);
        Ok(())
    }
}

impl<'a> Builder<'a> {
    pub(super) fn new(paths: &'a [String]) -> Self {
        Builder {
            paths,
            entities: vec![],
            relationships: vec![],
            ids: BTreeSet::new(),
        }
    }
}
