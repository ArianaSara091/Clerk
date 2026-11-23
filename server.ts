import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { getApps, initializeApp as initializeAdminApp } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import nodemailer from 'nodemailer';

const firebaseConfigPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
const firebaseConfig = JSON.parse(fs.readFileSync(firebaseConfigPath, 'utf-8')) as {
  projectId: string;
};

const adminApp = getApps().length
  ? getApps()[0]
  : initializeAdminApp({ projectId: firebaseConfig.projectId });
const adminAuth = getAdminAuth(adminApp);

const SERVER_SECRET =
  process.env.GUILD_AUTH_SECRET || crypto.randomBytes(32).toString('hex');
const CIPHER_KEY = crypto.createHash('sha256').update(SERVER_SECRET).digest();

interface OtpChallenge {
  challengeId: string;
  email: string;
  purpose: 'signup' | '2fa';
  salt: string;
  codeHash: string;
  attempts: number;
  maxAttempts: number;
  expiresAt: number;
  createdAt: number;
}

interface RateBucket {
  count: number;
  resetAt: number;
  lockedUntil: number;
}

interface DiscordOAuthState {
  mode: 'login' | 'link';
  createdAt: number;
}

const otpChallenges = new Map<string, OtpChallenge>();
const sendLimits = new Map<string, RateBucket>();
const ipRateLimits = new Map<string, RateBucket>();
const loginFailures = new Map<string, RateBucket>();
const usernameEmailCache = new Map<string, string>();
const discordOAuthStates = new Map<string, DiscordOAuthState>();

const OTP_TTL_MS = 10 * 60 * 1000;
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 30 * 1000;
const LOCKOUT_MS = 15 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
const MAX_LOGIN_FAILURES = 5;

function getClientIp(req: express.Request): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) {
    return fwd.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

function getDiscordRedirectUri(req: express.Request): string {
  const envAppUrl = process.env.APP_URL?.trim();
  if (envAppUrl && envAppUrl !== 'MY_APP_URL') {
    return `${envAppUrl.replace(/\/+$/, '')}/auth/discord/callback`;
  }
  const protoHeader = req.headers['x-forwarded-proto'];
  const proto =
    typeof protoHeader === 'string'
      ? protoHeader.split(',')[0].trim()
      : req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.get('host') || 'localhost:3000';
  return `${proto}://${host}/auth/discord/callback`;
}

function escapeHtmlJson(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

function buildOAuthCallbackHtml(payload: Record<string, unknown>, messageText: string): string {
  const safeJson = escapeHtmlJson(payload);
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
        try {
          if (window.opener && !window.opener.closed) {
            window.opener.postMessage(payload, '*');
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

function hashCode(salt: string, code: string): string {
  return crypto
    .createHmac('sha256', SERVER_SECRET)
    .update(`${salt}:${code}`)
    .digest('hex');
}

function constantTimeHexEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function encryptLoginHint(email: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', CIPHER_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(email.toLowerCase(), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}.${tag.toString('hex')}.${encrypted.toString('hex')}`;
}

function decryptLoginHint(payload: string): string | null {
  try {
    const parts = payload.split('.');
    if (parts.length !== 3) return null;
    const iv = Buffer.from(parts[0], 'hex');
    const tag = Buffer.from(parts[1], 'hex');
    const ciphertext = Buffer.from(parts[2], 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', CIPHER_KEY, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}

function checkRateLimit(
  store: Map<string, RateBucket>,
  key: string,
  maxCount: number,
  windowMs: number
): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const existing = store.get(key);
  if (existing && existing.lockedUntil > now) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((existing.lockedUntil - now) / 1000),
    };
  }
  if (!existing || existing.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs, lockedUntil: 0 });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (existing.count >= maxCount) {
    existing.lockedUntil = now + LOCKOUT_MS;
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil(LOCKOUT_MS / 1000),
    };
  }
  existing.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

async function sendVerificationEmail(email: string, code: string, purpose: 'signup' | '2fa'): Promise<boolean> {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  if (!host || !user || !pass) {
    return false;
  }

  const port = Number(process.env.SMTP_PORT || '587');
  const from = process.env.SMTP_FROM?.trim() || user;
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  const subject =
    purpose === 'signup'
      ? 'Clerk — Your 6-digit account verification code'
      : 'Clerk — Your two-factor security code';

  await transporter.sendMail({
    from,
    to: email,
    subject,
    text: `Your Clerk verification code is: ${code}\n\nThis code expires in 10 minutes. If you did not request this, you can safely ignore this email.`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0b0d14; color: #f8fafc; padding: 32px; border-radius: 12px;">
        <h2 style="margin: 0 0 12px; color: #ffffff;">Clerk Security Verification</h2>
        <p style="margin: 0 0 20px; color: #94a3b8; font-size: 14px;">
          Enter this 6-digit verification code to ${purpose === 'signup' ? 'activate your Clerk account' : 'complete your two-factor sign-in'}:
        </p>
        <div style="font-family: monospace; font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #a78bfa; background: #131622; padding: 16px 24px; border-radius: 10px; display: inline-block;">
          ${code}
        </div>
        <p style="margin: 20px 0 0; color: #64748b; font-size: 12px;">
          Expires in 10 minutes. Never share this code with anyone.
        </p>
      </div>
    `,
  });

  return true;
}

async function startServer() {
  const app = express();
  const httpServer = http.createServer(app);
  app.set('trust proxy', true);
  app.use(express.json({ limit: '64kb' }));

  // Periodically purge expired challenges and OAuth states
  setInterval(() => {
    const now = Date.now();
    for (const [id, ch] of otpChallenges.entries()) {
      if (ch.expiresAt < now) otpChallenges.delete(id);
    }
    for (const [stateKey, st] of discordOAuthStates.entries()) {
      if (now - st.createdAt > OAUTH_STATE_TTL_MS) discordOAuthStates.delete(stateKey);
    }
  }, 60_000).unref();

  // 0. Discord OAuth2 Configuration & Authorization URL
  app.get('/api/oauth/discord/config', (req, res) => {
    const clientId = process.env.DISCORD_CLIENT_ID?.trim();
    const clientSecret = process.env.DISCORD_CLIENT_SECRET?.trim();
    res.json({
      configured: Boolean(clientId && clientSecret),
      redirectUri: getDiscordRedirectUri(req),
    });
  });

  app.get('/api/oauth/discord/url', (req, res) => {
    const clientId = process.env.DISCORD_CLIENT_ID?.trim();
    const clientSecret = process.env.DISCORD_CLIENT_SECRET?.trim();
    const redirectUri = getDiscordRedirectUri(req);

    if (!clientId || !clientSecret) {
      res.status(503).json({
        needsConfig: true,
        redirectUri,
        error:
          'Discord OAuth2 credentials (DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET) are not configured in server environment secrets.',
      });
      return;
    }

    const mode = req.query.mode === 'link' ? 'link' : 'login';
    const state = crypto.randomBytes(24).toString('hex');
    discordOAuthStates.set(state, { mode, createdAt: Date.now() });

    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: 'identify email',
      state,
      prompt: 'consent',
    });

    res.json({
      url: `https://discord.com/oauth2/authorize?${params.toString()}`,
      redirectUri,
    });
  });

  app.get(['/auth/discord/callback', '/auth/discord/callback/'], async (req, res) => {
    const oauthError = typeof req.query.error === 'string' ? req.query.error : '';
    const oauthErrorDesc =
      typeof req.query.error_description === 'string' ? req.query.error_description : '';
    if (oauthError) {
      res
        .status(200)
        .type('html')
        .send(
          buildOAuthCallbackHtml(
            {
              type: 'DISCORD_OAUTH_ERROR',
              error: oauthErrorDesc || `Discord authorization canceled (${oauthError}).`,
            },
            'Discord authorization was canceled. Returning to Clerk...'
          )
        );
      return;
    }

    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const storedState = state ? discordOAuthStates.get(state) : undefined;
    if (state) discordOAuthStates.delete(state);

    if (!code || !storedState || Date.now() - storedState.createdAt > OAUTH_STATE_TTL_MS) {
      res
        .status(400)
        .type('html')
        .send(
          buildOAuthCallbackHtml(
            {
              type: 'DISCORD_OAUTH_ERROR',
              error: 'Discord authorization state expired or invalid. Please try again.',
            },
            'Authorization session expired. Closing window...'
          )
        );
      return;
    }

    const clientId = process.env.DISCORD_CLIENT_ID?.trim();
    const clientSecret = process.env.DISCORD_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) {
      res
        .status(503)
        .type('html')
        .send(
          buildOAuthCallbackHtml(
            {
              type: 'DISCORD_OAUTH_ERROR',
              error: 'Discord OAuth2 credentials are not configured on the server.',
            },
            'Discord OAuth2 is not configured. Closing window...'
          )
        );
      return;
    }

    try {
      const redirectUri = getDiscordRedirectUri(req);
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
        throw new Error(tokenData.error_description || 'Could not exchange Discord authorization code.');
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
        globalName: String(discordUser.global_name || discordUser.username || 'Discord User').slice(0, 64),
        avatarUrl: avatarUrl.slice(0, 500),
        email: typeof discordUser.email === 'string' ? discordUser.email.trim().toLowerCase().slice(0, 160) : '',
        verified: Boolean(discordUser.verified),
      };

      const proofPayload = Buffer.from(
        JSON.stringify({
          discordId: discordProfile.id,
          username: discordProfile.username,
          issuedAt: Date.now(),
        })
      ).toString('base64url');
      const proofSig = crypto
        .createHmac('sha256', SERVER_SECRET)
        .update(proofPayload)
        .digest('base64url');

      res
        .status(200)
        .type('html')
        .send(
          buildOAuthCallbackHtml(
            {
              type: 'DISCORD_OAUTH_SUCCESS',
              mode: storedState.mode,
              discordProfile,
              discordProof: `${proofPayload}.${proofSig}`,
            },
            'Discord authorization succeeded. Returning to Clerk...'
          )
        );
    } catch (err) {
      res
        .status(200)
        .type('html')
        .send(
          buildOAuthCallbackHtml(
            {
              type: 'DISCORD_OAUTH_ERROR',
              error: err instanceof Error ? err.message : 'Discord authorization failed.',
            },
            'Could not complete Discord authorization. Closing window...'
          )
        );
    }
  });

  // 1. Send 6-Digit Email Verification / 2FA Code
  app.post('/api/auth/otp/send', async (req, res) => {
    const rawEmail = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const purpose = req.body?.purpose === '2fa' ? '2fa' : 'signup';

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail) || rawEmail.length > 160) {
      res.status(400).json({ error: 'Please provide a valid email address.' });
      return;
    }

    const ip = getClientIp(req);
    const ipCheck = checkRateLimit(ipRateLimits, `otp_send_ip:${ip}`, 15, 15 * 60 * 1000);
    if (!ipCheck.allowed) {
      res.status(429).json({
        error: `Too many verification requests. Try again in ${ipCheck.retryAfterSeconds}s.`,
        retryAfterSeconds: ipCheck.retryAfterSeconds,
      });
      return;
    }

    // Cooldown check per email+purpose
    const now = Date.now();
    for (const existing of otpChallenges.values()) {
      if (
        existing.email === rawEmail &&
        existing.purpose === purpose &&
        now - existing.createdAt < RESEND_COOLDOWN_MS
      ) {
        const waitSec = Math.ceil((RESEND_COOLDOWN_MS - (now - existing.createdAt)) / 1000);
        res.status(429).json({
          error: `Please wait ${waitSec}s before requesting another verification code.`,
          retryAfterSeconds: waitSec,
        });
        return;
      }
    }

    const emailCheck = checkRateLimit(sendLimits, `otp_send:${purpose}:${rawEmail}`, 5, 15 * 60 * 1000);
    if (!emailCheck.allowed) {
      res.status(429).json({
        error: `Verification send limit reached. Try again in ${Math.ceil(emailCheck.retryAfterSeconds / 60)} minutes.`,
        retryAfterSeconds: emailCheck.retryAfterSeconds,
      });
      return;
    }

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
      expiresAt: now + OTP_TTL_MS,
      createdAt: now,
    };

    otpChallenges.set(challengeId, challenge);

    try {
      const sentViaSmtp = await sendVerificationEmail(rawEmail, code, purpose);
      if (sentViaSmtp) {
        res.json({
          challengeId,
          expiresAt: challenge.expiresAt,
          cooldownSeconds: Math.ceil(RESEND_COOLDOWN_MS / 1000),
          delivery: 'email',
        });
      } else {
        res.json({
          challengeId,
          expiresAt: challenge.expiresAt,
          cooldownSeconds: Math.ceil(RESEND_COOLDOWN_MS / 1000),
          delivery: 'preview',
          previewCode: code,
        });
      }
    } catch (err) {
      console.error('SMTP email delivery failed:', err);
      res.status(500).json({ error: 'Unable to deliver verification email. Check SMTP configuration.' });
    }
  });

  // 2. Verify 6-Digit Code (constant-time HMAC check, brute-force locked)
  app.post('/api/auth/otp/verify', (req, res) => {
    const challengeId = typeof req.body?.challengeId === 'string' ? req.body.challengeId.trim() : '';
    const rawEmail = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';

    if (!challengeId || !/^\d{6}$/.test(code)) {
      res.status(400).json({ error: 'Enter a valid 6-digit verification code.' });
      return;
    }

    const ip = getClientIp(req);
    const verifyIpCheck = checkRateLimit(ipRateLimits, `otp_verify_ip:${ip}`, 25, 15 * 60 * 1000);
    if (!verifyIpCheck.allowed) {
      res.status(429).json({
        error: `Too many verification attempts. Try again in ${Math.ceil(verifyIpCheck.retryAfterSeconds / 60)} minutes.`,
        retryAfterSeconds: verifyIpCheck.retryAfterSeconds,
      });
      return;
    }

    const challenge = otpChallenges.get(challengeId);
    if (!challenge || challenge.email !== rawEmail) {
      res.status(400).json({ error: 'Verification challenge not found. Request a new code.' });
      return;
    }

    if (Date.now() > challenge.expiresAt) {
      otpChallenges.delete(challengeId);
      res.status(400).json({ error: 'This verification code has expired. Please resend a new code.' });
      return;
    }

    if (challenge.attempts >= challenge.maxAttempts) {
      res.status(429).json({
        error: 'Too many incorrect attempts. Request a new verification code.',
        locked: true,
      });
      return;
    }

    const candidateHash = hashCode(challenge.salt, code);
    if (!constantTimeHexEqual(candidateHash, challenge.codeHash)) {
      challenge.attempts += 1;
      const remaining = Math.max(0, challenge.maxAttempts - challenge.attempts);
      if (remaining === 0) {
        otpChallenges.delete(challengeId);
        res.status(429).json({
          error: 'Maximum verification attempts exceeded. Please request a fresh code.',
          attemptsRemaining: 0,
          locked: true,
        });
        return;
      }
      res.status(400).json({
        error: `Incorrect verification code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`,
        attemptsRemaining: remaining,
      });
      return;
    }

    otpChallenges.delete(challengeId);
    const issuedAt = Date.now();
    const proofPayload = Buffer.from(
      JSON.stringify({ email: rawEmail, purpose: challenge.purpose, issuedAt })
    ).toString('base64url');
    const proofSig = crypto
      .createHmac('sha256', SERVER_SECRET)
      .update(proofPayload)
      .digest('base64url');

    res.json({
      verified: true,
      verificationProof: `${proofPayload}.${proofSig}`,
    });
  });

  // 3. Login Brute-Force Guard & Attempt Tracking
  app.post('/api/auth/login-guard', (req, res) => {
    const identifier = typeof req.body?.identifier === 'string' ? req.body.identifier.trim().toLowerCase() : '';
    const ip = getClientIp(req);
    const now = Date.now();

    for (const key of [`login_id:${identifier}`, `login_ip:${ip}`]) {
      const bucket = loginFailures.get(key);
      if (bucket && bucket.lockedUntil > now) {
        const retryAfterSeconds = Math.ceil((bucket.lockedUntil - now) / 1000);
        res.status(429).json({
          allowed: false,
          retryAfterSeconds,
          error: `Too many failed sign-in attempts. Please try again in ${Math.ceil(retryAfterSeconds / 60)} minute(s).`,
        });
        return;
      }
    }

    res.json({ allowed: true });
  });

  app.post('/api/auth/login-failure', (req, res) => {
    const identifier = typeof req.body?.identifier === 'string' ? req.body.identifier.trim().toLowerCase() : '';
    const ip = getClientIp(req);
    const now = Date.now();

    const idBucket = loginFailures.get(`login_id:${identifier}`) || {
      count: 0,
      resetAt: now + LOCKOUT_MS,
      lockedUntil: 0,
    };
    if (idBucket.resetAt <= now) {
      idBucket.count = 0;
      idBucket.resetAt = now + LOCKOUT_MS;
      idBucket.lockedUntil = 0;
    }
    idBucket.count += 1;
    if (idBucket.count >= MAX_LOGIN_FAILURES) {
      idBucket.lockedUntil = now + LOCKOUT_MS;
    }
    loginFailures.set(`login_id:${identifier}`, idBucket);

    const ipBucket = loginFailures.get(`login_ip:${ip}`) || {
      count: 0,
      resetAt: now + LOCKOUT_MS,
      lockedUntil: 0,
    };
    if (ipBucket.resetAt <= now) {
      ipBucket.count = 0;
      ipBucket.resetAt = now + LOCKOUT_MS;
      ipBucket.lockedUntil = 0;
    }
    ipBucket.count += 1;
    if (ipBucket.count >= MAX_LOGIN_FAILURES * 3) {
      ipBucket.lockedUntil = now + LOCKOUT_MS;
    }
    loginFailures.set(`login_ip:${ip}`, ipBucket);

    const attemptsRemaining = Math.max(0, MAX_LOGIN_FAILURES - idBucket.count);
    res.json({
      attemptsRemaining,
      locked: idBucket.lockedUntil > now,
      retryAfterSeconds: idBucket.lockedUntil > now ? Math.ceil((idBucket.lockedUntil - now) / 1000) : 0,
    });
  });

  app.post('/api/auth/login-success', (req, res) => {
    const identifier = typeof req.body?.identifier === 'string' ? req.body.identifier.trim().toLowerCase() : '';
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const username = typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : '';
    if (identifier) loginFailures.delete(`login_id:${identifier}`);
    if (email) loginFailures.delete(`login_id:${email}`);
    if (username && email) usernameEmailCache.set(username, email);
    res.json({ ok: true });
  });

  // 4. Authenticated Encrypted Username Hint Registration & Resolution
  app.post('/api/auth/encrypt-hint', async (req, res) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!token) {
      res.status(401).json({ error: 'Missing authorization token.' });
      return;
    }

    try {
      const decoded = await adminAuth.verifyIdToken(token);
      const email = (decoded.email || '').trim().toLowerCase();
      const username = typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : '';
      if (!email || !/^[a-z0-9_.-]{3,32}$/.test(username)) {
        res.status(400).json({ error: 'Invalid username or account email.' });
        return;
      }
      usernameEmailCache.set(username, email);
      const encryptedHint = encryptLoginHint(email);
      res.json({ encryptedHint });
    } catch {
      res.status(401).json({ error: 'Invalid Firebase authentication token.' });
    }
  });

  app.post('/api/auth/resolve-login', (req, res) => {
    const ip = getClientIp(req);
    const rate = checkRateLimit(ipRateLimits, `resolve_ip:${ip}`, 30, 10 * 60 * 1000);
    if (!rate.allowed) {
      res.status(429).json({
        error: `Too many login lookup requests. Try again in ${rate.retryAfterSeconds}s.`,
      });
      return;
    }

    const username = typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : '';
    const encryptedHint = typeof req.body?.encryptedHint === 'string' ? req.body.encryptedHint.trim() : '';

    if (!username) {
      res.status(400).json({ error: 'Missing username.' });
      return;
    }

    const cached = usernameEmailCache.get(username);
    if (cached) {
      res.json({ email: cached });
      return;
    }

    if (encryptedHint) {
      const decrypted = decryptLoginHint(encryptedHint);
      if (decrypted) {
        usernameEmailCache.set(username, decrypted);
        res.json({ email: decrypted });
        return;
      }
    }

    res.status(404).json({
      error: 'Please sign in using your email address for this session.',
    });
  });

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const vite = await import('vite');
    const hmrEnabled = process.env.DISABLE_HMR !== 'true';
    const viteServer = await vite.createServer({
      server: {
        middlewareMode: true,
        hmr: hmrEnabled,
        ws: hmrEnabled ? { server: httpServer } : false,
      },
      appType: 'spa',
    });
    if (!hmrEnabled) {
      app.get('/@vite/client', async (_req, res, next) => {
        try {
          const result = await viteServer.transformRequest('/@vite/client');
          if (!result) {
            next();
            return;
          }
          const patched = result.code
            .replace('await wsTransport.connect(handlers);', 'return;')
            .replace(
              'ws.send(JSON.stringify(data));',
              'if (ws && ws.readyState === 1) ws.send(JSON.stringify(data));'
            );
          res.type('application/javascript').send(patched);
        } catch (err) {
          next(err);
        }
      });
    }
    app.use(viteServer.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT) || 3000;
  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`Clerk server running on http://0.0.0.0:${port}`);
  });
}

void startServer();
