import { authenticator } from 'otplib';
import { encryptText, decryptText } from '../utils/encryption.js';

export function generateTotpSecret(): string {
  return authenticator.generateSecret();
}

export function getTotpOtpauthUrl(email: string, secret: string): string {
  return authenticator.keyuri(email, 'TalentstaQ Observer', secret);
}

export function verifyTotpToken(secret: string, token: string): boolean {
  try {
    return authenticator.verify({ token, secret });
  } catch {
    return false;
  }
}

export function encryptTotpSecret(secret: string): string {
  return encryptText(secret);
}

export function decryptTotpSecret(stored: string): string {
  return decryptText(stored);
}
