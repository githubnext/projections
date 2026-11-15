//! Resolves all schema files' blocks into one validated [`Schema`].

use super::attributes::check_attributes;
use super::context::{Context, Declared, SCALARS};
use super::enums::resolve_enum;
use super::fields::{field_kind, resolve_model};
use super::indexes::indexes;
use super::relations::resolve_relations;
use super::types::{File, IndexKind, Model, Schema};
use crate::parse::{Block, BlockKind, Expr, Span};
use anyhow::Result;
use std::collections::BTreeMap;

const PROVIDERS: [&str; 6] = ["postgresql", "mysql", "sqlite", "sqlserver", "mongodb", "cockroachdb"];

/// Each type name's declaration, rejecting repeated block names and reserved type names.
fn declare<'a>(context: &Context, blocks: &[&'a Block]) -> Result<BTreeMap<&'a str, Declared>> {
    let mut declared: BTreeMap<&str, Declared> = BTreeMap::new();
    let mut seen: BTreeMap<(&str, &str), Span> = BTreeMap::new();
    let (mut models, mut enums) = (0, 0);
    for block in blocks {
        let namespace = match block.kind {
            BlockKind::Datasource => "datasource",
            BlockKind::Generator => "generator",
            _ => "type",
        };
        if let Some(previous) = seen.insert((namespace, &block.name), block.span) {
            return context.fail(
                block.span,
                format!(
                    "{} {} is already defined at {}:{}",
                    block.kind.keyword(),
                    block.name,
                    context.paths[previous.file],
                    previous.line
                ),
            );
        }
        let entry = match block.kind {
            BlockKind::Model | BlockKind::View => {
                models += 1;
                Declared::Model(models - 1)
            }
            BlockKind::Enum => {
                enums += 1;
                Declared::Enum(enums - 1)
            }
            BlockKind::Type => Declared::Composite,
            BlockKind::Datasource | BlockKind::Generator => continue,
        };
        if SCALARS.contains(&block.name.as_str()) || block.name == "Unsupported" {
            return context.fail(block.span, format!("{} is a reserved type name", block.name));
        }
        declared.insert(&block.name, entry);
    }
    Ok(declared)
}

/// The provider of the schema's only datasource, if it has one.
fn datasource_provider(context: &Context, blocks: &[&Block]) -> Result<Option<String>> {
    let datasources: Vec<&&Block> = blocks.iter().filter(|b| b.kind == BlockKind::Datasource).collect();
    if datasources.len() > 1 {
        return context.fail(datasources[1].span, "a Prisma schema may define only one datasource");
    }
    datasources.first().map(|block| provider(context, block)).transpose()
}

/// Checks composite type fields' types and attributes; composite types are not
/// part of the extraction.
fn check_composite_types(context: &Context, declared: &BTreeMap<&str, Declared>, blocks: &[&Block]) -> Result<()> {
    for block in blocks.iter().filter(|b| b.kind == BlockKind::Type) {
        for field in &block.fields {
            field_kind(context, declared, field)?;
            check_attributes(context, &field.attributes, &["map", "default"], true)?;
        }
        if let Some(attribute) = block.attributes.first() {
            return context.fail(
                attribute.span,
                format!("composite type {} cannot have @@{}", block.name, attribute.name),
            );
        }
    }
    Ok(())
}

/// Resolves a model's indexes and checks its unique criterion and primary key.
fn resolve_keys(context: &Context, model: &mut Model, block: &Block) -> Result<()> {
    model.indexes = indexes(context, model, block)?;
    let unique = model
        .indexes
        .iter()
        .any(|index| matches!(index.kind, IndexKind::Id | IndexKind::Unique));
    if block.kind == BlockKind::Model && !model.ignored && !unique {
        return context.fail(
            block.span,
            format!("model {} needs a unique criterion: @id, @@id, @unique or @@unique", model.name),
        );
    }
    if model.indexes.iter().filter(|index| index.kind == IndexKind::Id).count() > 1 {
        return context.fail(block.span, format!("model {} declares more than one primary key", model.name));
    }
    Ok(())
}

pub fn resolve(files: &[File]) -> Result<Schema> {
    let context = Context {
        paths: files.iter().map(|file| file.path).collect(),
    };
    let blocks: Vec<&Block> = files.iter().flat_map(|file| &file.blocks).collect();
    let declared = declare(&context, &blocks)?;
    let provider = datasource_provider(&context, &blocks)?;
    let enums = blocks
        .iter()
        .filter(|b| b.kind == BlockKind::Enum)
        .map(|block| resolve_enum(&context, block))
        .collect::<Result<Vec<_>>>()?;
    check_composite_types(&context, &declared, &blocks)?;

    let model_blocks: Vec<&Block> = blocks
        .iter()
        .copied()
        .filter(|b| matches!(b.kind, BlockKind::Model | BlockKind::View))
        .collect();
    let models = model_blocks
        .iter()
        .map(|block| resolve_model(&context, &declared, &enums, block))
        .collect::<Result<Vec<_>>>()?;
    let mut schema = Schema { provider, enums, models };
    resolve_relations(&context, &mut schema)?;
    for (model, block) in schema.models.iter_mut().zip(model_blocks) {
        resolve_keys(&context, model, block)?;
    }
    Ok(schema)
}

fn provider(context: &Context, block: &Block) -> Result<String> {
    let Some((_, value, span)) = block.properties.iter().find(|(key, ..)| key == "provider") else {
        return context.fail(block.span, format!("datasource {} requires a provider", block.name));
    };
    let Expr::String(provider) = value else {
        return context.fail(*span, "the datasource provider must be a string literal");
    };
    let provider = if provider == "postgres" { "postgresql" } else { provider.as_str() };
    if !PROVIDERS.contains(&provider) {
        return context.fail(
            *span,
            format!("unknown datasource provider {provider:?}; expected one of {}", PROVIDERS.join(", ")),
        );
    }
    Ok(provider.to_owned())
}
