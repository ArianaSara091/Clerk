import { Redis } from '@upstash/redis';
import { readEnv } from './env.ts';
import { BackendConfigError, type DiscordOAuthState, type OtpChallenge } from './types.ts';

interface MemoryEntry {
  value: unknown;
  expiresAt: number | null;
}

const MEM_STORE_SYMBOL = Symbol.for('clerk.devMemoryStore');
const REDIS_CLIENT_SYMBOL = Symbol.for('clerk.upstashRedisClient');

function getMemoryStore(): Map<string, MemoryEntry> {
  const g = globalThis as Record<symbol, Map<string, MemoryEntry> | undefined>;
  if (!g[MEM_STORE_SYMBOL]) {
    g[MEM_STORE_SYMBOL] = new Map<string, MemoryEntry>();
  }
  return g[MEM_STORE_SYMBOL]!;
}

function getMemoryEntry<T>(key: string): { value: T; remainingTtlSeconds: number | null } | null {
  const store = getMemoryStore();
  const entry = store.get(key);
  if (!entry) return null;
  if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
    store.delete(key);
    return null;
  }
  const remainingTtlSeconds =
    entry.expiresAt === null ? null : Math.max(1, Math.ceil((entry.expiresAt - Date.now()) / 1000));
  return { value: entry.value as T, remainingTtlSeconds };
}

function setMemoryEntry(key: string, value: unknown, ttlSeconds?: number): void {
  const store = getMemoryStore();
  const expiresAt =
    typeof ttlSeconds === 'number' && ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : null;
  store.set(key, { value, expiresAt });
}

export function isUpstashConfigured(): boolean {
  return Boolean(readEnv('UPSTASH_REDIS_REST_URL') && readEnv('UPSTASH_REDIS_REST_TOKEN'));
}

function getRedisClient(): Redis | null {
  const url = readEnv('UPSTASH_REDIS_REST_URL').replace(/\/+$/, '');
  const token = readEnv('UPSTASH_REDIS_REST_TOKEN');
  if (!url || !token) {
    if (process.env.NETLIFY === 'true') {
      throw new BackendConfigError(
        503,
        'Upstash Redis environment variables (UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN) are not configured.'
      );
    }
    return null;
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('Invalid scheme');
    }
  } catch {
    throw new BackendConfigError(
      503,
      'UPSTASH_REDIS_REST_URL is invalid. It must be a full https:// Upstash REST URL.'
    );
  }

  const g = globalThis as Record<symbol, { url: string; token: string; client: Redis } | undefined>;
  const existing = g[REDIS_CLIENT_SYMBOL];
  if (!existing || existing.url !== url || existing.token !== token) {
    g[REDIS_CLIENT_SYMBOL] = {
      url,
      token,
      client: new Redis({ url, token }),
    };
  }
  return g[REDIS_CLIENT_SYMBOL]!.client;
}

function parseStoredJson<T>(raw: unknown): T | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as unknown as T;
    }
  }
  return raw as T;
}

export async function pingStateStore(): Promise<{
  configured: boolean;
  connected: boolean;
  backend: 'upstash-redis' | 'memory-dev';
}> {
  if (!isUpstashConfigured()) {
    return {
      configured: false,
      connected: process.env.NETLIFY !== 'true',
      backend: process.env.NETLIFY === 'true' ? 'upstash-redis' : 'memory-dev',
    };
  }

  try {
    const redis = getRedisClient();
    if (!redis) {
      return { configured: false, connected: false, backend: 'upstash-redis' };
    }
    const pong = await redis.ping();
    return {
      configured: true,
      connected: pong === 'PONG',
      backend: 'upstash-redis',
    };
  } catch {
    return {
      configured: true,
      connected: false,
      backend: 'upstash-redis',
    };
  }
}

export async function getOtpResendCooldown(
  purpose: 'signup' | '2fa',
  email: string
): Promise<number> {
  const key = `clerk:otp:cooldown:${purpose}:${email}`;
  const redis = getRedisClient();
  if (!redis) {
    const entry = getMemoryEntry<number>(key);
    return entry?.remainingTtlSeconds ?? 0;
  }

  const ttl = await redis.ttl(key);
  return ttl > 0 ? ttl : 0;
}

export async function setOtpResendCooldown(
  purpose: 'signup' | '2fa',
  email: string,
  cooldownSeconds: number
): Promise<void> {
  const key = `clerk:otp:cooldown:${purpose}:${email}`;
  const redis = getRedisClient();
  if (!redis) {
    setMemoryEntry(key, Date.now(), cooldownSeconds);
    return;
  }
  await redis.set(key, '1', { ex: cooldownSeconds });
}

export async function saveOtpChallenge(
  challenge: OtpChallenge,
  ttlSeconds: number
): Promise<void> {
  const key = `clerk:otp:challenge:${challenge.challengeId}`;
  const redis = getRedisClient();
  if (!redis) {
    setMemoryEntry(key, challenge, ttlSeconds);
    return;
  }
  await redis.set(key, JSON.stringify(challenge), { ex: ttlSeconds });
}

export async function getOtpChallenge(challengeId: string): Promise<OtpChallenge | null> {
  const key = `clerk:otp:challenge:${challengeId}`;
  const redis = getRedisClient();
  if (!redis) {
    const entry = getMemoryEntry<OtpChallenge>(key);
    return entry ? entry.value : null;
  }
  const raw = await redis.get(key);
  return parseStoredJson<OtpChallenge>(raw);
}

export async function updateOtpChallengeAttempts(challenge: OtpChallenge): Promise<void> {
  const key = `clerk:otp:challenge:${challenge.challengeId}`;
  const remainingSeconds = Math.max(1, Math.ceil((challenge.expiresAt - Date.now()) / 1000));
  const redis = getRedisClient();
  if (!redis) {
    setMemoryEntry(key, challenge, remainingSeconds);
    return;
  }
  await redis.set(key, JSON.stringify(challenge), { ex: remainingSeconds });
}

export async function deleteOtpChallenge(challengeId: string): Promise<void> {
  const key = `clerk:otp:challenge:${challengeId}`;
  const redis = getRedisClient();
  if (!redis) {
    getMemoryStore().delete(key);
    return;
  }
  await redis.del(key);
}

export async function checkRateLimit(
  bucketKey: string,
  maxCount: number,
  windowSeconds: number,
  lockoutSeconds: number
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const lockKey = `clerk:rl:lock:${bucketKey}`;
  const countKey = `clerk:rl:count:${bucketKey}`;
  const redis = getRedisClient();

  if (!redis) {
    const lock = getMemoryEntry<number>(lockKey);
    if (lock) {
      return {
        allowed: false,
        retryAfterSeconds: lock.remainingTtlSeconds ?? lockoutSeconds,
      };
    }

    const existing = getMemoryEntry<number>(countKey);
    if (!existing) {
      setMemoryEntry(countKey, 1, windowSeconds);
      return { allowed: true, retryAfterSeconds: 0 };
    }

    const nextCount = existing.value + 1;
    if (nextCount > maxCount) {
      setMemoryEntry(lockKey, 1, lockoutSeconds);
      return { allowed: false, retryAfterSeconds: lockoutSeconds };
    }

    setMemoryEntry(countKey, nextCount, existing.remainingTtlSeconds ?? windowSeconds);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  const lockTtl = await redis.ttl(lockKey);
  if (lockTtl > 0) {
    return { allowed: false, retryAfterSeconds: lockTtl };
  }

  const count = await redis.incr(countKey);
  if (count === 1) {
    await redis.expire(countKey, windowSeconds);
  }
  if (count > maxCount) {
    await redis.set(lockKey, '1', { ex: lockoutSeconds });
    return { allowed: false, retryAfterSeconds: lockoutSeconds };
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

export async function checkLoginLockout(
  keys: string[]
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const redis = getRedisClient();
  for (const bucketKey of keys) {
    const lockKey = `clerk:login:lock:${bucketKey}`;
    if (!redis) {
      const entry = getMemoryEntry<number>(lockKey);
      if (entry) {
        return {
          allowed: false,
          retryAfterSeconds: entry.remainingTtlSeconds ?? 900,
        };
      }
    } else {
      const ttl = await redis.ttl(lockKey);
      if (ttl > 0) {
        return { allowed: false, retryAfterSeconds: ttl };
      }
    }
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

export async function recordLoginFailure(
  bucketKey: string,
  maxFailures: number,
  lockoutSeconds: number
): Promise<{ count: number; locked: boolean; retryAfterSeconds: number }> {
  const failKey = `clerk:login:fail:${bucketKey}`;
  const lockKey = `clerk:login:lock:${bucketKey}`;
  const redis = getRedisClient();

  if (!redis) {
    const existing = getMemoryEntry<number>(failKey);
    const nextCount = (existing?.value ?? 0) + 1;
    setMemoryEntry(failKey, nextCount, existing?.remainingTtlSeconds ?? lockoutSeconds);

    if (nextCount >= maxFailures) {
      setMemoryEntry(lockKey, 1, lockoutSeconds);
      return { count: nextCount, locked: true, retryAfterSeconds: lockoutSeconds };
    }
    return { count: nextCount, locked: false, retryAfterSeconds: 0 };
  }

  const count = await redis.incr(failKey);
  if (count === 1) {
    await redis.expire(failKey, lockoutSeconds);
  }
  if (count >= maxFailures) {
    await redis.set(lockKey, '1', { ex: lockoutSeconds });
    return { count, locked: true, retryAfterSeconds: lockoutSeconds };
  }
  return { count, locked: false, retryAfterSeconds: 0 };
}

export async function clearLoginFailures(keys: string[]): Promise<void> {
  const redis = getRedisClient();
  const keysToDelete = keys.flatMap((k) => [`clerk:login:fail:${k}`, `clerk:login:lock:${k}`]);
  if (keysToDelete.length === 0) return;

  if (!redis) {
    const store = getMemoryStore();
    for (const k of keysToDelete) {
      store.delete(k);
    }
    return;
  }

  await redis.del(...keysToDelete);
}

const USERNAME_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;

export async function setUsernameEmailCache(username: string, email: string): Promise<void> {
  const key = `clerk:username:${username}`;
  const redis = getRedisClient();
  if (!redis) {
    setMemoryEntry(key, email, USERNAME_CACHE_TTL_SECONDS);
    return;
  }
  await redis.set(key, email, { ex: USERNAME_CACHE_TTL_SECONDS });
}

export async function getUsernameEmailCache(username: string): Promise<string | null> {
  const key = `clerk:username:${username}`;
  const redis = getRedisClient();
  if (!redis) {
    const entry = getMemoryEntry<string>(key);
    return entry ? entry.value : null;
  }
  const value = await redis.get<string>(key);
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export async function saveDiscordOAuthState(
  state: string,
  value: DiscordOAuthState,
  ttlSeconds: number
): Promise<void> {
  const key = `clerk:oauth:discord:${state}`;
  const redis = getRedisClient();
  if (!redis) {
    setMemoryEntry(key, value, ttlSeconds);
    return;
  }
  await redis.set(key, JSON.stringify(value), { ex: ttlSeconds });
}

export async function consumeDiscordOAuthState(
  state: string
): Promise<DiscordOAuthState | null> {
  const key = `clerk:oauth:discord:${state}`;
  const redis = getRedisClient();
  if (!redis) {
    const entry = getMemoryEntry<DiscordOAuthState>(key);
    getMemoryStore().delete(key);
    return entry ? entry.value : null;
  }
  const raw = await redis.getdel(key);
  return parseStoredJson<DiscordOAuthState>(raw);
}
