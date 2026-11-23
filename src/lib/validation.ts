import { Timestamp } from 'firebase/firestore';
import { LIMITS } from '../types/guildspace';

export function truncateStr(value: string, maxLength: number): string {
  return value.trim().slice(0, maxLength);
}

export function sanitizeUsername(raw: string, fallbackSuffix = ''): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '');
  let result = cleaned || `member${fallbackSuffix}`;
  if (result.length < LIMITS.USERNAME_MIN) {
    result = `${result}_cf${fallbackSuffix}`.slice(0, LIMITS.USERNAME_MAX);
  }
  return result.slice(0, LIMITS.USERNAME_MAX);
}

export function sanitizeChannelSlug(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-_]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return (cleaned || 'general').slice(0, LIMITS.CHANNEL_NAME_MAX);
}

export function generateId(prefix = ''): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let rand = '';
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < bytes.length; i++) {
    rand += chars[bytes[i] % chars.length];
  }
  return prefix ? `${prefix}_${rand}` : rand;
}

export function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'CF';
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < bytes.length; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

export function extractInviteCode(rawInput: string): string {
  const trimmed = rawInput.trim();
  if (!trimmed) return '';
  try {
    if (trimmed.includes('://') || trimmed.includes('invite=')) {
      const parsed = new URL(trimmed.startsWith('http') ? trimmed : `https://clerk.app/${trimmed.replace(/^\/+/, '')}`);
      const queryInvite = parsed.searchParams.get('invite');
      if (queryInvite) {
        return queryInvite.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
      }
      const segments = parsed.pathname.split('/').filter(Boolean);
      const last = segments[segments.length - 1] || '';
      return last.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
    }
  } catch {
    // Fallback to direct parsing below
  }
  const slashParts = trimmed.split('/').filter(Boolean);
  const candidate = slashParts[slashParts.length - 1] || trimmed;
  return candidate.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
}

export function buildInviteLink(inviteCode: string): string {
  if (typeof window === 'undefined') return inviteCode;
  return `${window.location.origin}/?invite=${encodeURIComponent(inviteCode)}`;
}

export function getPairId(uidA: string, uidB: string): string {
  return [uidA, uidB].sort().join('_');
}

export function formatMessageTime(ts: Timestamp | null | undefined): string {
  if (!ts) return 'Just now';
  const date = ts.toDate();
  const now = new Date();
  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (isToday) return time;

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    date.getDate() === yesterday.getDate() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getFullYear() === yesterday.getFullYear();

  if (isYesterday) return `Yesterday ${time}`;
  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

export function formatRelativeTime(ts: Timestamp | null | undefined): string {
  if (!ts) return 'now';
  const diffSec = Math.max(0, Math.floor((Date.now() - ts.toDate().getTime()) / 1000));
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

export function groupReactions(
  tokens: string[],
  currentUid: string
): { emoji: string; count: number; reactedByMe: boolean }[] {
  const map = new Map<string, { count: number; reactedByMe: boolean }>();
  for (const token of tokens) {
    const sep = token.lastIndexOf(':');
    if (sep <= 0) continue;
    const emoji = token.slice(0, sep);
    const uid = token.slice(sep + 1);
    const entry = map.get(emoji) ?? { count: 0, reactedByMe: false };
    entry.count += 1;
    if (uid === currentUid) entry.reactedByMe = true;
    map.set(emoji, entry);
  }
  return Array.from(map.entries()).map(([emoji, data]) => ({
    emoji,
    count: data.count,
    reactedByMe: data.reactedByMe,
  }));
}
