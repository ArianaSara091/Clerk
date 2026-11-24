import crypto from 'node:crypto';
import {
  constantTimeHexEqual,
  decryptLoginHint,
  encryptLoginHint,
  hashCode,
  isAuthSecretConfigured,
  signProof,
} from './crypto.ts';
import { readEnv } from './env.ts';
import { getFirebaseAdminAuth, isFirebaseAdminConfigured } from './firebaseAdmin.ts';
import { isSmtpConfigured, sendVerificationEmail } from './mailer.ts';
import {
  checkLoginLockout,
  checkRateLimit,
  clearLoginFailures,
  consumeDiscordOAuthState,
  deleteOtpChallenge,
  getOtpChallenge,
  getOtpResendCooldown,
  getUsernameEmailCache,
  pingStateStore,
  recordLoginFailure,
  saveDiscordOAuthState,
  saveOtpChallenge,
  setOtpResendCooldown,
  setUsernameEmailCache,
  updateOtpChallengeAttempts,
} from './stateStore.ts';
import {
  BackendConfigError,
  type BackendRequest,
  type BackendResponse,
  type OtpChallenge,
} from './types.ts';

const OTP_TTL_SECONDS = 10 * 60;
const OAUTH_STATE_TTL_SECONDS = 10 * 60;
const RESEND_COOLDOWN_SECONDS = 30;
const LOCKOUT_SECONDS = 15 * 60;
const MAX_OTP_ATTEMPTS = 5;
const MAX_LOGIN_FAILURES = 5;

function json(status: number, body: unknown): BackendResponse {
  return { status, contentType: 'json', body };
}

function html(status: number, body: string): BackendResponse {
  return { status, contentType: 'html', body };
}

function getHeader(req: BackendRequest, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(req.headers)) {
    if (k.toLowerCase() === lower && v) return v;
  }
  return undefined;
}

export function getDiscordRedirectUri(req: BackendRequest): string {
  const isNetlify = process.env.NETLIFY === 'true';

  if (!isNetlify) {
    const envAppUrl = readEnv('APP_URL');
    if (envAppUrl && envAppUrl !== 'MY_APP_URL') {
      const normalized = /^https?:\/\//i.test(envAppUrl) ? envAppUrl : `https://${envAppUrl}`;
      return `${normalized.replace(/\/+$/, '')}/auth/discord/callback`;
    }
  }

  const rawHost = getHeader(req, 'x-forwarded-host') || getHeader(req, 'host') || req.host || '';
  const host = rawHost.split(',')[0].trim();
  if (host) {
    const forwardedProto = getHeader(req, 'x-forwarded-proto');
    let proto = forwardedProto ? forwardedProto.split(',')[0].trim() : req.protocol || 'https';
    if (isNetlify && !host.startsWith('localhost') && !host.startsWith('127.0.0.1')) {
      proto = 'https';
    }
    return `${proto}://${host}/auth/discord/callback`;
  }

  const netlifyUrl = readEnv('DEPLOY_PRIME_URL') || readEnv('URL');
  if (netlifyUrl) {
    return `${netlifyUrl.replace(/\/+$/, '')}/auth/discord/callback`;
  }

  return 'http://localhost:3000/auth/discord/callback';
}

function safeOriginFromUrl(urlStr: string): string {
  try {
    return new URL(urlStr).origin;
  } catch {
    return 'https://localhost';
  }
}

function resolveAllowedOrigin(candidate: string | undefined, fallbackOrigin: string): string {
  if (!candidate) return fallbackOrigin;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return fallbackOrigin;
    }
    const hostname = parsed.hostname.toLowerCase();
    if (
      parsed.origin === fallbackOrigin ||
      hostname.endsWith('.netlify.app') ||
      hostname.endsWith('.run.app') ||
      hostname === 'localhost' ||
      hostname === '127.0.0.1'
    ) {
      return parsed.origin;
    }
  } catch {
    // Ignore malformed candidate origin
  }
  return fallbackOrigin;
}

function escapeHtmlJson(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

function buildOAuthCallbackHtml(
  payload: Record<string, unknown>,
  messageText: string,
  targetOrigin: string
): string {
  const safeJson = escapeHtmlJson(payload);
  const safeOriginJson = escapeHtmlJson(targetOrigin);
  const safeMsg = messageText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Clerk — Discord Authorization</title>
    <style>
      body {
        margin: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #0a0c12;
        color: #f8fafc;
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 100vh;
        text-align: center;
        padding: 24px;
      }
      .card {
        background: #131622;
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 16px;
        padding: 24px 28px;
        max-width: 380px;
      }
      p { color: #94a3b8; font-size: 14px; margin: 8px 0 0; }
    </style>
  </head>
  <body>
    <div class="card">
      <strong>Clerk</strong>
      <p>${safeMsg}</p>
    </div>
    <script>
      (function () {
        var payload = ${safeJson};
        var targetOrigin = ${safeOriginJson};
        try {
          if (window.opener && !window.opener.closed) {
            window.opener.postMessage(payload, targetOrigin || window.location.origin);
          }
        } catch (err) {}
        setTimeout(function () {
          window.close();
        }, 120);
      })();
    </script>
  </body>
</html>`;
}

export async function runWithConfigGuard(
  handler: () => Promise<BackendResponse>
): Promise<BackendResponse> {
  try {
    return await handler();
  } catch (err) {
    if (err instanceof BackendConfigError) {
      return json(err.status, { error: err.message });
    }
    console.error('Backend handler error:', err instanceof Error ? err.message : 'Unknown error');
    return json(500, {
      error:
        'Authentication service could not reach persistent state storage. Check server environment configuration.',
    });
  }
}

export async function handleHealth(): Promise<BackendResponse> {
  const redis = await pingStateStore();
  const firebaseConfigured = isFirebaseAdminConfigured();
  const smtpConfigured = isSmtpConfigured();
  const discordOAuthConfigured = Boolean(
    readEnv('DISCORD_CLIENT_ID') && readEnv('DISCORD_CLIENT_SECRET')
  );
  const authSecretConfigured = isAuthSecretConfigured();

  const healthy =
    firebaseConfigured &&
    redis.connected &&
    (process.env.NETLIFY !== 'true' || authSecretConfigured);

  return json(200, {
    ok: healthy,
    status: healthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    runtime: process.env.NETLIFY === 'true' ? 'netlify-functions' : 'express',
    checks: {
      firebaseConfig: firebaseConfigured,
      redisConfigured: redis.configured,
      redisConnected: redis.connected,
      redisBackend: redis.backend,
      smtpConfigured,
      discordOAuthConfigured,
      authSecretConfigured,
    },
  });
}

export async function handleDiscordConfig(req: BackendRequest): Promise<BackendResponse> {
  const clientId = readEnv('DISCORD_CLIENT_ID');
  const clientSecret = readEnv('DISCORD_CLIENT_SECRET');
  return json(200, {
    configured: Boolean(clientId && clientSecret),
    redirectUri: getDiscordRedirectUri(req),
  });
}

export async function handleDiscordUrl(req: BackendRequest): Promise<BackendResponse> {
  return runWithConfigGuard(async () => {
    const clientId = readEnv('DISCORD_CLIENT_ID');
    const clientSecret = readEnv('DISCORD_CLIENT_SECRET');
    const redirectUri = getDiscordRedirectUri(req);

    if (!clientId || !clientSecret) {
      return json(503, {
        needsConfig: true,
        redirectUri,
        error:
          'Discord OAuth2 credentials (DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET) are not configured in server environment secrets.',
      });
    }

    const mode = req.query.mode === 'link' ? 'link' : 'login';
    const fallbackOrigin = safeOriginFromUrl(redirectUri);
    const requestOrigin = resolveAllowedOrigin(
      getHeader(req, 'origin') || getHeader(req, 'referer'),
      fallbackOrigin
    );

    const state = crypto.randomBytes(24).toString('hex');
    await saveDiscordOAuthState(
      state,
      { mode, origin: requestOrigin, createdAt: Date.now() },
      OAUTH_STATE_TTL_SECONDS
    );

    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: 'identify email',
      state,
      prompt: 'consent',
    });

    return json(200, {
      url: `https://discord.com/oauth2/authorize?${params.toString()}`,
      redirectUri,
    });
  });
}

export async function handleDiscordCallback(req: BackendRequest): Promise<BackendResponse> {
  const redirectUri = getDiscordRedirectUri(req);
  const callbackOrigin = safeOriginFromUrl(redirectUri);

  const oauthError = typeof req.query.error === 'string' ? req.query.error : '';
  const oauthErrorDesc =
    typeof req.query.error_description === 'string' ? req.query.error_description : '';
  if (oauthError) {
    return html(
      200,
      buildOAuthCallbackHtml(
        {
          type: 'DISCORD_OAUTH_ERROR',
          error: oauthErrorDesc || `Discord authorization canceled (${oauthError}).`,
        },
        'Discord authorization was canceled. Returning to Clerk...',
        callbackOrigin
      )
    );
  }

  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const state = typeof req.query.state === 'string' ? req.query.state : '';

  let storedState;
  try {
    storedState = state ? await consumeDiscordOAuthState(state) : null;
  } catch (err) {
    const msg =
      err instanceof BackendConfigError
        ? err.message
        : 'Could not verify Discord authorization state.';
    return html(
      503,
      buildOAuthCallbackHtml(
        { type: 'DISCORD_OAUTH_ERROR', error: msg },
        'Server configuration incomplete. Closing window...',
        callbackOrigin
      )
    );
  }

  const targetOrigin = resolveAllowedOrigin(storedState?.origin, callbackOrigin);

  if (
    !code ||
    !storedState ||
    Date.now() - storedState.createdAt > OAUTH_STATE_TTL_SECONDS * 1000
  ) {
    return html(
      400,
      buildOAuthCallbackHtml(
        {
          type: 'DISCORD_OAUTH_ERROR',
          error: 'Discord authorization state expired or invalid. Please try again.',
        },
        'Authorization session expired. Closing window...',
        targetOrigin
      )
    );
  }

  const clientId = readEnv('DISCORD_CLIENT_ID');
  const clientSecret = readEnv('DISCORD_CLIENT_SECRET');
  if (!clientId || !clientSecret) {
    return html(
      503,
      buildOAuthCallbackHtml(
        {
          type: 'DISCORD_OAUTH_ERROR',
          error: 'Discord OAuth2 credentials are not configured on the server.',
        },
        'Discord OAuth2 is not configured. Closing window...',
        targetOrigin
      )
    );
  }

  try {
    const tokenBody = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    });

    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: tokenBody.toString(),
    });

    const tokenData = (await tokenRes.json().catch(() => ({}))) as {
      access_token?: string;
      error_description?: string;
    };
    if (!tokenRes.ok || !tokenData.access_token) {
      throw new Error(
        tokenData.error_description || 'Could not exchange Discord authorization code.'
      );
    }

    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
      },
    });
    if (!userRes.ok) {
      throw new Error('Could not retrieve authorized Discord account profile.');
    }

    const discordUser = (await userRes.json()) as {
      id: string;
      username: string;
      global_name?: string | null;
      avatar?: string | null;
      discriminator?: string;
      email?: string | null;
      verified?: boolean;
    };

    let avatarUrl = '';
    if (discordUser.avatar) {
      const ext = discordUser.avatar.startsWith('a_') ? 'gif' : 'png';
      avatarUrl = `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.${ext}?size=256`;
    } else {
      const defaultIndex = Number((BigInt(discordUser.id) >> 22n) % 6n);
      avatarUrl = `https://cdn.discordapp.com/embed/avatars/${defaultIndex}.png`;
    }

    const discordProfile = {
      id: String(discordUser.id).slice(0, 64),
      username: String(discordUser.username || 'discord_user').slice(0, 64),
      globalName: String(
        discordUser.global_name || discordUser.username || 'Discord User'
      ).slice(0, 64),
      avatarUrl: avatarUrl.slice(0, 500),
      email:
        typeof discordUser.email === 'string'
          ? discordUser.email.trim().toLowerCase().slice(0, 160)
          : '',
      verified: Boolean(discordUser.verified),
    };

    const discordProof = signProof({
      discordId: discordProfile.id,
      username: discordProfile.username,
      issuedAt: Date.now(),
    });

    return html(
      200,
      buildOAuthCallbackHtml(
        {
          type: 'DISCORD_OAUTH_SUCCESS',
          mode: storedState.mode,
          discordProfile,
          discordProof,
        },
        'Discord authorization succeeded. Returning to Clerk...',
        targetOrigin
      )
    );
  } catch (err) {
    return html(
      200,
      buildOAuthCallbackHtml(
        {
          type: 'DISCORD_OAUTH_ERROR',
          error: err instanceof Error ? err.message : 'Discord authorization failed.',
        },
        'Could not complete Discord authorization. Closing window...',
        targetOrigin
      )
    );
  }
}

export async function handleOtpSend(req: BackendRequest): Promise<BackendResponse> {
  return runWithConfigGuard(async () => {
    const rawEmail = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const purpose = req.body?.purpose === '2fa' ? '2fa' : 'signup';

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail) || rawEmail.length > 160) {
      return json(400, { error: 'Please provide a valid email address.' });
    }

    const ipCheck = await checkRateLimit(
      `otp_send_ip:${req.clientIp}`,
      15,
      15 * 60,
      LOCKOUT_SECONDS
    );
    if (!ipCheck.allowed) {
      return json(429, {
        error: `Too many verification requests. Try again in ${ipCheck.retryAfterSeconds}s.`,
        retryAfterSeconds: ipCheck.retryAfterSeconds,
      });
    }

    const cooldownRemaining = await getOtpResendCooldown(purpose, rawEmail);
    if (cooldownRemaining > 0) {
      return json(429, {
        error: `Please wait ${cooldownRemaining}s before requesting another verification code.`,
        retryAfterSeconds: cooldownRemaining,
      });
    }

    const emailCheck = await checkRateLimit(
      `otp_send:${purpose}:${rawEmail}`,
      5,
      15 * 60,
      LOCKOUT_SECONDS
    );
    if (!emailCheck.allowed) {
      return json(429, {
        error: `Verification send limit reached. Try again in ${Math.ceil(emailCheck.retryAfterSeconds / 60)} minutes.`,
        retryAfterSeconds: emailCheck.retryAfterSeconds,
      });
    }

    const now = Date.now();
    const code = crypto.randomInt(100000, 1000000).toString();
    const salt = crypto.randomBytes(16).toString('hex');
    const challengeId = crypto.randomUUID();
    const challenge: OtpChallenge = {
      challengeId,
      email: rawEmail,
      purpose,
      salt,
      codeHash: hashCode(salt, code),
      attempts: 0,
      maxAttempts: MAX_OTP_ATTEMPTS,
      expiresAt: now + OTP_TTL_SECONDS * 1000,
      createdAt: now,
    };

    await saveOtpChallenge(challenge, OTP_TTL_SECONDS);
    await setOtpResendCooldown(purpose, rawEmail, RESEND_COOLDOWN_SECONDS);

    try {
      const sentViaSmtp = await sendVerificationEmail(rawEmail, code, purpose);
      if (sentViaSmtp) {
        return json(200, {
          challengeId,
          expiresAt: challenge.expiresAt,
          cooldownSeconds: RESEND_COOLDOWN_SECONDS,
          delivery: 'email',
        });
      }
      return json(200, {
        challengeId,
        expiresAt: challenge.expiresAt,
        cooldownSeconds: RESEND_COOLDOWN_SECONDS,
        delivery: 'preview',
        previewCode: code,
      });
    } catch (err) {
      console.error('SMTP email delivery failed:', err instanceof Error ? err.message : 'Unknown error');
      return json(500, {
        error: 'Unable to deliver verification email. Check SMTP configuration.',
      });
    }
  });
}

export async function handleOtpVerify(req: BackendRequest): Promise<BackendResponse> {
  return runWithConfigGuard(async () => {
    const challengeId =
      typeof req.body?.challengeId === 'string' ? req.body.challengeId.trim() : '';
    const rawEmail = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';

    if (!challengeId || !/^\d{6}$/.test(code)) {
      return json(400, { error: 'Enter a valid 6-digit verification code.' });
    }

    const verifyIpCheck = await checkRateLimit(
      `otp_verify_ip:${req.clientIp}`,
      25,
      15 * 60,
      LOCKOUT_SECONDS
    );
    if (!verifyIpCheck.allowed) {
      return json(429, {
        error: `Too many verification attempts. Try again in ${Math.ceil(verifyIpCheck.retryAfterSeconds / 60)} minutes.`,
        retryAfterSeconds: verifyIpCheck.retryAfterSeconds,
      });
    }

    const challenge = await getOtpChallenge(challengeId);
    if (!challenge || challenge.email !== rawEmail) {
      return json(400, { error: 'Verification challenge not found. Request a new code.' });
    }

    if (Date.now() > challenge.expiresAt) {
      await deleteOtpChallenge(challengeId);
      return json(400, { error: 'This verification code has expired. Please resend a new code.' });
    }

    if (challenge.attempts >= challenge.maxAttempts) {
      return json(429, {
        error: 'Too many incorrect attempts. Request a new verification code.',
        locked: true,
      });
    }

    const candidateHash = hashCode(challenge.salt, code);
    if (!constantTimeHexEqual(candidateHash, challenge.codeHash)) {
      challenge.attempts += 1;
      const remaining = Math.max(0, challenge.maxAttempts - challenge.attempts);
      if (remaining === 0) {
        await deleteOtpChallenge(challengeId);
        return json(429, {
          error: 'Maximum verification attempts exceeded. Please request a fresh code.',
          attemptsRemaining: 0,
          locked: true,
        });
      }
      await updateOtpChallengeAttempts(challenge);
      return json(400, {
        error: `Incorrect verification code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`,
        attemptsRemaining: remaining,
      });
    }

    await deleteOtpChallenge(challengeId);
    const verificationProof = signProof({
      email: rawEmail,
      purpose: challenge.purpose,
      issuedAt: Date.now(),
    });

    return json(200, {
      verified: true,
      verificationProof,
    });
  });
}

export async function handleLoginGuard(req: BackendRequest): Promise<BackendResponse> {
  return runWithConfigGuard(async () => {
    const identifier =
      typeof req.body?.identifier === 'string' ? req.body.identifier.trim().toLowerCase() : '';
    const check = await checkLoginLockout([`login_id:${identifier}`, `login_ip:${req.clientIp}`]);
    if (!check.allowed) {
      return json(429, {
        allowed: false,
        retryAfterSeconds: check.retryAfterSeconds,
        error: `Too many failed sign-in attempts. Please try again in ${Math.ceil(check.retryAfterSeconds / 60)} minute(s).`,
      });
    }
    return json(200, { allowed: true });
  });
}

export async function handleLoginFailure(req: BackendRequest): Promise<BackendResponse> {
  return runWithConfigGuard(async () => {
    const identifier =
      typeof req.body?.identifier === 'string' ? req.body.identifier.trim().toLowerCase() : '';
    const idResult = await recordLoginFailure(
      `login_id:${identifier}`,
      MAX_LOGIN_FAILURES,
      LOCKOUT_SECONDS
    );
    await recordLoginFailure(`login_ip:${req.clientIp}`, MAX_LOGIN_FAILURES * 3, LOCKOUT_SECONDS);

    const attemptsRemaining = Math.max(0, MAX_LOGIN_FAILURES - idResult.count);
    return json(200, {
      attemptsRemaining,
      locked: idResult.locked,
      retryAfterSeconds: idResult.retryAfterSeconds,
    });
  });
}

export async function handleLoginSuccess(req: BackendRequest): Promise<BackendResponse> {
  return runWithConfigGuard(async () => {
    const identifier =
      typeof req.body?.identifier === 'string' ? req.body.identifier.trim().toLowerCase() : '';
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const username =
      typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : '';

    const keysToClear: string[] = [];
    if (identifier) keysToClear.push(`login_id:${identifier}`);
    if (email) keysToClear.push(`login_id:${email}`);
    await clearLoginFailures(keysToClear);

    if (username && email) {
      await setUsernameEmailCache(username, email);
    }

    return json(200, { ok: true });
  });
}

export async function handleEncryptHint(req: BackendRequest): Promise<BackendResponse> {
  return runWithConfigGuard(async () => {
    const authHeader = getHeader(req, 'authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!token) {
      return json(401, { error: 'Missing authorization token.' });
    }

    try {
      const adminAuth = getFirebaseAdminAuth();
      const decoded = await adminAuth.verifyIdToken(token);
      const email = (decoded.email || '').trim().toLowerCase();
      const username =
        typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : '';
      if (!email || !/^[a-z0-9_.-]{3,32}$/.test(username)) {
        return json(400, { error: 'Invalid username or account email.' });
      }
      await setUsernameEmailCache(username, email);
      const encryptedHint = encryptLoginHint(email);
      return json(200, { encryptedHint });
    } catch (err) {
      if (err instanceof BackendConfigError) throw err;
      return json(401, { error: 'Invalid Firebase authentication token.' });
    }
  });
}

export async function handleResolveLogin(req: BackendRequest): Promise<BackendResponse> {
  return runWithConfigGuard(async () => {
    const rate = await checkRateLimit(`resolve_ip:${req.clientIp}`, 30, 10 * 60, LOCKOUT_SECONDS);
    if (!rate.allowed) {
      return json(429, {
        error: `Too many login lookup requests. Try again in ${rate.retryAfterSeconds}s.`,
      });
    }

    const username =
      typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : '';
    const encryptedHint =
      typeof req.body?.encryptedHint === 'string' ? req.body.encryptedHint.trim() : '';

    if (!username) {
      return json(400, { error: 'Missing username.' });
    }

    const cached = await getUsernameEmailCache(username);
    if (cached) {
      return json(200, { email: cached });
    }

    if (encryptedHint) {
      const decrypted = decryptLoginHint(encryptedHint);
      if (decrypted) {
        await setUsernameEmailCache(username, decrypted);
        return json(200, { email: decrypted });
      }
    }

    return json(404, {
      error: 'Please sign in using your email address for this session.',
    });
  });
}
