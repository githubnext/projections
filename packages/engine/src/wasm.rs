use crate::{MAX_REQUEST_BYTES, diagnostic_response, handle};

#[unsafe(no_mangle)]
pub extern "C" fn engine_alloc(length: u32) -> u32 {
    if length as usize > MAX_REQUEST_BYTES {
        return 0;
    }
    Box::into_raw(vec![0u8; length as usize].into_boxed_slice()) as *mut u8 as u32
}

/// The caller owns an allocation of exactly `length` bytes from this module.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn engine_free(pointer: u32, length: u32) {
    if pointer != 0 {
        unsafe {
            drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(
                pointer as *mut u8,
                length as usize,
            )));
        }
    }
}

/// Returns an owned response as (length << 32) | pointer. Neither input nor
/// output may be freed until the call returns; the host frees both afterward.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn engine_call(pointer: u32, length: u32) -> u64 {
    let response = if length as usize > MAX_REQUEST_BYTES {
        diagnostic_response("request-size-limit", "Engine request exceeds 128 MiB")
    } else {
        handle(unsafe { std::slice::from_raw_parts(pointer as *const u8, length as usize) })
    };
    let output = serde_json::to_vec(&response).unwrap().into_boxed_slice();
    let length = output.len() as u64;
    let pointer = Box::into_raw(output) as *mut u8 as u32;
    (length << 32) | pointer as u64
}
