import nodemailer from 'nodemailer';
import { readEnv } from './env.ts';

export function isSmtpConfigured(): boolean {
  const host = readEnv('SMTP_HOST');
  const user = readEnv('SMTP_USER');
  const pass = readEnv('SMTP_PASS');
  return Boolean(host && user && pass);
}

export async function sendVerificationEmail(
  email: string,
  code: string,
  purpose: 'signup' | '2fa'
): Promise<boolean> {
  const host = readEnv('SMTP_HOST');
  const user = readEnv('SMTP_USER');
  const pass = readEnv('SMTP_PASS');
  if (!host || !user || !pass) {
    return false;
  }

  const port = Number(readEnv('SMTP_PORT') || '587');
  const from = readEnv('SMTP_FROM') || user;
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
