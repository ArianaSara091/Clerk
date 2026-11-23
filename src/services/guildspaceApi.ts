import { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { db, handleFirestoreError, OperationType, storage } from '../lib/firebase';
import {
  extractInviteCode,
  generateId,
  generateInviteCode,
  getPairId,
  sanitizeChannelSlug,
  sanitizeUsername,
  truncateStr,
} from '../lib/validation';
import {
  ACCENT_SWATCHES,
  ChannelType,
  DiscordOAuthProfile,
  EMPTY_LINKED_DISCORD,
  Guild,
  GuildInvite,
  GuildMember,
  GuildRoleType,
  LIMITS,
  PermissionKey,
  PresenceStatus,
  UserPrivateAccount,
  UserProfile,
} from '../types/guildspace';
import { registerUsernameClaim, toLinkedDiscordRecord } from './authService';

export async function uploadMediaFile(file: File, folder: string): Promise<{ url: string; name: string; type: string }> {
  const maxBytes = 8 * 1024 * 1024;
  if (file.size > maxBytes) {
    throw new Error('File exceeds the 8 MB upload limit.');
  }
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'upload';
  const objectPath = `${folder}/${Date.now()}_${safeName}`;
  const storageRef = ref(storage, objectPath);
  try {
    await uploadBytes(storageRef, file, { contentType: file.type || 'application/octet-stream' });
    const url = await getDownloadURL(storageRef);
    return {
      url: url.slice(0, LIMITS.URL_MAX),
      name: truncateStr(file.name, 120) || 'attachment',
      type: truncateStr(file.type || 'application/octet-stream', 64),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Storage upload failed';
    if (msg.includes('storage/unauthorized') || msg.includes('storage/unknown')) {
      throw new Error(
        'Firebase Storage upload was denied. Enable Firebase Storage in the Firebase Console or paste a direct image URL.'
      );
    }
    throw new Error(msg);
  }
}

export async function ensureUserProfile(
  user: User,
  options?: {
    preferredDisplayName?: string;
    preferredUsername?: string;
    dateOfBirth?: string;
    isVerified?: boolean;
    discordProfile?: DiscordOAuthProfile;
    importDiscordUsername?: boolean;
    importDiscordAvatar?: boolean;
  }
): Promise<UserProfile> {
  const userPath = `users/${user.uid}`;
  const userRef = doc(db, 'users', user.uid);
  const privateRef = doc(db, 'users', user.uid, 'private', 'account');

  try {
    const snap = await getDoc(userRef);
    if (snap.exists()) {
      const existing = snap.data() as UserProfile;
      const verified = Boolean(existing.isVerified || user.emailVerified || options?.isVerified);
      const nextLinkedDiscord = options?.discordProfile
        ? toLinkedDiscordRecord(options.discordProfile)
        : existing.linkedDiscord || EMPTY_LINKED_DISCORD;

      const nextDisplayName =
        options?.discordProfile && options.importDiscordUsername
          ? truncateStr(
              options.discordProfile.globalName || options.discordProfile.username,
              LIMITS.DISPLAY_NAME_MAX
            ) || existing.displayName
          : existing.displayName;

      const nextAvatarUrl =
        options?.discordProfile && options.importDiscordAvatar && options.discordProfile.avatarUrl
          ? truncateStr(options.discordProfile.avatarUrl, LIMITS.URL_MAX)
          : existing.avatarUrl;

      await updateDoc(userRef, {
        status: existing.status === 'offline' ? 'online' : existing.status,
        isVerified: verified,
        linkedDiscord: nextLinkedDiscord,
        displayName: nextDisplayName,
        avatarUrl: nextAvatarUrl,
        lastSeenAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // Ensure private account exists & backfills linkedDiscordEmail if missing
      const privateSnap = await getDoc(privateRef);
      if (privateSnap.exists()) {
        const priv = privateSnap.data() as Partial<UserPrivateAccount>;
        const nextDiscordEmail = options?.discordProfile?.email
          ? truncateStr(options.discordProfile.email, 160)
          : priv.linkedDiscordEmail ?? '';
        if (priv.linkedDiscordEmail === undefined || options?.discordProfile?.email) {
          await updateDoc(privateRef, {
            linkedDiscordEmail: nextDiscordEmail,
            updatedAt: serverTimestamp(),
          });
        }
      } else {
        await setDoc(privateRef, {
          uid: user.uid,
          email: truncateStr(user.email || `${user.uid}@clerk.local`, 160),
          dateOfBirth: truncateStr(options?.dateOfBirth || '', 16),
          notificationsEnabled: true,
          twoFactorEnabled: Boolean(existing.twoFactorEnabled),
          linkedDiscordEmail: truncateStr(options?.discordProfile?.email || '', 160),
          updatedAt: serverTimestamp(),
        });
      }

      await registerUsernameClaim(user, existing.username);
      return {
        ...existing,
        displayName: nextDisplayName,
        avatarUrl: nextAvatarUrl,
        linkedDiscord: nextLinkedDiscord,
        isVerified: verified,
      };
    }

    const discordDisplay =
      options?.discordProfile && options.importDiscordUsername
        ? options.discordProfile.globalName || options.discordProfile.username
        : '';
    const rawName =
      options?.preferredDisplayName ||
      discordDisplay ||
      options?.preferredUsername ||
      user.displayName ||
      user.email?.split('@')[0] ||
      'Clerk Member';
    const displayName = truncateStr(rawName, LIMITS.DISPLAY_NAME_MAX) || 'Clerk Member';
    const suffix = user.uid.slice(0, 4).toLowerCase();
    const rawUserSeed =
      options?.preferredUsername ||
      (options?.discordProfile && options.importDiscordUsername
        ? options.discordProfile.username
        : '') ||
      user.email?.split('@')[0] ||
      displayName;
    const username = sanitizeUsername(rawUserSeed, suffix);

    const avatarUrl =
      options?.discordProfile && options.importDiscordAvatar && options.discordProfile.avatarUrl
        ? truncateStr(options.discordProfile.avatarUrl, LIMITS.URL_MAX)
        : truncateStr(user.photoURL || '', LIMITS.URL_MAX);

    const accentColor = ACCENT_SWATCHES[user.uid.charCodeAt(0) % ACCENT_SWATCHES.length];
    const isVerified = Boolean(user.emailVerified || options?.isVerified);
    const linkedDiscord = options?.discordProfile
      ? toLinkedDiscordRecord(options.discordProfile)
      : EMPTY_LINKED_DISCORD;

    const batch = writeBatch(db);
    const profilePayload = {
      uid: user.uid,
      displayName,
      username,
      avatarUrl,
      bio: '',
      accentColor,
      status: 'online' as PresenceStatus,
      customStatus: '',
      isVerified,
      twoFactorEnabled: false,
      linkedDiscord,
      visibility: 'public' as const,
      lastSeenAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    batch.set(userRef, profilePayload);
    batch.set(privateRef, {
      uid: user.uid,
      email: truncateStr(user.email || `${user.uid}@clerk.local`, 160),
      dateOfBirth: truncateStr(options?.dateOfBirth || '', 16),
      notificationsEnabled: true,
      twoFactorEnabled: false,
      linkedDiscordEmail: truncateStr(options?.discordProfile?.email || '', 160),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
    await registerUsernameClaim(user, username);

    return {
      ...profilePayload,
      lastSeenAt: null,
      createdAt: null,
      updatedAt: null,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userPath);
  }
}

export async function updateUserProfile(
  uid: string,
  updates: {
    displayName: string;
    username: string;
    previousUsername?: string;
    bio: string;
    avatarUrl: string;
    accentColor: string;
    customStatus: string;
    status: PresenceStatus;
  },
  joinedGuildIds: string[] = [],
  authUser?: User | null
): Promise<void> {
  const path = `users/${uid}`;
  const cleanName = truncateStr(updates.displayName, LIMITS.DISPLAY_NAME_MAX) || 'Clerk Member';
  const cleanUsername = sanitizeUsername(updates.username, uid.slice(0, 4).toLowerCase());
  const cleanAvatar = truncateStr(updates.avatarUrl, LIMITS.URL_MAX);

  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'users', uid), {
      displayName: cleanName,
      username: cleanUsername,
      bio: truncateStr(updates.bio, LIMITS.BIO_MAX),
      avatarUrl: cleanAvatar,
      accentColor: truncateStr(updates.accentColor, 16) || '#7C3AED',
      customStatus: truncateStr(updates.customStatus, LIMITS.CUSTOM_STATUS_MAX),
      status: updates.status,
      lastSeenAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    for (const guildId of joinedGuildIds.slice(0, 15)) {
      batch.update(doc(db, 'guilds', guildId, 'members', uid), {
        displayName: cleanName,
        username: cleanUsername,
        avatarUrl: cleanAvatar,
        updatedAt: serverTimestamp(),
      });
    }

    await batch.commit();
    if (authUser) {
      await registerUsernameClaim(authUser, cleanUsername, updates.previousUsername);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updatePresenceStatus(uid: string, status: PresenceStatus, customStatus?: string): Promise<void> {
  const path = `users/${uid}`;
  try {
    const payload: Record<string, unknown> = {
      status,
      lastSeenAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (customStatus !== undefined) {
      payload.customStatus = truncateStr(customStatus, LIMITS.CUSTOM_STATUS_MAX);
    }
    await updateDoc(doc(db, 'users', uid), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updatePrivateNotificationsSetting(uid: string, enabled: boolean): Promise<void> {
  const path = `users/${uid}/private/account`;
  try {
    await updateDoc(doc(db, 'users', uid, 'private', 'account'), {
      notificationsEnabled: enabled,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function toggleTwoFactorSetting(uid: string, enabled: boolean): Promise<void> {
  const path = `users/${uid}`;
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'users', uid), {
      twoFactorEnabled: enabled,
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'users', uid, 'private', 'account'), {
      twoFactorEnabled: enabled,
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function createGuildWithDefaults(
  profile: UserProfile,
  input: {
    name: string;
    description: string;
    iconUrl: string;
    accentColor: string;
    isPublic: boolean;
  }
): Promise<{ guildId: string; defaultChannelId: string }> {
  const guildId = generateId('g');
  const inviteCode = generateInviteCode();
  const generalId = generateId('ch');
  const announcementsId = generateId('ch');
  const voiceLoungeId = generateId('ch');
  const cleanName = truncateStr(input.name, LIMITS.GUILD_NAME_MAX);
  const cleanDesc = truncateStr(input.description, LIMITS.GUILD_DESC_MAX);
  const cleanIcon = truncateStr(input.iconUrl, LIMITS.URL_MAX);
  const cleanAccent = truncateStr(input.accentColor, 16) || '#7C3AED';

  try {
    const batch = writeBatch(db);

    batch.set(doc(db, 'guilds', guildId), {
      id: guildId,
      name: cleanName,
      description: cleanDesc,
      iconUrl: cleanIcon,
      accentColor: cleanAccent,
      ownerId: profile.uid,
      inviteCode,
      isPublic: input.isPublic,
      memberCount: 1,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'invites', inviteCode), {
      inviteCode,
      guildId,
      guildName: cleanName,
      guildDescription: cleanDesc,
      guildIcon: cleanIcon,
      guildAccent: cleanAccent,
      createdBy: profile.uid,
      createdAt: serverTimestamp(),
    });

    batch.set(doc(db, 'guilds', guildId, 'members', profile.uid), {
      uid: profile.uid,
      guildId,
      displayName: profile.displayName,
      username: profile.username,
      avatarUrl: profile.avatarUrl,
      role: 'owner' as GuildRoleType,
      customRoleId: '',
      customRoleName: 'Founder',
      customRoleColor: cleanAccent,
      inviteCodeUsed: inviteCode,
      joinedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'users', profile.uid, 'guildLinks', guildId), {
      guildId,
      uid: profile.uid,
      guildName: cleanName,
      guildIcon: cleanIcon,
      guildAccent: cleanAccent,
      role: 'owner' as GuildRoleType,
      joinedAt: serverTimestamp(),
    });

    const channels: {
      id: string;
      name: string;
      type: ChannelType;
      topic: string;
      category: string;
      position: number;
    }[] = [
      {
        id: generalId,
        name: 'general',
        type: 'text',
        topic: `Welcome to ${cleanName}! Start the conversation here.`,
        category: 'Text Channels',
        position: 0,
      },
      {
        id: announcementsId,
        name: 'announcements',
        type: 'text',
        topic: 'Important server updates and announcements.',
        category: 'Text Channels',
        position: 1,
      },
      {
        id: voiceLoungeId,
        name: 'voice-lounge',
        type: 'voice',
        topic: 'Live voice room & companion audio chat.',
        category: 'Voice Channels',
        position: 2,
      },
    ];

    for (const ch of channels) {
      batch.set(doc(db, 'guilds', guildId, 'channels', ch.id), {
        id: ch.id,
        guildId,
        name: ch.name,
        type: ch.type,
        topic: ch.topic,
        category: ch.category,
        isPrivate: false,
        position: ch.position,
        createdBy: profile.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    const welcomeMsgId = generateId('msg');
    batch.set(doc(db, 'guilds', guildId, 'channels', generalId, 'messages', welcomeMsgId), {
      id: welcomeMsgId,
      guildId,
      channelId: generalId,
      authorId: profile.uid,
      authorName: profile.displayName,
      authorAvatar: profile.avatarUrl,
      authorRole: 'Founder',
      authorRoleColor: cleanAccent,
      content: `Created ${cleanName} on Clerk. Share invite code ${inviteCode} or hop into #voice-lounge anytime.`,
      attachmentUrl: '',
      attachmentName: '',
      attachmentType: '',
      replyToId: '',
      replyToSnippet: '',
      replyToAuthor: '',
      edited: false,
      pinned: true,
      reactionTokens: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await batch.commit();
    return { guildId, defaultChannelId: generalId };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `guilds/${guildId}`);
  }
}

export async function lookupInviteCode(rawInput: string): Promise<GuildInvite | null> {
  const code = extractInviteCode(rawInput);
  if (code.length < 6) return null;
  try {
    const snap = await getDoc(doc(db, 'invites', code));
    return snap.exists() ? (snap.data() as GuildInvite) : null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `invites/${code}`);
  }
}

export async function joinGuild(
  profile: UserProfile,
  guild: { id: string; name: string; iconUrl: string; accentColor: string },
  inviteCodeUsed = ''
): Promise<void> {
  const memberRef = doc(db, 'guilds', guild.id, 'members', profile.uid);
  try {
    const existingMember = await getDoc(memberRef);
    if (existingMember.exists()) return;

    const batch = writeBatch(db);
    batch.set(memberRef, {
      uid: profile.uid,
      guildId: guild.id,
      displayName: profile.displayName,
      username: profile.username,
      avatarUrl: profile.avatarUrl,
      role: 'member' as GuildRoleType,
      customRoleId: '',
      customRoleName: '',
      customRoleColor: '',
      inviteCodeUsed: inviteCodeUsed.trim().toUpperCase().slice(0, 16),
      joinedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'users', profile.uid, 'guildLinks', guild.id), {
      guildId: guild.id,
      uid: profile.uid,
      guildName: truncateStr(guild.name, LIMITS.GUILD_NAME_MAX),
      guildIcon: truncateStr(guild.iconUrl, LIMITS.URL_MAX),
      guildAccent: truncateStr(guild.accentColor, 16) || '#7C3AED',
      role: 'member' as GuildRoleType,
      joinedAt: serverTimestamp(),
    });

    batch.update(doc(db, 'guilds', guild.id), {
      memberCount: increment(1),
      updatedAt: serverTimestamp(),
    });

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `guilds/${guild.id}/members/${profile.uid}`);
  }
}

export async function leaveGuild(uid: string, guildId: string): Promise<void> {
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'guilds', guildId, 'members', uid));
    batch.delete(doc(db, 'users', uid, 'guildLinks', guildId));
    batch.update(doc(db, 'guilds', guildId), {
      memberCount: increment(-1),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `guilds/${guildId}/members/${uid}`);
  }
}

export async function updateGuildSettings(
  guild: Guild,
  updates: {
    name: string;
    description: string;
    iconUrl: string;
    accentColor: string;
    isPublic: boolean;
  }
): Promise<void> {
  const cleanName = truncateStr(updates.name, LIMITS.GUILD_NAME_MAX);
  const cleanDesc = truncateStr(updates.description, LIMITS.GUILD_DESC_MAX);
  const cleanIcon = truncateStr(updates.iconUrl, LIMITS.URL_MAX);
  const cleanAccent = truncateStr(updates.accentColor, 16) || '#7C3AED';

  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'guilds', guild.id), {
      name: cleanName,
      description: cleanDesc,
      iconUrl: cleanIcon,
      accentColor: cleanAccent,
      isPublic: updates.isPublic,
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'invites', guild.inviteCode), {
      guildName: cleanName,
      guildDescription: cleanDesc,
      guildIcon: cleanIcon,
      guildAccent: cleanAccent,
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `guilds/${guild.id}`);
  }
}

export async function deleteGuild(uid: string, guild: Guild): Promise<void> {
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'invites', guild.inviteCode));
    batch.delete(doc(db, 'users', uid, 'guildLinks', guild.id));
    batch.delete(doc(db, 'guilds', guild.id));
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `guilds/${guild.id}`);
  }
}

export async function createChannel(
  guildId: string,
  createdBy: string,
  input: { name: string; type: ChannelType; topic: string; category: string; position: number }
): Promise<string> {
  const channelId = generateId('ch');
  const slug = sanitizeChannelSlug(input.name);
  const defaultCat = input.type === 'voice' ? 'Voice Channels' : 'Text Channels';
  try {
    await setDoc(doc(db, 'guilds', guildId, 'channels', channelId), {
      id: channelId,
      guildId,
      name: slug,
      type: input.type,
      topic: truncateStr(input.topic, LIMITS.CHANNEL_TOPIC_MAX),
      category: truncateStr(input.category, LIMITS.CATEGORY_MAX) || defaultCat,
      isPrivate: false,
      position: Math.max(0, Math.min(500, Math.round(input.position))),
      createdBy,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return channelId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `guilds/${guildId}/channels/${channelId}`);
  }
}

export async function updateChannel(
  guildId: string,
  channelId: string,
  updates: { name: string; type: ChannelType; topic: string; category: string }
): Promise<void> {
  const defaultCat = updates.type === 'voice' ? 'Voice Channels' : 'Text Channels';
  try {
    await updateDoc(doc(db, 'guilds', guildId, 'channels', channelId), {
      name: sanitizeChannelSlug(updates.name),
      type: updates.type,
      topic: truncateStr(updates.topic, LIMITS.CHANNEL_TOPIC_MAX),
      category: truncateStr(updates.category, LIMITS.CATEGORY_MAX) || defaultCat,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `guilds/${guildId}/channels/${channelId}`);
  }
}

export async function deleteChannel(guildId: string, channelId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'guilds', guildId, 'channels', channelId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `guilds/${guildId}/channels/${channelId}`);
  }
}

export async function joinVoiceChannel(
  guildId: string,
  channelId: string,
  profile: UserProfile,
  state: { muted?: boolean; deafened?: boolean; speaking?: boolean } = {}
): Promise<void> {
  const path = `guilds/${guildId}/channels/${channelId}/voiceParticipants/${profile.uid}`;
  try {
    await setDoc(doc(db, path), {
      uid: profile.uid,
      guildId,
      channelId,
      displayName: profile.displayName,
      username: profile.username,
      avatarUrl: profile.avatarUrl,
      accentColor: profile.accentColor || '#7C3AED',
      muted: Boolean(state.muted),
      deafened: Boolean(state.deafened),
      speaking: Boolean(state.speaking),
      joinedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function updateVoiceParticipantState(
  guildId: string,
  channelId: string,
  uid: string,
  updates: { muted?: boolean; deafened?: boolean; speaking?: boolean }
): Promise<void> {
  const path = `guilds/${guildId}/channels/${channelId}/voiceParticipants/${uid}`;
  try {
    await updateDoc(doc(db, path), {
      ...updates,
      updatedAt: serverTimestamp(),
    });
  } catch {
    // Ignore transient updates if user just disconnected from voice channel
  }
}

export async function leaveVoiceChannel(
  guildId: string,
  channelId: string,
  uid: string
): Promise<void> {
  const path = `guilds/${guildId}/channels/${channelId}/voiceParticipants/${uid}`;
  try {
    await deleteDoc(doc(db, path));
  } catch {
    // Ignore if already removed
  }
}

export async function createGuildRole(
  guildId: string,
  input: { name: string; color: string; permissions: PermissionKey[]; position: number }
): Promise<void> {
  const roleId = generateId('role');
  try {
    await setDoc(doc(db, 'guilds', guildId, 'roles', roleId), {
      id: roleId,
      guildId,
      name: truncateStr(input.name, LIMITS.ROLE_NAME_MAX) || 'Member',
      color: truncateStr(input.color, 16) || '#8B5CF6',
      permissions: input.permissions.slice(0, 10),
      position: Math.max(0, Math.min(100, Math.round(input.position))),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `guilds/${guildId}/roles/${roleId}`);
  }
}

export async function deleteGuildRole(guildId: string, roleId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'guilds', guildId, 'roles', roleId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `guilds/${guildId}/roles/${roleId}`);
  }
}

export async function assignMemberRole(
  actor: UserProfile,
  guild: Guild,
  targetUid: string,
  role: GuildRoleType,
  customRole?: { id: string; name: string; color: string } | null
): Promise<void> {
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'guilds', guild.id, 'members', targetUid), {
      role,
      customRoleId: customRole ? customRole.id : '',
      customRoleName: customRole ? truncateStr(customRole.name, LIMITS.ROLE_NAME_MAX) : '',
      customRoleColor: customRole ? truncateStr(customRole.color, 16) : '',
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'users', targetUid, 'guildLinks', guild.id), {
      role,
    });
    if (targetUid !== actor.uid) {
      const notifId = generateId('nt');
      batch.set(doc(db, 'users', targetUid, 'notifications', notifId), {
        id: notifId,
        userId: targetUid,
        type: 'role_update',
        title: `Role updated in ${guild.name}`,
        body: `${actor.displayName} updated your role to ${customRole ? customRole.name : role}.`.slice(0, 240),
        actorId: actor.uid,
        actorName: actor.displayName,
        actorAvatar: actor.avatarUrl,
        targetType: 'guild',
        targetId: guild.id,
        read: false,
        createdAt: serverTimestamp(),
      });
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `guilds/${guild.id}/members/${targetUid}`);
  }
}

export async function kickGuildMember(guildId: string, targetUid: string): Promise<void> {
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'guilds', guildId, 'members', targetUid));
    batch.delete(doc(db, 'users', targetUid, 'guildLinks', guildId));
    batch.update(doc(db, 'guilds', guildId), {
      memberCount: increment(-1),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `guilds/${guildId}/members/${targetUid}`);
  }
}

export async function sendChannelMessage(input: {
  guild: Guild;
  channelId: string;
  channelName: string;
  author: UserProfile;
  authorMembership: GuildMember | undefined;
  content: string;
  attachment?: { url: string; name: string; type: string } | null;
  replyTo?: { id: string; snippet: string; author: string } | null;
  guildMembers?: GuildMember[];
}): Promise<void> {
  const messageId = generateId('msg');
  const cleanContent = truncateStr(input.content, LIMITS.MESSAGE_MAX);
  const attachmentUrl = truncateStr(input.attachment?.url || '', LIMITS.URL_MAX);
  if (!cleanContent && !attachmentUrl) return;

  const roleLabel =
    input.authorMembership?.customRoleName ||
    (input.authorMembership?.role && input.authorMembership.role !== 'member'
      ? input.authorMembership.role
      : '');
  const roleColor = input.authorMembership?.customRoleColor || '';

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'guilds', input.guild.id, 'channels', input.channelId, 'messages', messageId), {
      id: messageId,
      guildId: input.guild.id,
      channelId: input.channelId,
      authorId: input.author.uid,
      authorName: input.author.displayName,
      authorAvatar: input.author.avatarUrl,
      authorRole: truncateStr(roleLabel, 32),
      authorRoleColor: truncateStr(roleColor, 16),
      content: cleanContent,
      attachmentUrl,
      attachmentName: truncateStr(input.attachment?.name || '', 120),
      attachmentType: truncateStr(input.attachment?.type || '', 64),
      replyToId: input.replyTo?.id || '',
      replyToSnippet: truncateStr(input.replyTo?.snippet || '', LIMITS.REPLY_SNIPPET_MAX),
      replyToAuthor: truncateStr(input.replyTo?.author || '', LIMITS.DISPLAY_NAME_MAX),
      edited: false,
      pinned: false,
      reactionTokens: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    if (input.guildMembers && cleanContent.includes('@')) {
      const mentioned = input.guildMembers
        .filter((m) => m.uid !== input.author.uid && cleanContent.toLowerCase().includes(`@${m.username.toLowerCase()}`))
        .slice(0, 5);
      for (const member of mentioned) {
        const notifId = generateId('nt');
        batch.set(doc(db, 'users', member.uid, 'notifications', notifId), {
          id: notifId,
          userId: member.uid,
          type: 'mention',
          title: `Mentioned in #${input.channelName}`,
          body: `${input.author.displayName}: ${cleanContent}`.slice(0, 240),
          actorId: input.author.uid,
          actorName: input.author.displayName,
          actorAvatar: input.author.avatarUrl,
          targetType: 'guild',
          targetId: `${input.guild.id}/${input.channelId}`,
          read: false,
          createdAt: serverTimestamp(),
        });
      }
    }

    await batch.commit();
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.CREATE,
      `guilds/${input.guild.id}/channels/${input.channelId}/messages/${messageId}`
    );
  }
}

export async function editChannelMessage(
  guildId: string,
  channelId: string,
  messageId: string,
  content: string
): Promise<void> {
  const clean = truncateStr(content, LIMITS.MESSAGE_MAX);
  if (!clean) return;
  try {
    await updateDoc(doc(db, 'guilds', guildId, 'channels', channelId, 'messages', messageId), {
      content: clean,
      edited: true,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `guilds/${guildId}/channels/${channelId}/messages/${messageId}`);
  }
}

export async function toggleChannelMessagePin(
  guildId: string,
  channelId: string,
  messageId: string,
  pinned: boolean
): Promise<void> {
  try {
    await updateDoc(doc(db, 'guilds', guildId, 'channels', channelId, 'messages', messageId), {
      pinned: !pinned,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `guilds/${guildId}/channels/${channelId}/messages/${messageId}`);
  }
}

export async function deleteChannelMessage(guildId: string, channelId: string, messageId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'guilds', guildId, 'channels', channelId, 'messages', messageId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `guilds/${guildId}/channels/${channelId}/messages/${messageId}`);
  }
}

export async function toggleMessageReaction(
  pathSegments:
    | { kind: 'channel'; guildId: string; channelId: string; messageId: string }
    | { kind: 'dm'; threadId: string; messageId: string },
  currentTokens: string[],
  emoji: string,
  uid: string
): Promise<void> {
  const token = `${emoji}:${uid}`;
  const exists = currentTokens.includes(token);
  const nextTokens = exists
    ? currentTokens.filter((t) => t !== token)
    : [...currentTokens, token].slice(-100);

  const msgRef =
    pathSegments.kind === 'channel'
      ? doc(db, 'guilds', pathSegments.guildId, 'channels', pathSegments.channelId, 'messages', pathSegments.messageId)
      : doc(db, 'dmThreads', pathSegments.threadId, 'messages', pathSegments.messageId);

  try {
    await updateDoc(msgRef, {
      reactionTokens: nextTokens,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, msgRef.path);
  }
}

export async function openOrCreateDmThread(me: UserProfile, partner: UserProfile): Promise<string> {
  const [p1, p2] = me.uid < partner.uid ? [me, partner] : [partner, me];
  const threadId = getPairId(me.uid, partner.uid);
  const threadRef = doc(db, 'dmThreads', threadId);
  try {
    const snap = await getDoc(threadRef);
    if (!snap.exists()) {
      await setDoc(threadRef, {
        id: threadId,
        participants: [p1.uid, p2.uid],
        p1Uid: p1.uid,
        p1Name: p1.displayName,
        p1Username: p1.username,
        p1Avatar: p1.avatarUrl,
        p2Uid: p2.uid,
        p2Name: p2.displayName,
        p2Username: p2.username,
        p2Avatar: p2.avatarUrl,
        lastMessage: '',
        lastSenderId: '',
        lastMessageAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    return threadId;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `dmThreads/${threadId}`);
  }
}

export async function sendDmMessage(input: {
  threadId: string;
  author: UserProfile;
  recipientUid: string;
  content: string;
  attachment?: { url: string; name: string; type: string } | null;
}): Promise<void> {
  const messageId = generateId('dm');
  const cleanContent = truncateStr(input.content, LIMITS.MESSAGE_MAX);
  const attachmentUrl = truncateStr(input.attachment?.url || '', LIMITS.URL_MAX);
  if (!cleanContent && !attachmentUrl) return;

  const preview = cleanContent || `Sent attachment: ${input.attachment?.name || 'file'}`;

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'dmThreads', input.threadId, 'messages', messageId), {
      id: messageId,
      threadId: input.threadId,
      authorId: input.author.uid,
      authorName: input.author.displayName,
      authorAvatar: input.author.avatarUrl,
      content: cleanContent,
      attachmentUrl,
      attachmentName: truncateStr(input.attachment?.name || '', 120),
      attachmentType: truncateStr(input.attachment?.type || '', 64),
      edited: false,
      reactionTokens: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.update(doc(db, 'dmThreads', input.threadId), {
      lastMessage: truncateStr(preview, 200),
      lastSenderId: input.author.uid,
      lastMessageAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const notifId = generateId('nt');
    batch.set(doc(db, 'users', input.recipientUid, 'notifications', notifId), {
      id: notifId,
      userId: input.recipientUid,
      type: 'dm',
      title: `Message from ${input.author.displayName}`,
      body: truncateStr(preview, 240),
      actorId: input.author.uid,
      actorName: input.author.displayName,
      actorAvatar: input.author.avatarUrl,
      targetType: 'dm',
      targetId: input.threadId,
      read: false,
      createdAt: serverTimestamp(),
    });

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `dmThreads/${input.threadId}/messages/${messageId}`);
  }
}

export async function editDmMessage(threadId: string, messageId: string, content: string): Promise<void> {
  const clean = truncateStr(content, LIMITS.MESSAGE_MAX);
  if (!clean) return;
  try {
    await updateDoc(doc(db, 'dmThreads', threadId, 'messages', messageId), {
      content: clean,
      edited: true,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `dmThreads/${threadId}/messages/${messageId}`);
  }
}

export async function deleteDmMessage(threadId: string, messageId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'dmThreads', threadId, 'messages', messageId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `dmThreads/${threadId}/messages/${messageId}`);
  }
}

export async function sendFriendRequest(from: UserProfile, to: UserProfile): Promise<void> {
  if (from.uid === to.uid) return;
  const requestId = `${from.uid}_${to.uid}`;
  const reverseId = `${to.uid}_${from.uid}`;

  try {
    const reverseSnap = await getDoc(doc(db, 'friendRequests', reverseId));
    if (reverseSnap.exists() && reverseSnap.data().status === 'pending') {
      await respondToFriendRequest(to, from, reverseId, 'accepted');
      return;
    }

    const batch = writeBatch(db);
    batch.set(doc(db, 'friendRequests', requestId), {
      id: requestId,
      fromId: from.uid,
      fromName: from.displayName,
      fromUsername: from.username,
      fromAvatar: from.avatarUrl,
      toId: to.uid,
      toName: to.displayName,
      toUsername: to.username,
      toAvatar: to.avatarUrl,
      status: 'pending',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const notifId = generateId('nt');
    batch.set(doc(db, 'users', to.uid, 'notifications', notifId), {
      id: notifId,
      userId: to.uid,
      type: 'friend_request',
      title: 'New Friend Request',
      body: `${from.displayName} (@${from.username}) sent you a friend request.`,
      actorId: from.uid,
      actorName: from.displayName,
      actorAvatar: from.avatarUrl,
      targetType: 'friends',
      targetId: 'pending',
      read: false,
      createdAt: serverTimestamp(),
    });

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `friendRequests/${requestId}`);
  }
}

export async function respondToFriendRequest(
  sender: { uid: string; displayName: string; avatarUrl: string },
  receiver: UserProfile,
  requestId: string,
  decision: 'accepted' | 'declined'
): Promise<void> {
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'friendRequests', requestId), {
      status: decision,
      updatedAt: serverTimestamp(),
    });

    if (decision === 'accepted') {
      const [uid1, uid2] = [sender.uid, receiver.uid].sort();
      const friendshipId = `${uid1}_${uid2}`;
      batch.set(doc(db, 'friendships', friendshipId), {
        id: friendshipId,
        participants: [uid1, uid2],
        uid1,
        uid2,
        createdAt: serverTimestamp(),
      });

      const notifId = generateId('nt');
      batch.set(doc(db, 'users', sender.uid, 'notifications', notifId), {
        id: notifId,
        userId: sender.uid,
        type: 'friend_accept',
        title: 'Friend Request Accepted',
        body: `${receiver.displayName} accepted your friend request.`,
        actorId: receiver.uid,
        actorName: receiver.displayName,
        actorAvatar: receiver.avatarUrl,
        targetType: 'friends',
        targetId: 'all',
        read: false,
        createdAt: serverTimestamp(),
      });
    }

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `friendRequests/${requestId}`);
  }
}

export async function cancelFriendRequest(requestId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'friendRequests', requestId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `friendRequests/${requestId}`);
  }
}

export async function removeFriendship(friendshipId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'friendships', friendshipId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `friendships/${friendshipId}`);
  }
}

export async function markNotificationRead(uid: string, notificationId: string): Promise<void> {
  try {
    await updateDoc(doc(db, 'users', uid, 'notifications', notificationId), {
      read: true,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${uid}/notifications/${notificationId}`);
  }
}

export async function markAllNotificationsRead(uid: string, unreadIds: string[]): Promise<void> {
  if (unreadIds.length === 0) return;
  try {
    const batch = writeBatch(db);
    for (const id of unreadIds.slice(0, 50)) {
      batch.update(doc(db, 'users', uid, 'notifications', id), { read: true });
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${uid}/notifications`);
  }
}

export async function deleteNotification(uid: string, notificationId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'users', uid, 'notifications', notificationId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `users/${uid}/notifications/${notificationId}`);
  }
}

export async function searchPublicUsers(searchText: string): Promise<UserProfile[]> {
  try {
    const q = query(collection(db, 'users'), where('visibility', '==', 'public'), limit(60));
    const snap = await getDocs(q);
    const term = searchText.trim().toLowerCase();
    const list = snap.docs.map((d) => d.data() as UserProfile);
    if (!term) return list;
    return list.filter(
      (u) =>
        u.displayName.toLowerCase().includes(term) ||
        u.username.toLowerCase().includes(term)
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'users');
  }
}

export async function searchPublicGuilds(searchText: string): Promise<Guild[]> {
  try {
    const q = query(collection(db, 'guilds'), where('isPublic', '==', true), limit(50));
    const snap = await getDocs(q);
    const term = searchText.trim().toLowerCase();
    const list = snap.docs.map((d) => d.data() as Guild);
    if (!term) return list;
    return list.filter(
      (g) =>
        g.name.toLowerCase().includes(term) ||
        g.description.toLowerCase().includes(term)
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'guilds');
  }
}
