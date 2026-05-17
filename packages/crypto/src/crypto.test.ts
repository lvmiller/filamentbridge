import { describe, expect, it } from 'vitest';
import { decodeNfcPayload, decodePayloadBase64Url } from '../../shared/src/index';
import {
  createSecretKey,
  createSigningKeyStore,
  decryptSecret,
  encryptSecret,
  hashPrinterSerial,
  hashTagUid,
  rotateSigningKey,
  signNfcPayload,
  verifyNfcPayload
} from './index';

describe('crypto and NFC payload signing', () => {
  it('encodes, signs, decodes, and verifies FilamentBridge companion payloads', () => {
    const store = createSigningKeyStore('fb_test_instance');
    const identity = store.keys[0];
    expect(identity).toBeDefined();
    const signed = signNfcPayload({
      instance_id: store.instance_id,
      tag_id: 'tag-1',
      spool_id: 'spool-1',
      material_type: 'PLA',
      diameter_mm: 1.75,
      color_hex: '#1e88e5',
      remaining_weight_g: 873,
      nozzle_temp_min_c: 190,
      nozzle_temp_max_c: 230,
      drying_temp_c: 45,
      drying_time_minutes: 240,
      written_at_epoch_seconds: 1_700_000_000,
      public_key_id: identity!.public_key_id
    }, identity!);
    const payload = decodePayloadBase64Url(signed.encoded_payload);
    const decoded = decodeNfcPayload(payload);
    expect(decoded.material_type).toBe('PLA');
    expect(decoded.remaining_weight_g).toBe(873);
    expect(verifyNfcPayload(payload, store)).toMatchObject({ ok: true, reason: 'valid' });
  });

  it('rejects modified payloads and preserves historical rotated keys', () => {
    const store = createSigningKeyStore('fb_test_instance');
    const identity = store.keys[0]!;
    const signed = signNfcPayload({
      instance_id: store.instance_id,
      tag_id: 'tag-1',
      spool_id: 'spool-1',
      material_type: 'PETG',
      diameter_mm: 1.75,
      color_hex: '#000000',
      remaining_weight_g: 500,
      nozzle_temp_min_c: 230,
      nozzle_temp_max_c: 250,
      drying_temp_c: 65,
      drying_time_minutes: 360,
      written_at_epoch_seconds: 1,
      public_key_id: identity.public_key_id
    }, identity);
    const rotated = rotateSigningKey(store);
    expect(verifyNfcPayload(signed.payload, rotated).ok).toBe(true);
    const tampered = new Uint8Array(signed.payload);
    tampered[34] = 0;
    expect(verifyNfcPayload(tampered, rotated).reason).toBe('bad_hash');
  });

  it('hashes UIDs and serials with salt and encrypts local secrets', () => {
    const salt = 'fixed-salt';
    expect(hashTagUid('04abcdef', salt)).toBe(hashTagUid('04abcdef', salt));
    expect(hashTagUid('04abcdef', salt)).not.toBe(hashPrinterSerial('04abcdef', salt));
    const key = createSecretKey('local-secret');
    const box = encryptSecret('printer-lan-code', key);
    expect(box.ciphertext).not.toContain('printer-lan-code');
    expect(decryptSecret(box, key)).toBe('printer-lan-code');
  });
});
