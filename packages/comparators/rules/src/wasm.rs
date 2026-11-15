//! Comparator module ABI: zero imports; exports `memory`,
//! `projections_alloc(len) -> ptr` and `projections_compare(ptr, len) -> i64`
//! returning `(ptr << 32) | len` of the UTF-8 JSON output. Hosts instantiate a
//! module per call, so allocations are released with the instance.

use crate::{MAX_INPUT_BYTES, call, cover, inspect};

#[unsafe(no_mangle)]
pub extern "C" fn projections_alloc(length: i32) -> i32 {
    match usize::try_from(length) {
        Ok(length) if length <= MAX_INPUT_BYTES => Box::leak(vec![0u8; length].into_boxed_slice()).as_mut_ptr() as i32,
        _ => 0,
    }
}

/// # Safety
/// `pointer` and `length` must describe bytes written into memory returned by
/// `projections_alloc`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn projections_compare(pointer: i32, length: i32) -> i64 {
    let input = match usize::try_from(length) {
        Ok(length) if pointer != 0 => unsafe { std::slice::from_raw_parts(pointer as u32 as *const u8, length) },
        _ => &[],
    };
    let output = Box::leak(call(input).into_boxed_slice());
    ((output.as_ptr() as u32 as i64) << 32) | output.len() as u32 as i64
}

/// Checks a rules file: the input is its UTF-8 text, the output, packed as
/// `projections_compare`'s, `{"canonical"}` or `{"diagnostics"}`.
///
/// # Safety
/// As `projections_compare`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn projections_rules_inspect(pointer: i32, length: i32) -> i64 {
    let input = match usize::try_from(length) {
        Ok(length) if pointer != 0 => unsafe { std::slice::from_raw_parts(pointer as u32 as *const u8, length) },
        _ => &[],
    };
    let output = Box::leak(inspect(input).into_boxed_slice());
    ((output.as_ptr() as u32 as i64) << 32) | output.len() as u32 as i64
}

/// Compares with rule coverage: the input is `projections_compare`'s, the
/// output, packed as its, [`cover`]'s `{"comparison" | "error", "coverage"}`.
///
/// # Safety
/// As `projections_compare`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn projections_rules_cover(pointer: i32, length: i32) -> i64 {
    let input = match usize::try_from(length) {
        Ok(length) if pointer != 0 => unsafe { std::slice::from_raw_parts(pointer as u32 as *const u8, length) },
        _ => &[],
    };
    let output = Box::leak(cover(input).into_boxed_slice());
    ((output.as_ptr() as u32 as i64) << 32) | output.len() as u32 as i64
}
