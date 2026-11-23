import { User } from 'firebase/auth';
import {
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { generateId, sanitizeUsername, truncateStr } from '../lib/validation';
import {
  DiscordOAuthProfile,
  EMPTY_LINKED_DISCORD,
  LIMITS,
  LinkedDiscordAccount,
  PATTERNS,
  UsernameClaim,
  UserSession,
} from '../types/guildspace';

export interface PasswordStrength {
  score: 0 | 1 | 2 | 3 | 4;
  label: 'Too weak' | 'Weak' | 'Fair' | 'Good' | 'Strong';
  checks: {
    length: boolean;
    upper: boolean;
    lower: boolean;
    number: boolean;
    symbol: boolean;
  };
}

export class DiscordOAuthPopupError extends Error {
  needsConfig?: boolean;
  redirectUri?: string;

  constructor(message: string, options?: { needsConfig?: boolean; redirectUri?: string }) {
    super(message);
    this.name = 'DiscordOAuthPopupError';
    this.needsConfig = options?.needsConfig;
    this.redirectUri = options?.redirectUri;
  }
}

export async function getDiscordOAuthConfig(): Promise<{
  configured: boolean;
  redirectUri: string;
}> {
  const res = await fetch('/api/oauth/discord/config');
  if (!res.ok) {
    return { configured: false, redirectUri: `${window.location.origin}/auth/discord/callback` };
  }
  return res.json();
}

export async function openDiscordOAuthPopup(mode: 'login' | 'link'): Promise<{
  mode: 'login' | 'link';
  discordProfile: DiscordOAuthProfile;
  discordProof: string;
}> {
  const urlRes = await fetch(`/api/oauth/discord/url?mode=${encodeURIComponent(mode)}`);
  const urlData = (await urlRes.json().catch(() => ({}))) as {
    url?: string;
    redirectUri?: string;
    needsConfig?: boolean;
    error?: string;
  };

  if (!urlRes.ok || !urlData.url) {
    throw new DiscordOAuthPopupError(
      urlData.error || 'Discord OAuth2 is unavailable.',
      { needsConfig: urlData.needsConfig, redirectUri: urlData.redirectUri }
    );
  }

  const width = 520;
  const height = 720;
  const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
  const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2));

  const popup = window.open(
    urlData.url,
    'clerk_discord_oauth',
    `width=${width},height=${height},left=${left},top=${top},menubar=no,toolbar=no,status=no`
  );

  if (!popup) {
    throw new DiscordOAuthPopupError(
      'Popup blocked by your browser. Please allow popups for Clerk to authorize with Discord.'
    );
  }

  return new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      window.removeEventListener('message', onMessage);
      clearInterval(closeCheck);
      clearTimeout(timeoutId);
    };

    const onMessage = (event: MessageEvent) => {
      const originOk =
        event.origin === window.location.origin ||
        event.origin.endsWith('.run.app') ||
        event.origin.startsWith('http://localhost') ||
        event.origin.startsWith('http://127.0.0.1');
      if (!originOk) return;

      const data = event.data as {
        type?: string;
        mode?: 'login' | 'link';
        discordProfile?: DiscordOAuthProfile;
        discordProof?: string;
        error?: string;
      } | null;
      if (!data || typeof data !== 'object') return;

      if (data.type === 'DISCORD_OAUTH_SUCCESS' && data.discordProfile && data.discordProof) {
        settled = true;
        cleanup();
        resolve({
          mode: data.mode || mode,
          discordProfile: data.discordProfile,
          discordProof: data.discordProof,
        });
      } else if (data.type === 'DISCORD_OAUTH_ERROR') {
        settled = true;
        cleanup();
        reject(new DiscordOAuthPopupError(data.error || 'Discord authorization failed.'));
      }
    };

    const closeCheck = window.setInterval(() => {
      if (popup.closed && !settled) {
        settled = true;
        cleanup();
        reject(new DiscordOAuthPopupError('Discord authorization window was closed before completing.'));
      }
    }, 350);

    const timeoutId = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        try {
          popup.close();
        } catch {
          // Ignore cross-origin close error
        }
        reject(new DiscordOAuthPopupError('Discord authorization timed out. Please try again.'));
      }
    }, 180_000);

    window.addEventListener('message', onMessage);
  });
}

export function toLinkedDiscordRecord(discordProfile: DiscordOAuthProfile): LinkedDiscordAccount {
  return {
    id: truncateStr(discordProfile.id, 64),
    username: truncateStr(discordProfile.username, 64),
    globalName: truncateStr(discordProfile.globalName || discordProfile.username, 64),
    avatarUrl: truncateStr(discordProfile.avatarUrl || '', LIMITS.URL_MAX),
    linkedAt: new Date().toISOString().slice(0, 64),
  };
}

export async function linkDiscordToProfile(input: {
  uid: string;
  authUser?: User | null;
  discordProfile: DiscordOAuthProfile;
  importUsername: boolean;
  importAvatar: boolean;
  currentUsername: string;
  currentDisplayName: string;
  currentAvatarUrl: string;
  joinedGuildIds: string[];
}): Promise<void> {
  const path = `users/${input.uid}`;
  const linkedDiscord = toLinkedDiscordRecord(input.discordProfile);

  let nextUsername = input.currentUsername;
  let nextDisplayName = input.currentDisplayName;
  if (input.importUsername) {
    const candidateUsername = sanitizeUsername(input.discordProfile.username, input.uid.slice(0, 4).toLowerCase());
    if (candidateUsername !== input.currentUsername) {
      const avail = await checkUsernameAvailability(candidateUsername);
      if (avail.available) {
        nextUsername = avail.normalized;
      }
    }
    nextDisplayName = truncateStr(
      input.discordProfile.globalName || input.discordProfile.username,
      LIMITS.DISPLAY_NAME_MAX
    ) || input.currentDisplayName;
  }

  const nextAvatarUrl =
    input.importAvatar && input.discordProfile.avatarUrl
      ? truncateStr(input.discordProfile.avatarUrl, LIMITS.URL_MAX)
      : input.currentAvatarUrl;

  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'users', input.uid), {
      linkedDiscord,
      displayName: nextDisplayName,
      username: nextUsername,
      avatarUrl: nextAvatarUrl,
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'users', input.uid, 'private', 'account'), {
      linkedDiscordEmail: truncateStr(input.discordProfile.email || '', 160),
      updatedAt: serverTimestamp(),
    });

    for (const guildId of input.joinedGuildIds.slice(0, 15)) {
      batch.update(doc(db, 'guilds', guildId, 'members', input.uid), {
        displayName: nextDisplayName,
        username: nextUsername,
        avatarUrl: nextAvatarUrl,
        updatedAt: serverTimestamp(),
      });
    }

    await batch.commit();

    if (input.authUser && nextUsername !== input.currentUsername) {
      await registerUsernameClaim(input.authUser, nextUsername, input.currentUsername);
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function unlinkDiscordFromProfile(uid: string): Promise<void> {
  const path = `users/${uid}`;
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'users', uid), {
      linkedDiscord: EMPTY_LINKED_DISCORD,
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'users', uid, 'private', 'account'), {
      linkedDiscordEmail: '',
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export function evaluatePasswordStrength(password: string): PasswordStrength {
  const checks = {
    length: password.length >= 8,
    upper: /[A-Z]/.test(password),
    lower: /[a-z]/.test(password),
    number: /[0-9]/.test(password),
    symbol: /[^A-Za-z0-9]/.test(password),
  };

  if (password.length < 6) {
    return { score: 0, label: 'Too weak', checks };
  }

  let points = 0;
  if (checks.length) points += 1;
  if (checks.upper && checks.lower) points += 1;
  if (checks.number) points += 1;
  if (checks.symbol || password.length >= 12) points += 1;

  const score = Math.min(4, Math.max(1, points)) as 1 | 2 | 3 | 4;
  const labels: Record<1 | 2 | 3 | 4, PasswordStrength['label']> = {
    1: 'Weak',
    2: 'Fair',
    3: 'Good',
    4: 'Strong',
  };

  return { score, label: labels[score], checks };
}

export function validateDateOfBirth(
  dayStr: string,
  monthStr: string,
  yearStr: string
): { valid: boolean; iso: string; error?: string } {
  const day = Number(dayStr);
  const month = Number(monthStr);
  const year = Number(yearStr);

  if (!day || !month || !year) {
    return { valid: false, iso: '', error: 'Please select your complete date of birth.' };
  }

  const dob = new Date(year, month - 1, day);
  if (
    dob.getFullYear() !== year ||
    dob.getMonth() !== month - 1 ||
    dob.getDate() !== day
  ) {
    return { valid: false, iso: '', error: 'Please enter a valid calendar date.' };
  }

  const today = new Date();
  let age = today.getFullYear() - year;
  const monthDiff = today.getMonth() - (month - 1);
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < day)) {
    age -= 1;
  }

  if (age < 13) {
    return { valid: false, iso: '', error: 'You must be at least 13 years old to register.' };
  }
  if (age > 120) {
    return { valid: false, iso: '', error: 'Please enter a valid birth year.' };
  }

  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return { valid: true, iso: `${year}-${mm}-${dd}` };
}

export async function checkUsernameAvailability(
  rawUsername: string
): Promise<{ available: boolean; normalized: string; error?: string }> {
  const normalized = rawUsername.trim().toLowerCase();
  if (normalized.length < LIMITS.USERNAME_MIN) {
    return {
      available: false,
      normalized,
      error: `Username must be at least ${LIMITS.USERNAME_MIN} characters.`,
    };
  }
  if (normalized.length > LIMITS.USERNAME_MAX) {
    return {
      available: false,
      normalized,
      error: `Username must be ${LIMITS.USERNAME_MAX} characters or fewer.`,
    };
  }
  if (!PATTERNS.USERNAME.test(normalized)) {
    return {
      available: false,
      normalized,
      error: 'Use only lowercase letters, numbers, underscores, hyphens, or dots.',
    };
  }

  try {
    const snap = await getDoc(doc(db, 'usernames', normalized));
    if (snap.exists()) {
      return { available: false, normalized, error: 'This username is already taken.' };
    }
    return { available: true, normalized };
  } catch {
    return { available: true, normalized };
  }
}

export async function requestEmailOtp(
  email: string,
  purpose: 'signup' | '2fa'
): Promise<{
  challengeId: string;
  expiresAt: number;
  cooldownSeconds: number;
  delivery: 'email' | 'preview';
  previewCode?: string;
}> {
  const res = await fetch('/api/auth/otp/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email.trim().toLowerCase(), purpose }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || 'Could not send verification code.');
  }
  return data;
}

export async function verifyEmailOtp(
  challengeId: string,
  email: string,
  code: string
): Promise<{ verified: boolean; verificationProof: string }> {
  const res = await fetch('/api/auth/otp/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      challengeId,
      email: email.trim().toLowerCase(),
      code: code.trim(),
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || 'Verification failed.');
  }
  return data;
}

export async function checkLoginGuard(identifier: string): Promise<void> {
  const res = await fetch('/api/auth/login-guard', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: identifier.trim().toLowerCase() }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || 'Too many failed attempts. Please wait before trying again.');
  }
}

export async function reportLoginFailure(identifier: string): Promise<{
  attemptsRemaining: number;
  locked: boolean;
  retryAfterSeconds: number;
}> {
  const res = await fetch('/api/auth/login-failure', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: identifier.trim().toLowerCase() }),
  });
  return res.json();
}

export async function reportLoginSuccess(
  identifier: string,
  email: string,
  username = ''
): Promise<void> {
  await fetch('/api/auth/login-success', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, email, username }),
  }).catch(() => {});
}

export async function resolveLoginEmail(identifier: string): Promise<string> {
  const trimmed = identifier.trim().toLowerCase();
  if (!trimmed) throw new Error('Enter your email address or username.');
  if (trimmed.includes('@')) return trimmed;

  const cleanUsername = sanitizeUsername(trimmed);
  let encryptedHint = '';
  try {
    const snap = await getDoc(doc(db, 'usernames', cleanUsername));
    if (snap.exists()) {
      encryptedHint = (snap.data() as UsernameClaim).encryptedHint || '';
    }
  } catch {
    // Continue to server cache lookup
  }

  const res = await fetch('/api/auth/resolve-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: cleanUsername, encryptedHint }),
  });
  const data = await res.json();
  if (!res.ok || !data?.email) {
    throw new Error(data?.error || 'No account found with that username.');
  }
  return data.email;
}

export async function registerUsernameClaim(
  user: User,
  username: string,
  previousUsername?: string
): Promise<void> {
  const normalized = sanitizeUsername(username, user.uid.slice(0, 4).toLowerCase());
  let encryptedHint = '';

  try {
    const idToken = await user.getIdToken();
    const res = await fetch('/api/auth/encrypt-hint', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ username: normalized }),
    });
    if (res.ok) {
      const data = await res.json();
      encryptedHint = (data?.encryptedHint || '').slice(0, 500);
    }
  } catch {
    // Non-fatal; encrypted hint is optional optimization for username login
  }

  try {
    const batch = writeBatch(db);
    if (previousUsername && previousUsername !== normalized) {
      batch.delete(doc(db, 'usernames', previousUsername));
    }
    batch.set(doc(db, 'usernames', normalized), {
      username: normalized,
      uid: user.uid,
      encryptedHint,
      createdAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `usernames/${normalized}`);
  }
}

export function parseDeviceLabel(): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  let browser = 'Browser';
  if (ua.includes('Edg/')) browser = 'Edge';
  else if (ua.includes('Chrome/')) browser = 'Chrome';
  else if (ua.includes('Firefox/')) browser = 'Firefox';
  else if (ua.includes('Safari/')) browser = 'Safari';

  let os = 'Web';
  if (ua.includes('Mac OS X')) os = 'macOS';
  else if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('Android')) os = 'Android';
  else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';
  else if (ua.includes('Linux')) os = 'Linux';

  return `${browser} on ${os}`.slice(0, 120);
}

export async function createSessionRecord(uid: string, rememberMe: boolean): Promise<string> {
  const sessionId = generateId('ses');
  const path = `users/${uid}/sessions/${sessionId}`;
  try {
    await setDoc(doc(db, 'users', uid, 'sessions', sessionId), {
      id: sessionId,
      uid,
      deviceLabel: parseDeviceLabel(),
      rememberMe,
      revoked: false,
      createdAt: serverTimestamp(),
      lastActiveAt: serverTimestamp(),
    });
    return sessionId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function revokeUserSession(uid: string, sessionId: string): Promise<void> {
  const path = `users/${uid}/sessions/${sessionId}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'sessions', sessionId), {
      revoked: true,
      lastActiveAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function revokeOtherUserSessions(
  uid: string,
  currentSessionId: string,
  sessions: UserSession[]
): Promise<void> {
  const others = sessions.filter((s) => s.id !== currentSessionId && !s.revoked);
  if (others.length === 0) return;
  try {
    const batch = writeBatch(db);
    for (const s of others.slice(0, 40)) {
      batch.update(doc(db, 'users', uid, 'sessions', s.id), {
        revoked: true,
        lastActiveAt: serverTimestamp(),
      });
    }
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `users/${uid}/sessions`);
  }
}

export async function deleteUserSessionRecord(uid: string, sessionId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'users', uid, 'sessions', sessionId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `users/${uid}/sessions/${sessionId}`);
  }
}
