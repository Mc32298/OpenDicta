use std::path::Path;

#[cfg(windows)]
use windows_sys::Win32::{
    Foundation::LocalFree,
    Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    },
};

#[cfg(windows)]
fn protect_bytes(plain: &[u8]) -> Result<Vec<u8>, String> {
    if plain.is_empty() {
        return Ok(Vec::new());
    }
    let mut input = CRYPT_INTEGER_BLOB {
        cbData: plain.len() as u32,
        pbData: plain.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    let ok = unsafe {
        CryptProtectData(
            &mut input,
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if ok == 0 {
        return Err(format!(
            "Failed to encrypt local secret: {}",
            std::io::Error::last_os_error()
        ));
    }
    let bytes =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe {
        LocalFree(output.pbData.cast());
    }
    Ok(bytes)
}

#[cfg(windows)]
pub fn encrypt_bytes_for_storage(plain: &[u8]) -> Result<Vec<u8>, String> {
    protect_bytes(plain)
}

#[cfg(windows)]
fn unprotect_bytes(cipher: &[u8]) -> Result<Vec<u8>, String> {
    if cipher.is_empty() {
        return Ok(Vec::new());
    }
    let mut input = CRYPT_INTEGER_BLOB {
        cbData: cipher.len() as u32,
        pbData: cipher.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    let ok = unsafe {
        CryptUnprotectData(
            &mut input,
            std::ptr::null_mut(),
            std::ptr::null(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if ok == 0 {
        return Err(format!(
            "Failed to decrypt local secret: {}",
            std::io::Error::last_os_error()
        ));
    }
    let bytes =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe {
        LocalFree(output.pbData.cast());
    }
    Ok(bytes)
}

#[cfg(windows)]
pub fn save_encrypted_bytes(path: &Path, payload: Option<&[u8]>) -> Result<(), String> {
    match payload {
        Some(bytes) => {
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to create secret directory: {}", e))?;
            }
            let cipher = protect_bytes(bytes)?;
            std::fs::write(path, cipher)
                .map_err(|e| format!("Failed to write encrypted secret: {}", e))
        }
        None => match std::fs::remove_file(path) {
            Ok(_) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(format!("Failed to delete encrypted secret: {}", e)),
        },
    }
}

#[cfg(windows)]
pub fn load_encrypted_bytes(path: &Path) -> Result<Option<Vec<u8>>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let bytes = std::fs::read(path).map_err(|e| format!("Failed to read encrypted file: {}", e))?;
    let plain = unprotect_bytes(&bytes)?;
    Ok(Some(plain))
}

#[cfg(windows)]
pub fn save_encrypted_string(path: &Path, value: Option<&str>) -> Result<(), String> {
    save_encrypted_bytes(path, value.map(str::as_bytes))
}

#[cfg(windows)]
pub fn load_encrypted_string(path: &Path) -> Option<String> {
    let bytes = load_encrypted_bytes(path).ok().flatten()?;
    let secret = String::from_utf8(bytes).ok()?;
    let trimmed = secret.trim().to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

#[cfg(test)]
mod tests {
    #[cfg(windows)]
    #[test]
    fn encrypted_string_round_trips_and_deletes() {
        let unique = crate::now_millis();
        let base = std::env::temp_dir().join(format!("voicenote-secret-test-{unique}"));
        let path = base.join("openai_api_key.bin");

        super::save_encrypted_string(&path, Some("sk-test-secret")).unwrap();
        assert_eq!(
            super::load_encrypted_string(&path).as_deref(),
            Some("sk-test-secret")
        );

        super::save_encrypted_string(&path, None).unwrap();
        assert_eq!(super::load_encrypted_string(&path), None);
        let _ = std::fs::remove_dir_all(base);
    }
}
