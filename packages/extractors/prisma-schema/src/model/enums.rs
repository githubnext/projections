//! Resolves enum blocks.

use super::attributes::{check_attributes, mapped, namespace};
use super::context::Context;
use super::types::Enum;
use crate::parse::Block;
use anyhow::Result;
use std::collections::BTreeSet;

pub(super) fn resolve_enum(context: &Context, block: &Block) -> Result<Enum> {
    check_attributes(context, &block.attributes, &["map", "schema"], false)?;
    let mut values = Vec::new();
    let mut names = BTreeSet::new();
    for value in &block.values {
        check_attributes(context, &value.attributes, &["map"], false)?;
        if !names.insert(value.name.as_str()) {
            return context.fail(value.span, format!("enum {} repeats value {}", block.name, value.name));
        }
        values.push((value.name.clone(), mapped(context, &value.attributes)?));
    }
    if values.is_empty() {
        return context.fail(block.span, format!("enum {} has no values", block.name));
    }
    Ok(Enum {
        name: block.name.clone(),
        db_name: mapped(context, &block.attributes)?,
        namespace: namespace(context, &block.attributes)?,
        values,
        span: block.span,
    })
}
