use super::{arity, string_list};
use crate::value::{list, object, string};
use cel::Value as Cel;
use cel::objects::Key;
use projections_engine::utf16_cmp;
use std::collections::HashMap;

pub(super) fn ids_sort(args: &[Cel]) -> Result<Cel, String> {
    arity(args, 1)?;
    let mut ids = string_list(&args[0], "ids")?;
    ids.sort_by(|a, b| utf16_cmp(a, b));
    Ok(list(ids.iter().map(|id| string(id))))
}

pub(super) fn ids_key(args: &[Cel]) -> Result<Cel, String> {
    arity(args, 1)?;
    let Cel::String(text) = &args[0] else {
        return Err("ids.key takes a string".into());
    };
    let mut key = String::with_capacity(text.len() * 4);
    for unit in text.encode_utf16() {
        key.push_str(&format!("{unit:04x}"));
    }
    Ok(string(&key))
}

pub(super) fn from_entries(args: &[Cel]) -> Result<Cel, String> {
    arity(args, 1)?;
    let Cel::List(entries) = &args[0] else {
        return Err("maps.fromEntries takes a list of [key, value] pairs".into());
    };
    let mut fields: Vec<(String, Cel)> = Vec::new();
    let mut index: HashMap<String, usize> = HashMap::new();
    for entry in entries.iter() {
        let pair = match entry {
            Cel::List(pair) if pair.len() == 2 => pair,
            _ => return Err("maps.fromEntries takes a list of [key, value] pairs".into()),
        };
        let Cel::String(key) = &pair[0] else {
            return Err("maps.fromEntries needs string keys".into());
        };
        match index.get(key.as_str()) {
            Some(&at) => fields[at].1 = pair[1].clone(),
            None => {
                index.insert(key.as_ref().clone(), fields.len());
                fields.push((key.as_ref().clone(), pair[1].clone()));
            }
        }
    }
    Ok(object(fields))
}

pub(super) fn keys(args: &[Cel]) -> Result<Cel, String> {
    arity(args, 1)?;
    let Cel::Map(map) = &args[0] else {
        return Err("maps.keys takes a map".into());
    };
    let mut keys: Vec<String> = map
        .map
        .keys()
        .map(|key| match key {
            Key::String(key) => Ok(key.as_ref().clone()),
            _ => Err("maps.keys needs string keys".to_owned()),
        })
        .collect::<Result<_, _>>()?;
    keys.sort_by(|a, b| utf16_cmp(a, b));
    Ok(list(keys.iter().map(|key| string(key))))
}

pub(super) fn zip_longest(args: &[Cel]) -> Result<Cel, String> {
    arity(args, 2)?;
    let (Cel::List(a), Cel::List(b)) = (&args[0], &args[1]) else {
        return Err("lists.zipLongest takes two lists".into());
    };
    let at = |items: &[Cel], index: usize| items.get(index).cloned().unwrap_or(Cel::Null);
    Ok(list((0..a.len().max(b.len())).map(|index| list([at(a, index), at(b, index)]))))
}

pub(super) fn enumerate(args: &[Cel]) -> Result<Cel, String> {
    arity(args, 1)?;
    let Cel::List(items) = &args[0] else {
        return Err("lists.enumerate takes a list".into());
    };
    Ok(list(
        items
            .iter()
            .enumerate()
            .map(|(index, item)| list([Cel::Int(index as i64), item.clone()])),
    ))
}

pub(super) fn zip(args: &[Cel]) -> Result<Cel, String> {
    arity(args, 2)?;
    let (Cel::List(a), Cel::List(b)) = (&args[0], &args[1]) else {
        return Err("lists.zip takes two lists".into());
    };
    Ok(list(a.iter().zip(b.iter()).map(|(a, b)| list([a.clone(), b.clone()]))))
}
