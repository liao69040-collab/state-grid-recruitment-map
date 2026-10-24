import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  csrfForSession,
  decryptPhone,
  encryptPhone,
  hashPassword,
  normalizePhone,
  phoneLookupHash,
  safeEqual,
  verifyPassword,
} from '../src/lib/crypto.js';

describe('security primitives', () => {
  it('normalizes, encrypts and deterministically indexes a phone without plaintext storage', () => {
    const phone = normalizePhone('+86 138-0013-8000');
    const key = randomBytes(32);
    const ciphertext = encryptPhone(phone, key);
    expect(phone).toBe('13800138000');
    expect(ciphertext).not.toContain(phone);
    expect(decryptPhone(ciphertext, key)).toBe(phone);
    expect(phoneLookupHash(phone, 'p'.repeat(48))).toHaveLength(64);
  });

  it('uses argon2id password hashes', async () => {
    const hash = await hashPassword('StrongPassword123!');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    await expect(verifyPassword(hash, 'StrongPassword123!')).resolves.toBe(true);
    await expect(verifyPassword(hash, 'wrong-password')).resolves.toBe(false);
  });

  it('derives stable CSRF tokens and compares without early string equality', () => {
    const token = csrfForSession('session-token', 's'.repeat(48));
    expect(token).toBe(csrfForSession('session-token', 's'.repeat(48)));
    expect(safeEqual(token, token)).toBe(true);
    expect(safeEqual(token, `${token}x`)).toBe(false);
  });
});
