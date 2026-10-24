import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import argon2 from 'argon2';

const PHONE_PATTERN = /^1[3-9]\d{9}$/;

export function normalizePhone(input: string): string {
  let value = input.trim().replace(/[\s()\-]/g, '');
  if (value.startsWith('+86')) value = value.slice(3);
  if (value.startsWith('0086')) value = value.slice(4);
  if (!PHONE_PATTERN.test(value)) throw new Error('INVALID_PHONE');
  return value;
}

export function maskPhone(phone: string): string {
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

export function phoneLookupHash(phone: string, pepper: string): string {
  return createHmac('sha256', pepper).update(phone).digest('hex');
}

export function encryptPhone(phone: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(phone, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map((part) => part.toString('base64url')).join('.');
}

export function decryptPhone(payload: string, key: Buffer): string {
  const [ivPart, tagPart, ciphertextPart] = payload.split('.');
  if (!ivPart || !tagPart || !ciphertextPart) throw new Error('INVALID_PHONE_CIPHERTEXT');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivPart, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextPart, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
    hashLength: 32,
  });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function secretDigest(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}

export function csrfForSession(sessionToken: string, secret: string): string {
  return createHmac('sha256', secret).update(`csrf:${sessionToken}`).digest('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
