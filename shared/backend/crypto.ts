import crypto from 'node:crypto';
import { readEnv } from './env.ts';
import { BackendConfigError } from './types.ts';

const DEV_FALLBACK_KEY = Symbol.for('clerk.devFallbackAuthSecret');

export function isAuthSecretConfigured(): boolean {
  return Boolean(readEnv('GUILD_AUTH_SECRET'));
}

export function getServerSecret(): string {
  const configured = readEnv('GUILD_AUTH_SECRET');
  if (configured) {
    return configured;
  }

  if (process.env.NETLIFY === 'true') {
    throw new BackendConfigError(
      503,
      'GUILD_AUTH_SECRET is not configured in Netlify server environment variables.'
    );
  }

  const g = globalThis as Record<symbol, string | undefined>;
  if (!g[DEV_FALLBACK_KEY]) {
    g[DEV_FALLBACK_KEY] = crypto.randomBytes(32).toString('hex');
  }
  return g[DEV_FALLBACK_KEY]!;
}

function getCipherKey(): Buffer {
  return crypto.createHash('sha256').update(getServerSecret()).digest();
}

export function hashCode(salt: string, code: string): string {
  return crypto
    .createHmac('sha256', getServerSecret())
    .update(`${salt}:${code}`)
    .digest('hex');
}

export function constantTimeHexEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function encryptLoginHint(email: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getCipherKey(), iv);
  const encrypted = Buffer.concat([cipher.update(email.toLowerCase(), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}.${tag.toString('hex')}.${encrypted.toString('hex')}`;
}

export function decryptLoginHint(payload: string): string | null {
  try {
    const parts = payload.split('.');
    if (parts.length !== 3) return null;
    const iv = Buffer.from(parts[0], 'hex');
    const tag = Buffer.from(parts[1], 'hex');
    const ciphertext = Buffer.from(parts[2], 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', getCipherKey(), iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}

export function signProof(payloadObj: Record<string, unknown>): string {
  const proofPayload = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
  const proofSig = crypto
    .createHmac('sha256', getServerSecret())
    .update(proofPayload)
    .digest('base64url');
  return `${proofPayload}.${proofSig}`;
}
