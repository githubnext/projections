//! `rules-editor.wasm`'s ABI, as the comparator modules': zero imports;
//! exports `memory`, `projections_alloc(len) -> ptr` and
//! `projections_rules_editor(ptr, len) -> i64` returning `(ptr << 32) | len`
//! of the UTF-8 JSON answer. The extension instantiates it per request, so
//! allocations are released with the instance.

use crate::call;

/// Largest request: a comparator file (at most 1 MiB) and the request around it.
const MAX_INPUT_BYTES: usize = 4 * 1024 * 1024;

#[unsafe(no_mangle)]
pub extern "C" fn projections_alloc(length: i32) -> i32 {
    match usize::try_from(length) {
        Ok(length) if length <= MAX_INPUT_BYTES => Box::leak(vec![0u8; length].into_boxed_slice()).as_mut_ptr() as i32,
        _ => 0,
    }
}

/// Answers an editor's request (see the crate documentation).
///
/// # Safety
/// `pointer` and `length` must describe bytes written into memory returned by
/// `projections_alloc`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn projections_rules_editor(pointer: i32, length: i32) -> i64 {
    let input = match usize::try_from(length) {
        Ok(length) if pointer != 0 => unsafe { std::slice::from_raw_parts(pointer as u32 as *const u8, length) },
        _ => &[],
    };
    let output = Box::leak(call(input).into_boxed_slice());
    ((output.as_ptr() as u32 as i64) << 32) | output.len() as u32 as i64
}
