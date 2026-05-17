import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign,
  timingSafeEqual,
  verify
} from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  NFC_PAYLOAD_HASH_LENGTH,
  NFC_PAYLOAD_HASH_OFFSET,
  NFC_SIGNATURE_LENGTH,
  bytesToBase64Url,
  bytesToHex,
  createUnsignedNfcPayload,
  decodeNfcPayload,
  finalizeNfcPayload,
  hexToBytes,
  nfcSigningBytes,
  type DecodedNfcPayload,
  type UnsignedNfcPayloadInput
} from '../../shared/src/index';

export type SigningIdentity = {
  instance_id: string;
  public_key_id: string;
  public_key_pem: string;
  private_key_pem: string;
  created_at: string;
  active: boolean;
};

export type SigningKeyStore = {
  instance_id: string;
  active_public_key_id: string;
  keys: SigningIdentity[];
};

export type VerifiedNfcPayload = {
  ok: boolean;
  reason: 'valid' | 'bad_signature' | 'bad_hash' | 'unknown_key' | 'invalid_payload';
  decoded: DecodedNfcPayload | null;
  payload_hash: string | null;
  public_key_id: string | null;
};

export type SecretBox = {
  algorithm: 'aes-256-gcm';
  nonce: string;
  ciphertext: string;
  auth_tag: string;
};

const SIGNING_FILE = 'signing-keys.json';
const ZERO_SIGNATURE = new Uint8Array(NFC_SIGNATURE_LENGTH);

export function createInstanceId(): string {
  return `fb_${bytesToHex(randomBytes(16))}`;
}

export function createSigningIdentity(instanceId: string, createdAt = new Date().toISOString()): SigningIdentity {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const public_key_pem = publicKey.export({ format: 'pem', type: 'spki' }).toString();
  const private_key_pem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
  const public_key_id = bytesToHex(sha256Bytes(Buffer.from(`${instanceId}\n${public_key_pem}`, 'utf8'))).slice(0, 32);
  return {
    instance_id: instanceId,
    public_key_id,
    public_key_pem,
    private_key_pem,
    created_at: createdAt,
    active: true
  };
}

export function createSigningKeyStore(instanceId = createInstanceId()): SigningKeyStore {
  const key = createSigningIdentity(instanceId);
  return {
    instance_id: instanceId,
    active_public_key_id: key.public_key_id,
    keys: [key]
  };
}

export function loadOrCreateSigningKeyStore(directory: string, instanceId?: string): SigningKeyStore {
  mkdirSync(directory, { recursive: true });
  const filePath = join(directory, SIGNING_FILE);
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as SigningKeyStore;
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : '';
    if (code !== 'ENOENT') {
      throw error;
    }
    const store = createSigningKeyStore(instanceId);
    saveSigningKeyStore(directory, store);
    return store;
  }
}

export function saveSigningKeyStore(directory: string, store: SigningKeyStore): void {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, SIGNING_FILE), `${JSON.stringify(store, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

export function activeSigningIdentity(store: SigningKeyStore): SigningIdentity {
  const key = store.keys.find((candidate) => candidate.public_key_id === store.active_public_key_id && candidate.active);
  if (key === undefined) {
    throw new Error('active signing key is missing');
  }
  return key;
}

export function rotateSigningKey(store: SigningKeyStore): SigningKeyStore {
  const key = createSigningIdentity(store.instance_id);
  return {
    instance_id: store.instance_id,
    active_public_key_id: key.public_key_id,
    keys: store.keys.map((existing) => ({ ...existing, active: false })).concat(key)
  };
}

export function signNfcPayload(input: UnsignedNfcPayloadInput, identity: SigningIdentity): { payload: Uint8Array; encoded_payload: string; payload_hash: string; signature: string } {
  const unsigned = createUnsignedNfcPayload({ ...input, public_key_id: identity.public_key_id });
  const payloadHash = tagPayloadHash(unsigned);
  const withHash = finalizeNfcPayload(unsigned, payloadHash, ZERO_SIGNATURE);
  const signature = sign(null, Buffer.from(nfcSigningBytes(withHash)), createPrivateKey(identity.private_key_pem));
  if (signature.byteLength !== NFC_SIGNATURE_LENGTH) {
    throw new Error('unexpected Ed25519 signature length');
  }
  const payload = finalizeNfcPayload(unsigned, payloadHash, new Uint8Array(signature));
  return {
    payload,
    encoded_payload: bytesToBase64Url(payload),
    payload_hash: bytesToHex(payloadHash),
    signature: bytesToHex(signature)
  };
}

export function verifyNfcPayload(payload: Uint8Array, store: SigningKeyStore): VerifiedNfcPayload {
  try {
    const decoded = decodeNfcPayload(payload);
    const actualHash = tagPayloadHash(payload);
    const encodedHash = payload.slice(NFC_PAYLOAD_HASH_OFFSET, NFC_PAYLOAD_HASH_OFFSET + NFC_PAYLOAD_HASH_LENGTH);
    if (!timingSafeEqual(Buffer.from(actualHash), Buffer.from(encodedHash))) {
      return { ok: false, reason: 'bad_hash', decoded, payload_hash: bytesToHex(actualHash), public_key_id: null };
    }
    const signatureBytes = payload.slice(69, 69 + NFC_SIGNATURE_LENGTH);
    const key = store.keys.find((candidate) => bytesToHex(compactPublicKeyRef(candidate.public_key_id)) === decoded.public_key_id_ref);
    if (key === undefined) {
      return { ok: false, reason: 'unknown_key', decoded, payload_hash: bytesToHex(actualHash), public_key_id: null };
    }
    const ok = verify(null, Buffer.from(nfcSigningBytes(payload)), createPublicKey(key.public_key_pem), Buffer.from(signatureBytes));
    return {
      ok,
      reason: ok ? 'valid' : 'bad_signature',
      decoded,
      payload_hash: bytesToHex(actualHash),
      public_key_id: key.public_key_id
    };
  } catch {
    return { ok: false, reason: 'invalid_payload', decoded: null, payload_hash: null, public_key_id: null };
  }
}

export function tagPayloadHash(payload: Uint8Array): Uint8Array {
  return sha256Bytes(payload.slice(0, NFC_PAYLOAD_HASH_OFFSET)).slice(0, NFC_PAYLOAD_HASH_LENGTH);
}

export function sha256Hex(input: string | Uint8Array): string {
  return bytesToHex(sha256Bytes(input));
}

export function sha256Bytes(input: string | Uint8Array): Uint8Array {
  const hash = createHash('sha256');
  hash.update(typeof input === 'string' ? Buffer.from(input, 'utf8') : Buffer.from(input));
  return new Uint8Array(hash.digest());
}

export function hmacSha256Hex(secret: string | Uint8Array, input: string | Uint8Array): string {
  const hmac = createHmac('sha256', typeof secret === 'string' ? Buffer.from(secret, 'utf8') : Buffer.from(secret));
  hmac.update(typeof input === 'string' ? Buffer.from(input, 'utf8') : Buffer.from(input));
  return hmac.digest('hex');
}

export function generateSalt(bytes = 16): string {
  return bytesToHex(randomBytes(bytes));
}

export function saltedHash(value: string, salt: string): string {
  return sha256Hex(`${salt}:${value}`);
}

export function hashTagUid(tagUid: string, salt: string): string {
  return saltedHash(`nfc:${tagUid}`, salt);
}

export function hashPrinterSerial(serial: string, salt: string): string {
  return saltedHash(`printer:${serial}`, salt);
}

export function createSecretKey(material: string): Uint8Array {
  return sha256Bytes(`filamentbridge-secret-box:${material}`);
}

export function encryptSecret(plaintext: string, key: Uint8Array): SecretBox {
  if (key.byteLength !== 32) {
    throw new Error('secret key must be 32 bytes');
  }
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(key), nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    algorithm: 'aes-256-gcm',
    nonce: bytesToBase64Url(nonce),
    ciphertext: bytesToBase64Url(ciphertext),
    auth_tag: bytesToBase64Url(authTag)
  };
}

export function decryptSecret(box: SecretBox, key: Uint8Array): string {
  if (box.algorithm !== 'aes-256-gcm') {
    throw new Error('unsupported secret box algorithm');
  }
  if (key.byteLength !== 32) {
    throw new Error('secret key must be 32 bytes');
  }
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(key), Buffer.from(base64UrlDecode(box.nonce)));
  decipher.setAuthTag(Buffer.from(base64UrlDecode(box.auth_tag)));
  return Buffer.concat([
    decipher.update(Buffer.from(base64UrlDecode(box.ciphertext))),
    decipher.final()
  ]).toString('utf8');
}

export function safeToken(bytes = 32): string {
  return bytesToBase64Url(randomBytes(bytes));
}

export function constantTimeEqualHex(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

function compactPublicKeyRef(publicKeyId: string): Uint8Array {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let index = 0; index < publicKeyId.length; index += 1) {
    hash ^= BigInt(publicKeyId.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * prime);
  }
  const out = new Uint8Array(8);
  let cursor = hash;
  for (let index = 0; index < out.length; index += 1) {
    out[index] = Number(cursor & 0xffn);
    cursor >>= 8n;
  }
  return out;
}

function base64UrlDecode(encoded: string): Uint8Array {
  const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
  return new Uint8Array(Buffer.from(normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '='), 'base64'));
}

export { hexToBytes };
