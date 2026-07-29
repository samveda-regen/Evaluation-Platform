import crypto from 'crypto';

// AES-256-GCM at-rest encryption for sensitive JSON blobs (audit before/after
// snapshots, TOTP secrets). Deliberately fails open — if no key is
// configured, callers get plaintext back and a one-time startup warning,
// rather than either crashing the server or silently generating a
// throw-away key that would make previously-encrypted rows permanently
// unreadable after a restart.

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

let cachedKey: Buffer | null | undefined;
let warnedOnce = false;

function getKey(): Buffer | null {
  if (cachedKey !== undefined) return cachedKey;

  const raw = process.env.AUDIT_ENCRYPTION_KEY?.trim();
  if (!raw) {
    if (!warnedOnce) {
      console.warn(
        '[encryption] AUDIT_ENCRYPTION_KEY is not set — audit snapshots and TOTP secrets will be stored in plaintext. ' +
          'Set a 32-byte base64 key (e.g. `openssl rand -base64 32`) to enable at-rest encryption.'
      );
      warnedOnce = true;
    }
    cachedKey = null;
    return null;
  }

  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== 32) {
    console.warn('[encryption] AUDIT_ENCRYPTION_KEY is not a valid 32-byte base64 key — falling back to plaintext.');
    cachedKey = null;
    return null;
  }

  cachedKey = buf;
  return cachedKey;
}

export function isEncryptionConfigured(): boolean {
  return getKey() !== null;
}

// Returns a plain string unchanged if no key is configured (fail-open).
export function encryptText(plaintext: string): string {
  const key = getKey();
  if (!key) return plaintext;

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `enc:${Buffer.concat([iv, authTag, ciphertext]).toString('base64')}`;
}

// Returns the input unchanged if it isn't in the `enc:` envelope produced
// above (covers both "no key configured" and "legacy plaintext row").
export function decryptText(value: string): string {
  if (!value.startsWith('enc:')) return value;
  const key = getKey();
  if (!key) return value;

  try {
    const raw = Buffer.from(value.slice(4), 'base64');
    const iv = raw.subarray(0, IV_LENGTH);
    const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + 16);
    const ciphertext = raw.subarray(IV_LENGTH + 16);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString('utf8');
  } catch (error) {
    console.error('[encryption] Failed to decrypt value:', error);
    return value;
  }
}

export function encryptJson(value: unknown): string {
  return encryptText(JSON.stringify(value));
}

export function decryptJson<T = unknown>(value: string): T {
  return JSON.parse(decryptText(value)) as T;
}
