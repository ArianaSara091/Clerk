import { Timestamp } from 'firebase/firestore';

export type PresenceStatus = 'online' | 'idle' | 'dnd' | 'offline';
export type GuildRoleType = 'owner' | 'admin' | 'moderator' | 'member';
export type ChannelType = 'text' | 'voice';
export type PermissionKey =
  | 'MANAGE_CHANNELS'
  | 'MANAGE_MESSAGES'
  | 'KICK_MEMBERS'
  | 'MANAGE_ROLES';

export const LIMITS = {
  DISPLAY_NAME_MAX: 40,
  USERNAME_MIN: 3,
  USERNAME_MAX: 32,
  BIO_MAX: 240,
  CUSTOM_STATUS_MAX: 80,
  GUILD_NAME_MIN: 2,
  GUILD_NAME_MAX: 60,
  GUILD_DESC_MAX: 300,
  CHANNEL_NAME_MAX: 48,
  CHANNEL_TOPIC_MAX: 200,
  CATEGORY_MAX: 40,
  ROLE_NAME_MAX: 32,
  MESSAGE_MAX: 2000,
  REPLY_SNIPPET_MAX: 160,
  URL_MAX: 500,
} as const;

export const PATTERNS = {
  ID: /^[a-zA-Z0-9_-]+$/,
  USERNAME: /^[a-z0-9_.-]+$/,
  CHANNEL_NAME: /^[a-z0-9-_]+$/,
  INVITE_CODE: /^[A-Z0-9]{6,16}$/,
} as const;

export interface LinkedDiscordAccount {
  id: string;
  username: string;
  globalName: string;
  avatarUrl: string;
  linkedAt: string;
}

export const EMPTY_LINKED_DISCORD: LinkedDiscordAccount = {
  id: '',
  username: '',
  globalName: '',
  avatarUrl: '',
  linkedAt: '',
};

export interface DiscordOAuthProfile {
  id: string;
  username: string;
  globalName: string;
  avatarUrl: string;
  email: string;
  verified: boolean;
}

export interface UserProfile {
  uid: string;
  displayName: string;
  username: string;
  avatarUrl: string;
  bio: string;
  accentColor: string;
  status: PresenceStatus;
  customStatus: string;
  isVerified: boolean;
  twoFactorEnabled: boolean;
  linkedDiscord: LinkedDiscordAccount;
  visibility: 'public';
  lastSeenAt: Timestamp | null;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface UserPrivateAccount {
  uid: string;
  email: string;
  dateOfBirth: string;
  notificationsEnabled: boolean;
  twoFactorEnabled: boolean;
  linkedDiscordEmail: string;
  updatedAt: Timestamp | null;
}

export interface UsernameClaim {
  username: string;
  uid: string;
  encryptedHint: string;
  createdAt: Timestamp | null;
}

export interface UserSession {
  id: string;
  uid: string;
  deviceLabel: string;
  rememberMe: boolean;
  revoked: boolean;
  createdAt: Timestamp | null;
  lastActiveAt: Timestamp | null;
}

export interface UserGuildLink {
  guildId: string;
  uid: string;
  guildName: string;
  guildIcon: string;
  guildAccent: string;
  role: GuildRoleType;
  joinedAt: Timestamp | null;
}

export type NotificationType =
  | 'friend_request'
  | 'friend_accept'
  | 'mention'
  | 'dm'
  | 'guild_invite'
  | 'role_update';

export interface AppNotification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  actorId: string;
  actorName: string;
  actorAvatar: string;
  targetType: 'guild' | 'dm' | 'friends';
  targetId: string;
  read: boolean;
  createdAt: Timestamp | null;
}

export interface Guild {
  id: string;
  name: string;
  description: string;
  iconUrl: string;
  accentColor: string;
  ownerId: string;
  inviteCode: string;
  isPublic: boolean;
  memberCount: number;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface GuildInvite {
  inviteCode: string;
  guildId: string;
  guildName: string;
  guildDescription: string;
  guildIcon: string;
  guildAccent: string;
  createdBy: string;
  createdAt: Timestamp | null;
}

export interface GuildMember {
  uid: string;
  guildId: string;
  displayName: string;
  username: string;
  avatarUrl: string;
  role: GuildRoleType;
  customRoleId: string;
  customRoleName: string;
  customRoleColor: string;
  inviteCodeUsed: string;
  joinedAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface GuildRole {
  id: string;
  guildId: string;
  name: string;
  color: string;
  permissions: PermissionKey[];
  position: number;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface GuildChannel {
  id: string;
  guildId: string;
  name: string;
  type: ChannelType;
  topic: string;
  category: string;
  isPrivate: boolean;
  position: number;
  createdBy: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface VoiceParticipant {
  uid: string;
  guildId: string;
  channelId: string;
  displayName: string;
  username: string;
  avatarUrl: string;
  accentColor: string;
  muted: boolean;
  deafened: boolean;
  speaking: boolean;
  joinedAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface ChannelMessage {
  id: string;
  guildId: string;
  channelId: string;
  authorId: string;
  authorName: string;
  authorAvatar: string;
  authorRole: string;
  authorRoleColor: string;
  content: string;
  attachmentUrl: string;
  attachmentName: string;
  attachmentType: string;
  replyToId: string;
  replyToSnippet: string;
  replyToAuthor: string;
  edited: boolean;
  pinned: boolean;
  reactionTokens: string[];
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface FriendRequest {
  id: string;
  fromId: string;
  fromName: string;
  fromUsername: string;
  fromAvatar: string;
  toId: string;
  toName: string;
  toUsername: string;
  toAvatar: string;
  status: 'pending' | 'accepted' | 'declined';
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface Friendship {
  id: string;
  participants: string[];
  uid1: string;
  uid2: string;
  createdAt: Timestamp | null;
}

export interface DmThread {
  id: string;
  participants: string[];
  p1Uid: string;
  p1Name: string;
  p1Username: string;
  p1Avatar: string;
  p2Uid: string;
  p2Name: string;
  p2Username: string;
  p2Avatar: string;
  lastMessage: string;
  lastSenderId: string;
  lastMessageAt: Timestamp | null;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface DmMessage {
  id: string;
  threadId: string;
  authorId: string;
  authorName: string;
  authorAvatar: string;
  content: string;
  attachmentUrl: string;
  attachmentName: string;
  attachmentType: string;
  edited: boolean;
  reactionTokens: string[];
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export const ACCENT_SWATCHES = [
  '#7C3AED',
  '#6366F1',
  '#3B82F6',
  '#0EA5E9',
  '#10B981',
  '#F59E0B',
  '#EC4899',
  '#8B5CF6',
] as const;

export const STATUS_META: Record<
  PresenceStatus,
  { label: string; colorClass: string; ringClass: string }
> = {
  online: {
    label: 'Online',
    colorClass: 'bg-emerald-500',
    ringClass: 'ring-emerald-500/30',
  },
  idle: {
    label: 'Idle',
    colorClass: 'bg-amber-400',
    ringClass: 'ring-amber-400/30',
  },
  dnd: {
    label: 'Do Not Disturb',
    colorClass: 'bg-rose-500',
    ringClass: 'ring-rose-500/30',
  },
  offline: {
    label: 'Offline',
    colorClass: 'bg-slate-500',
    ringClass: 'ring-slate-500/30',
  },
};
