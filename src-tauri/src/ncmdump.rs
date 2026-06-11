use aes::cipher::{generic_array::GenericArray, BlockDecrypt, KeyInit};
use aes::Aes128;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use id3::TagLike;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

const CORE_KEY: &[u8; 16] = b"hzHRmso5kInbaWxW";
const META_KEY: &[u8; 16] = b"#14lkj_!\\]&0U<'(";
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

/// Generate RC4 keystream from key data (16KB)
fn generate_rc4_keystream(key_data: &[u8]) -> Vec<u8> {
    let key_length = key_data.len();
    let mut s: Vec<u8> = (0..=255).collect();
    let mut j: u8 = 0;

    // KSA
    for i in 0..256 {
        j = j.wrapping_add(s[i]).wrapping_add(key_data[i % key_length]);
        s.swap(i, j as usize);
    }

    // Generate stream
    let mut stream = [0u8; 256];
    for i in 0..256 {
        stream[i] = s[(s[i] as usize + s[(i + s[i] as usize) & 0xFF] as usize) & 0xFF];
    }

    // Rotate left by 1 and repeat 64 times -> 16KB
    let mut result = Vec::with_capacity(256 * 64);
    let rotated: Vec<u8> = stream[1..].iter().chain(stream[..1].iter()).copied().collect();
    for _ in 0..64 {
        result.extend_from_slice(&rotated);
    }
    result
}

/// AES-128-ECB decrypt with PKCS7 unpadding
fn aes_ecb_decrypt(data: &[u8], key: &[u8; 16]) -> Result<Vec<u8>, String> {
    if data.is_empty() || data.len() % 16 != 0 {
        return Err(format!("Invalid AES input length: {}", data.len()));
    }

    let cipher = Aes128::new(key.into());
    let mut buf = data.to_vec();

    // Decrypt block by block (ECB mode)
    for chunk in buf.chunks_mut(16) {
        let mut block = *GenericArray::from_slice(chunk);
        cipher.decrypt_block(&mut block);
        chunk.copy_from_slice(&block);
    }

    // PKCS7 unpad
    let pad_len = *buf.last().ok_or("Empty decrypted data")? as usize;
    if pad_len == 0 || pad_len > 16 || pad_len > buf.len() {
        return Err("Invalid PKCS7 padding".to_string());
    }
    for &b in &buf[buf.len() - pad_len..] {
        if b as usize != pad_len {
            return Err("Invalid PKCS7 padding bytes".to_string());
        }
    }
    buf.truncate(buf.len() - pad_len);
    Ok(buf)
}

/// Read and parse NCM file, return (decrypted_audio, metadata, image_data)
fn read_ncm_file(data: &[u8]) -> Result<(Vec<u8>, NcmMetadata, Option<Vec<u8>>), String> {
    let mut pos = 0;

    // 1. Validate magic header
    if data.len() < 10 || &data[..8] != NCM_MAGIC {
        return Err("Not a valid NCM file".to_string());
    }
    pos += 10; // 8 magic + 2 gap

    // 2. Read & decrypt key data
    if pos + 4 > data.len() {
        return Err("Truncated key length".to_string());
    }
    let key_length = u32::from_le_bytes(data[pos..pos + 4].try_into().unwrap()) as usize;
    pos += 4;

    if pos + key_length > data.len() {
        return Err("Truncated key data".to_string());
    }
    let key_data: Vec<u8> = data[pos..pos + key_length].iter().map(|&b| b ^ 0x64).collect();
    pos += key_length;

    let decrypted_key = aes_ecb_decrypt(&key_data, CORE_KEY)?;
    let key_material = decrypted_key
        .get(17..)
        .ok_or("Key material too short")?;
    let key_stream = generate_rc4_keystream(key_material);

    // 3. Read & decrypt metadata
    if pos + 4 > data.len() {
        return Err("Truncated metadata length".to_string());
    }
    let meta_length = u32::from_le_bytes(data[pos..pos + 4].try_into().unwrap()) as usize;
    pos += 4;

    let metadata = if meta_length > 0 {
        if pos + meta_length > data.len() {
            return Err("Truncated metadata".to_string());
        }
        let meta_xor: Vec<u8> = data[pos..pos + meta_length].iter().map(|&b| b ^ 0x63).collect();
        pos += meta_length;

        if meta_xor.len() <= 22 {
            return Err("Metadata too short after XOR".to_string());
        }
        let b64_str = std::str::from_utf8(&meta_xor[22..])
            .map_err(|e| format!("Invalid UTF-8 in metadata: {}", e))?;
        let decoded = BASE64
            .decode(b64_str)
            .map_err(|e| format!("Base64 decode failed: {}", e))?;

        let decrypted_meta = aes_ecb_decrypt(&decoded, META_KEY)?;
        let json_str = decrypted_meta
            .get(6..)
            .and_then(|s| std::str::from_utf8(s).ok())
            .ok_or("Failed to decode metadata JSON")?;

        serde_json::from_str::<serde_json::Value>(json_str)
            .map_err(|e| format!("JSON parse failed: {}", e))?
    } else {
        // No metadata, infer format from file size
        let format = if data.len() > 16 * 1024 * 1024 {
            "flac"
        } else {
            "mp3"
        };
        serde_json::json!({ "format": format })
    };

    let format = metadata["format"].as_str().unwrap_or("mp3").to_string();
    let music_name = metadata["musicName"].as_str().unwrap_or("Unknown").to_string();
    let album = metadata["album"].as_str().unwrap_or("Unknown").to_string();

    let artist = metadata["artist"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|a| a.as_array().and_then(|pair| pair.first()?.as_str()))
                .collect::<Vec<_>>()
                .join("/")
        })
        .unwrap_or_else(|| "Unknown".to_string());

    let ncm_meta = NcmMetadata {
        music_name,
        album,
        artist,
        format,
    };

    // 4. Read image data
    if pos + 5 > data.len() {
        return Err("Truncated image section".to_string());
    }
    pos += 5; // gap

    if pos + 8 > data.len() {
        return Err("Truncated image sizes".to_string());
    }
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

    // 5. Decrypt audio data
    if pos >= data.len() {
        return Err("No audio data found".to_string());
    }

    let encrypted_audio = &data[pos..];
    let ks_len = key_stream.len();
    let decrypted_audio: Vec<u8> = encrypted_audio
        .iter()
        .enumerate()
        .map(|(i, &byte)| byte ^ key_stream[i % ks_len])
        .collect();

    Ok((decrypted_audio, ncm_meta, image_data))
}

/// Convert a single NCM file
pub fn convert_ncm(input_path: &Path, output_dir: Option<&Path>) -> ConvertResult {
    let input_str = input_path.to_string_lossy().to_string();

    let data = match fs::read(input_path) {
        Ok(d) => d,
        Err(e) => {
            return ConvertResult {
                success: false,
                input_file: input_str,
                output_file: None,
                metadata: None,
                error: Some(format!("Failed to read file: {}", e)),
            }
        }
    };

    let (decrypted_audio, metadata, image_data) = match read_ncm_file(&data) {
        Ok(r) => r,
        Err(e) => {
            return ConvertResult {
                success: false,
                input_file: input_str,
                output_file: None,
                metadata: None,
                error: Some(e),
            }
        }
    };

    // Determine output path
    let stem = input_path
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy();
    let output_path = if let Some(dir) = output_dir {
        dir.join(format!("{}.{}", stem, metadata.format))
    } else {
        input_path.with_extension(&metadata.format)
    };

    let output_str = output_path.to_string_lossy().to_string();

    // Write decrypted audio
    if let Err(e) = fs::write(&output_path, &decrypted_audio) {
        return ConvertResult {
            success: false,
            input_file: input_str,
            output_file: Some(output_str),
            metadata: Some(metadata),
            error: Some(format!("Failed to write output: {}", e)),
        };
    }

    // Tag the file
    if let Err(e) = tag_audio_file(&output_path, &metadata, image_data.as_deref()) {
        return ConvertResult {
            success: false,
            input_file: input_str,
            output_file: Some(output_str),
            metadata: Some(metadata),
            error: Some(format!("Failed to tag file: {}", e)),
        };
    }

    ConvertResult {
        success: true,
        input_file: input_str,
        output_file: Some(output_str),
        metadata: Some(metadata),
        error: None,
    }
}

/// Write audio tags
fn tag_audio_file(
    path: &Path,
    metadata: &NcmMetadata,
    image_data: Option<&[u8]>,
) -> Result<(), String> {
    match metadata.format.as_str() {
        "mp3" => tag_mp3(path, metadata, image_data),
        "flac" => tag_flac(path, metadata, image_data),
        _ => Err(format!("Unsupported format: {}", metadata.format)),
    }
}

fn tag_mp3(
    path: &Path,
    metadata: &NcmMetadata,
    image_data: Option<&[u8]>,
) -> Result<(), String> {
    let mut tag = id3::Tag::read_from_path(path).unwrap_or_default();

    tag.set_title(&metadata.music_name);
    tag.set_album(&metadata.album);
    tag.set_artist(&metadata.artist);

    if let Some(img) = image_data {
        let mime = if img.starts_with(&[0x89, 0x50, 0x4E, 0x47]) {
            "image/png"
        } else {
            "image/jpeg"
        };
        tag.add_frame(id3::frame::Picture {
            mime_type: mime.to_string(),
            picture_type: id3::frame::PictureType::CoverFront,
            description: String::new(),
            data: img.to_vec(),
        });
    }

    tag.write_to_path(path, id3::Version::Id3v24)
        .map_err(|e| format!("Failed to write ID3 tags: {}", e))
}

fn tag_flac(
    path: &Path,
    metadata: &NcmMetadata,
    image_data: Option<&[u8]>,
) -> Result<(), String> {
    let mut tag =
        metaflac::Tag::read_from_path(path).map_err(|e| format!("Failed to read FLAC: {}", e))?;

    tag.set_vorbis("TITLE", vec![metadata.music_name.clone()]);
    tag.set_vorbis("ALBUM", vec![metadata.album.clone()]);
    tag.set_vorbis("ARTIST", vec![metadata.artist.clone()]);

    if let Some(img) = image_data {
        let mime = if img.starts_with(&[0x89, 0x50, 0x4E, 0x47]) {
            "image/png"
        } else {
            "image/jpeg"
        };
        tag.add_picture(
            mime.to_string(),
            metaflac::block::PictureType::CoverFront,
            img.to_vec(),
        );
    }

    tag.write_to_path(path)
        .map_err(|e| format!("Failed to write FLAC tags: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rc4_keystream_length() {
        let key = b"test_key_data_16";
        let stream = generate_rc4_keystream(key);
        assert_eq!(stream.len(), 256 * 64);
    }
}
