use aes::cipher::{generic_array::GenericArray, BlockDecrypt, KeyInit};
use aes::Aes128;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

const CORE_KEY: &[u8; 16] = b"hzHRAmso5kInbaxW";
const META_KEY: &[u8; 16] = b"#14ljk_!\\]&0U<'(";
const NCM_MAGIC: &[u8; 8] = b"CTENFDAM";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NcmMetadata {
    pub music_name: String,
    pub album: String,
    pub artist: String,
    pub format: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ConvertResult {
    pub success: bool,
    pub input_file: String,
    pub output_file: Option<String>,
    pub metadata: Option<NcmMetadata>,
    pub error: Option<String>,
}

fn generate_rc4_keystream(key_data: &[u8]) -> Vec<u8> {
    let key_length = key_data.len();
    let mut s: Vec<u8> = (0..=255).collect();
    let mut j: u8 = 0;
    for i in 0..256 {
        j = j.wrapping_add(s[i]).wrapping_add(key_data[i % key_length]);
        s.swap(i, j as usize);
    }
    let mut stream = [0u8; 256];
    for i in 0..256 {
        stream[i] = s[(s[i] as usize + s[(i + s[i] as usize) & 0xFF] as usize) & 0xFF];
    }
    let mut result = Vec::with_capacity(256 * 64);
    let rotated: Vec<u8> = stream[1..].iter().chain(stream[..1].iter()).copied().collect();
    for _ in 0..64 {
        result.extend_from_slice(&rotated);
    }
    result
}

fn aes_ecb_decrypt(data: &[u8], key: &[u8]) -> Vec<u8> {
    let cipher = Aes128::new(GenericArray::from_slice(key));
    let mut buf = data.to_vec();
    for chunk in buf.chunks_mut(16) {
        let mut block = *GenericArray::from_slice(chunk);
        cipher.decrypt_block(&mut block);
        chunk.copy_from_slice(&block);
    }
    buf
}

fn pkcs7_unpad(data: &[u8]) -> &[u8] {
    if data.is_empty() {
        return data;
    }
    let pad_len = *data.last().unwrap() as usize;
    if pad_len >= 1 && pad_len <= 16 && pad_len <= data.len() {
        &data[..data.len() - pad_len]
    } else {
        data
    }
}

fn read_ncm_file(data: &[u8]) -> Result<(Vec<u8>, NcmMetadata, Option<Vec<u8>>), String> {
    let mut pos = 0;
    if data.len() < 10 || &data[..8] != NCM_MAGIC {
        return Err("Not a valid NCM file".to_string());
    }
    pos += 10;

    let key_length = u32::from_le_bytes(data[pos..pos + 4].try_into().unwrap()) as usize;
    pos += 4;
    let key_data: Vec<u8> = data[pos..pos + key_length].iter().map(|&b| b ^ 0x64).collect();
    pos += key_length;

    let decrypted_key = aes_ecb_decrypt(&key_data, CORE_KEY);
    let unpadded_key = pkcs7_unpad(&decrypted_key);
    let key_material = unpadded_key
        .get(17..)
        .ok_or_else(|| format!("Key material too short (len={})", unpadded_key.len()))?;
    let key_stream = generate_rc4_keystream(key_material);

    let meta_length = u32::from_le_bytes(data[pos..pos + 4].try_into().unwrap()) as usize;
    pos += 4;

    let metadata = if meta_length > 0 {
        let meta_xor: Vec<u8> = data[pos..pos + meta_length].iter().map(|&b| b ^ 0x63).collect();
        pos += meta_length;
        if meta_xor.len() <= 22 {
            return Err("Metadata too short".to_string());
        }
        let b64_str = std::str::from_utf8(&meta_xor[22..])
            .map_err(|e| format!("Invalid UTF-8: {}", e))?;
        let decoded = BASE64.decode(b64_str.trim())
            .map_err(|e| format!("Base64 decode failed: {}", e))?;
        let decrypted_meta = aes_ecb_decrypt(&decoded, META_KEY);
        let unpadded_meta = pkcs7_unpad(&decrypted_meta);
        let json_str = unpadded_meta.get(6..)
            .and_then(|s| std::str::from_utf8(s).ok())
            .ok_or_else(|| format!("Failed to decode metadata JSON (len={})", unpadded_meta.len()))?;
        serde_json::from_str::<serde_json::Value>(json_str)
            .map_err(|e| format!("JSON parse failed: {}", e))?
    } else {
        pos += meta_length;
        let format = if data.len() > 16 * 1024 * 1024 { "flac" } else { "mp3" };
        serde_json::json!({ "format": format })
    };

    let format = metadata["format"].as_str().unwrap_or("mp3").to_string();
    let music_name = metadata["musicName"].as_str().unwrap_or("Unknown").to_string();
    let album = metadata["album"].as_str().unwrap_or("Unknown").to_string();
    let artist = metadata["artist"].as_array()
        .map(|arr| arr.iter()
            .filter_map(|a| a.as_array().and_then(|pair| pair.first()?.as_str()))
            .collect::<Vec<_>>().join("/"))
        .unwrap_or_else(|| "Unknown".to_string());

    let ncm_meta = NcmMetadata { music_name, album, artist, format };

    pos += 5;
    let image_space = u32::from_le_bytes(data[pos..pos + 4].try_into().unwrap()) as usize;
    pos += 4;
    let image_size = u32::from_le_bytes(data[pos..pos + 4].try_into().unwrap()) as usize;
    pos += 4;
    let image_data = if image_size > 0 && pos + image_size <= data.len() {
        Some(data[pos..pos + image_size].to_vec())
    } else {
        None
    };
    pos += image_space;

    if pos >= data.len() {
        return Err("No audio data found".to_string());
    }

    let encrypted_audio = &data[pos..];
    let ks_len = key_stream.len();
    let decrypted_audio: Vec<u8> = encrypted_audio.iter().enumerate()
        .map(|(i, &byte)| byte ^ key_stream[i % ks_len])
        .collect();

    Ok((decrypted_audio, ncm_meta, image_data))
}

pub fn convert_ncm(input_path: &Path, output_dir: Option<&Path>) -> ConvertResult {
    let input_str = input_path.to_string_lossy().to_string();
    let data = match fs::read(input_path) {
        Ok(d) => d,
        Err(e) => return ConvertResult {
            success: false, input_file: input_str, output_file: None,
            metadata: None, error: Some(format!("Failed to read file: {}", e)),
        }
    };
    let (decrypted_audio, metadata, _image_data) = match read_ncm_file(&data) {
        Ok(r) => r,
        Err(e) => return ConvertResult {
            success: false, input_file: input_str, output_file: None,
            metadata: None, error: Some(e),
        }
    };
    let stem = input_path.file_stem().unwrap_or_default().to_string_lossy();
    let output_path = if let Some(dir) = output_dir {
        dir.join(format!("{}.{}", stem, metadata.format))
    } else {
        input_path.with_extension(&metadata.format)
    };
    let output_str = output_path.to_string_lossy().to_string();
    if let Err(e) = fs::write(&output_path, &decrypted_audio) {
        return ConvertResult {
            success: false, input_file: input_str, output_file: Some(output_str),
            metadata: Some(metadata), error: Some(format!("Failed to write output: {}", e)),
        };
    }
    ConvertResult {
        success: true, input_file: input_str, output_file: Some(output_str),
        metadata: Some(metadata), error: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_decrypt_valid_audio() {
        let dir = std::path::PathBuf::from("/Users/yanfengwu/Downloads/testing2");
        if !dir.exists() {
            eprintln!("test dir not found, skipping");
            return;
        }
        let ncm_file = std::fs::read_dir(&dir).unwrap()
            .filter_map(|e| e.ok())
            .find(|e| e.path().extension().map(|x| x == "ncm").unwrap_or(false))
            .map(|e| e.path());
        let path = match ncm_file {
            Some(p) => p,
            None => { eprintln!("no .ncm files found"); return; }
        };
        eprintln!("testing: {}", path.display());

        let data = std::fs::read(&path).unwrap();
        let mut pos = 10usize;
        let kl = u32::from_le_bytes(data[pos..pos+4].try_into().unwrap()) as usize;
        pos += 4;
        let kd: Vec<u8> = data[pos..pos+kl].iter().map(|&b| b ^ 0x64).collect();
        pos += kl;

        let dk = aes_ecb_decrypt(&kd, CORE_KEY);
        eprintln!("decrypted_key first 16: {:?}", &dk[..16]);
        let unpadded = pkcs7_unpad(&dk);
        eprintln!("unpadded len: {}", unpadded.len());
        let km = &unpadded[17..];
        let ks = generate_rc4_keystream(km);
        eprintln!("keystream first 16: {:?}", &ks[..16]);

        // Find audio start
        let ml = u32::from_le_bytes(data[pos..pos+4].try_into().unwrap()) as usize;
        pos += 4 + ml + 5;
        let image_space = u32::from_le_bytes(data[pos..pos+4].try_into().unwrap()) as usize;
        pos += 8 + image_space;

        let enc = &data[pos..pos+16];
        let dec: Vec<u8> = enc.iter().enumerate().map(|(i, &b)| b ^ ks[i % ks.len()]).collect();
        eprintln!("audio first 16: {:?}", &dec);
        assert!(dec[..3] == *b"ID3" || (dec[0] == 0xFF && (dec[1] & 0xE0) == 0xE0) || dec[..4] == *b"fLaC",
            "not valid audio: {:02x?}", &dec[..16]);
    }
}
