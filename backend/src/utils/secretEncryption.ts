import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const FORMAT_VERSION = 'v1';

// Any-length passphrase from env -> a fixed 32-byte key, so operators don't
// have to generate/format an exact-length key themselves.
function getKey(): Buffer {
  const material = process.env.INTEGRATION_SECRET_ENCRYPTION_KEY || '';
  if (!material) {
    throw new Error('INTEGRATION_SECRET_ENCRYPTION_KEY is not configured');
  }

  return createHash('sha256').update(material).digest();
}

// Encrypts values (recruiter-partner JWT secrets, per-company webhook secrets)
// before they're stored, so a DB read/leak doesn't hand over usable signing
// secrets in plaintext. AES-256-GCM: authenticated, random IV per call.
export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [FORMAT_VERSION, iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join(':');
}

export function decryptSecret(stored: string): string {
  const [version, ivB64, tagB64, dataB64] = stored.split(':');
  if (version !== FORMAT_VERSION || !ivB64 || !tagB64 || !dataB64) {
    throw new Error('Malformed encrypted secret');
  }

  const key = getKey();
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(tagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(data), decipher.final()]);

  return plaintext.toString('utf8');
}
