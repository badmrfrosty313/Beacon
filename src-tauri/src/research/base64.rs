//! Strict standard-alphabet base64 decoding (RFC 4648 section 4, with padding).
//!
//! Imported files cross the IPC boundary as base64 text so a multi-megabyte PDF is not
//! serialized as a JSON array of numbers. The decoder is deliberately small and strict:
//! no whitespace, no URL-safe alphabet, canonical padding only, and a hard cap on the
//! decoded size that is checked before anything is allocated.

const INVALID: u8 = 0xFF;

const fn build_table() -> [u8; 256] {
    let mut table = [INVALID; 256];
    let alphabet = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut i = 0;
    while i < 64 {
        table[alphabet[i] as usize] = i as u8;
        i += 1;
    }
    table
}

static TABLE: [u8; 256] = build_table();

/// Decode `input`. Fails (without allocating the output) if it would exceed `max_decoded`.
pub fn decode(input: &str, max_decoded: usize) -> Result<Vec<u8>, &'static str> {
    let bytes = input.as_bytes();
    if bytes.is_empty() {
        return Ok(Vec::new());
    }
    if bytes.len() % 4 != 0 {
        return Err("The file data is not valid base64.");
    }
    let padding = bytes.iter().rev().take_while(|&&b| b == b'=').count();
    if padding > 2 {
        return Err("The file data is not valid base64.");
    }
    let decoded_len = bytes.len() / 4 * 3 - padding;
    if decoded_len > max_decoded {
        return Err("The file is too large.");
    }
    let mut out = Vec::with_capacity(decoded_len);
    let last_group = bytes.len() / 4 - 1;
    for (index, group) in bytes.chunks_exact(4).enumerate() {
        let mut value: u32 = 0;
        let mut real = 4;
        for (position, &byte) in group.iter().enumerate() {
            let sextet = if byte == b'=' {
                // Padding may only appear at the end of the last group.
                if index != last_group || position < 4 - padding {
                    return Err("The file data is not valid base64.");
                }
                real -= 1;
                0
            } else {
                let decoded = TABLE[byte as usize];
                if decoded == INVALID {
                    return Err("The file data is not valid base64.");
                }
                u32::from(decoded)
            };
            value = (value << 6) | sextet;
        }
        let triple = [(value >> 16) as u8, (value >> 8) as u8, value as u8];
        match real {
            4 => out.extend_from_slice(&triple),
            3 => {
                // Canonical encoding: the unused low bits must be zero.
                if triple[2] != 0 {
                    return Err("The file data is not valid base64.");
                }
                out.extend_from_slice(&triple[..2]);
            }
            _ => {
                if triple[1] != 0 || triple[2] != 0 {
                    return Err("The file data is not valid base64.");
                }
                out.push(triple[0]);
            }
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn encode(bytes: &[u8]) -> String {
        const A: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut out = String::new();
        for chunk in bytes.chunks(3) {
            let b = [
                chunk[0],
                *chunk.get(1).unwrap_or(&0),
                *chunk.get(2).unwrap_or(&0),
            ];
            let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
            out.push(A[(n >> 18) as usize & 63] as char);
            out.push(A[(n >> 12) as usize & 63] as char);
            out.push(if chunk.len() > 1 {
                A[(n >> 6) as usize & 63] as char
            } else {
                '='
            });
            out.push(if chunk.len() > 2 {
                A[n as usize & 63] as char
            } else {
                '='
            });
        }
        out
    }

    #[test]
    fn round_trips_every_length_and_byte_value() {
        let all: Vec<u8> = (0..=255u8).collect();
        for len in 0..=all.len() {
            let data = &all[..len];
            assert_eq!(decode(&encode(data), 1000).unwrap(), data, "length {len}");
        }
    }

    #[test]
    fn decodes_known_vectors() {
        assert_eq!(decode("", 10).unwrap(), b"");
        assert_eq!(decode("Zg==", 10).unwrap(), b"f");
        assert_eq!(decode("Zm8=", 10).unwrap(), b"fo");
        assert_eq!(decode("Zm9v", 10).unwrap(), b"foo");
        assert_eq!(decode("Zm9vYmFy", 10).unwrap(), b"foobar");
    }

    #[test]
    fn rejects_malformed_input() {
        for bad in [
            "Zg=", "Zg", "Z===", "====", "Zg==Zg==", "Zm9v\n", " Zm9v", "Zm9-", "Zm9_", "Zm 9",
            "Zm9v=", "Zh==", "Zm9=", "Zg=a", "Z=g=", "é!!!",
        ] {
            assert!(decode(bad, 100).is_err(), "should reject {bad:?}");
        }
    }

    #[test]
    fn enforces_the_size_cap_before_decoding() {
        assert_eq!(decode("Zm9v", 3).unwrap(), b"foo");
        assert!(decode("Zm9v", 2).is_err());
        assert!(decode("Zm9vYg==", 3).is_err());
        assert_eq!(decode("Zm9vYg==", 4).unwrap(), b"foob");
    }
}
