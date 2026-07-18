use k256::ecdsa::signature::Verifier;
use k256::ecdsa::{Signature, VerifyingKey};
use wasm_bindgen::prelude::*;

/// ES256K (secp256k1 ECDSA) の署名検証。
/// - `msg`: 署名対象 (JWT の signing input = "header.payload" のバイト列)。内部で SHA-256。
/// - `pubkey`: SEC1 公開鍵 (圧縮 33B / 非圧縮 65B)。
/// - `sig`: raw r||s (64B)。AT Proto は low-S。
/// 検証成功で true。不正入力・検証失敗は false (fail-closed)。
#[wasm_bindgen]
pub fn verify(msg: &[u8], pubkey: &[u8], sig: &[u8]) -> bool {
    let Ok(vk) = VerifyingKey::from_sec1_bytes(pubkey) else {
        return false;
    };
    let Ok(signature) = Signature::from_slice(sig) else {
        return false;
    };
    // low-S を強制 (署名 malleability 対策)。normalize_s が Some = 元が high-S なので拒否。
    // AT Proto 準拠署名は必ず low-S なので正規トークンは落ちない。
    if signature.normalize_s().is_some() {
        return false;
    }
    vk.verify(msg, &signature).is_ok()
}
