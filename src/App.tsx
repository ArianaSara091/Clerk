import React, { useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { Compass, Plus, Sparkles, X } from 'lucide-react';
import { auth, db, handleFirestoreError, OperationType } from './lib/firebase';
import {
  AppNotification,
  ChannelMessage,
  DiscordOAuthProfile,
  DmMessage,
  DmThread,
  EMPTY_LINKED_DISCORD,
  FriendRequest,
  Friendship,
  Guild,
  GuildChannel,
  GuildMember,
  GuildRole,
  GuildRoleType,
  PresenceStatus,
  UserGuildLink,
  UserPrivateAccount,
  UserProfile,
  UserSession,
  VoiceParticipant,
} from './types/guildspace';
import { extractInviteCode } from './lib/validation';
import {
  createSessionRecord,
  revokeUserSession,
} from './services/authService';
import {
  assignMemberRole,
  cancelFriendRequest,
  deleteChannelMessage,
  deleteDmMessage,
  deleteNotification,
  editChannelMessage,
  editDmMessage,
  ensureUserProfile,
  joinGuild,
  joinVoiceChannel,
  kickGuildMember,
  leaveGuild,
  leaveVoiceChannel,
  markAllNotificationsRead,
  markNotificationRead,
  openOrCreateDmThread,
  removeFriendship,
  respondToFriendRequest,
  sendChannelMessage,
  sendDmMessage,
  sendFriendRequest,
  toggleChannelMessagePin,
  toggleMessageReaction,
  updatePresenceStatus,
  updateVoiceParticipantState,
} from './services/guildspaceApi';
import { AuthScreen } from './components/AuthScreen';
import { BrandMark } from './components/BrandMark';
import { ChannelSidebar } from './components/ChannelSidebar';
import { ChatArea } from './components/ChatArea';
import { ErrorBoundary } from './components/ErrorBoundary';
import { FriendsAndHomeView } from './components/FriendsAndHomeView';
import {
  ChannelModal,
  CreateOrJoinGuildModal,
  DiscoverGuildsModal,
  GuildSettingsModal,
} from './components/GuildModals';
import { GuildRail } from './components/GuildRail';
import { MembersSidebar } from './components/MembersSidebar';
import { GlobalSearchModal, UserSettingsModal } from './components/UserAndSearchModals';
import { VoiceRoomView } from './components/VoiceRoomView';

function GuildspaceShell() {
  const [authReady, setAuthReady] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [authGatePassed, setAuthGatePassed] = useState(false);
  const [twoFactorPendingUser, setTwoFactorPendingUser] = useState<User | null>(null);
  const [twoFactorEmail, setTwoFactorEmail] = useState('');

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [privateAccount, setPrivateAccount] = useState<UserPrivateAccount | null>(null);
  const [sessions, setSessions] = useState<UserSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [userDirectory, setUserDirectory] = useState<Record<string, UserProfile>>({});

  const authReadyRef = useRef(false);
  const currentSessionIdRef = useRef<string | null>(null);

  const [guildLinks, setGuildLinks] = useState<UserGuildLink[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [incomingRequests, setIncomingRequests] = useState<FriendRequest[]>([]);
  const [outgoingRequests, setOutgoingRequests] = useState<FriendRequest[]>([]);
  const [friendships, setFriendships] = useState<Friendship[]>([]);
  const [dmThreads, setDmThreads] = useState<DmThread[]>([]);

  // Active Navigation State
  const [activeScope, setActiveScope] = useState<'home' | 'guild'>('home');
  const [homeSection, setHomeSection] = useState<'friends' | 'notifications' | 'dm'>('friends');
  const [activeGuildId, setActiveGuildId] = useState<string | null>(null);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [activeDmThreadId, setActiveDmThreadId] = useState<string | null>(null);

  // Active Guild Data
  const [activeGuild, setActiveGuild] = useState<Guild | null>(null);
  const [channels, setChannels] = useState<GuildChannel[]>([]);
  const [members, setMembers] = useState<GuildMember[]>([]);
  const [roles, setRoles] = useState<GuildRole[]>([]);
  const [channelMessages, setChannelMessages] = useState<ChannelMessage[]>([]);
  const [dmMessages, setDmMessages] = useState<DmMessage[]>([]);

  // Voice Channel State
  const [voiceParticipantsByChannel, setVoiceParticipantsByChannel] = useState<
    Record<string, VoiceParticipant[]>
  >({});
  const [activeVoiceGuildId, setActiveVoiceGuildId] = useState<string | null>(null);
  const [activeVoiceChannelId, setActiveVoiceChannelId] = useState<string | null>(null);
  const [voiceMuted, setVoiceMuted] = useState(false);
  const [voiceDeafened, setVoiceDeafened] = useState(false);
  const [micAvailable, setMicAvailable] = useState(false);

  const activeVoiceRef = useRef<{ guildId: string; channelId: string; uid: string } | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const speakingIntervalRef = useRef<number | null>(null);
  const lastSpeakingSentRef = useRef(false);
  const voiceFlagsRef = useRef({ muted: false, deafened: false });

  // UI Drawers & Modals
  const [showMembersSidebar, setShowMembersSidebar] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);

  const [pendingInviteCode, setPendingInviteCode] = useState<string>(() => {
    const raw = new URLSearchParams(window.location.search).get('invite');
    return raw ? extractInviteCode(raw) : '';
  });
  const [createGuildModalState, setCreateGuildModalState] = useState<{
    open: boolean;
    initialTab: 'create' | 'join';
    initialInviteCode: string;
  }>({ open: false, initialTab: 'create', initialInviteCode: '' });
  const [showDiscoverModal, setShowDiscoverModal] = useState(false);
  const [showGuildSettingsModal, setShowGuildSettingsModal] = useState(false);
  const [showUserSettingsModal, setShowUserSettingsModal] = useState(false);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [channelModalState, setChannelModalState] = useState<{
    open: boolean;
    editing: GuildChannel | null;
  }>({ open: false, editing: null });

  // 1. Auth Listener & Initial Persisted Session Restoration
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);

      if (!user) {
        currentSessionIdRef.current = null;
        setCurrentSessionId(null);
        setSessions([]);
        setProfile(null);
        setPrivateAccount(null);
        setAuthGatePassed(false);
        setTwoFactorPendingUser(null);
        setTwoFactorEmail('');
        authReadyRef.current = true;
        setAuthReady(true);
        return;
      }

      // Restore persisted authenticated session on cold page load
      if (!authReadyRef.current) {
        try {
          const ensured = await ensureUserProfile(user);
          if (ensured.isVerified || user.emailVerified) {
            if (!currentSessionIdRef.current) {
              const sesId = await createSessionRecord(user.uid, true);
              currentSessionIdRef.current = sesId;
              setCurrentSessionId(sesId);
            }
            setProfile(ensured);
            setAuthGatePassed(true);
          } else {
            setProfile(null);
            setAuthGatePassed(false);
          }
        } catch (err) {
          console.error('Profile bootstrap failed:', err);
          setProfile(null);
          setAuthGatePassed(false);
        } finally {
          authReadyRef.current = true;
          setAuthReady(true);
        }
      }
    });
    return unsub;
  }, []);

  // Global Ctrl+K / Cmd+K search shortcut
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShowSearchModal((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const isVerifiedAuth = Boolean(firebaseUser && authGatePassed && profile);
  const uid = firebaseUser?.uid || null;

  // Open Join Server modal automatically when landing via ?invite=CODE
  useEffect(() => {
    if (!isVerifiedAuth || !pendingInviteCode) return;
    setCreateGuildModalState({
      open: true,
      initialTab: 'join',
      initialInviteCode: pendingInviteCode,
    });
    setPendingInviteCode('');
    window.history.replaceState({}, document.title, window.location.pathname);
  }, [isVerifiedAuth, pendingInviteCode]);

  // 2. Core User Listeners (Profile, Private Account, Sessions, Directory, Guild Links, Notifications, Friends, DMs)
  useEffect(() => {
    if (!isVerifiedAuth || !uid) return;

    const unsubProfile = onSnapshot(
      doc(db, 'users', uid),
      (snap) => {
        if (snap.exists()) setProfile(snap.data() as UserProfile);
      },
      (err) => handleFirestoreError(err, OperationType.GET, `users/${uid}`)
    );

    const unsubPrivate = onSnapshot(
      doc(db, 'users', uid, 'private', 'account'),
      (snap) => {
        if (snap.exists()) setPrivateAccount(snap.data() as UserPrivateAccount);
      },
      (err) => handleFirestoreError(err, OperationType.GET, `users/${uid}/private/account`)
    );

    const unsubDirectory = onSnapshot(
      query(collection(db, 'users'), where('visibility', '==', 'public'), limit(120)),
      (snap) => {
        const next: Record<string, UserProfile> = {};
        for (const d of snap.docs) {
          const u = d.data() as UserProfile;
          next[u.uid] = u;
        }
        setUserDirectory(next);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'users')
    );

    const unsubGuildLinks = onSnapshot(
      collection(db, 'users', uid, 'guildLinks'),
      (snap) => {
        const list = snap.docs.map((d) => d.data() as UserGuildLink);
        list.sort((a, b) => (a.joinedAt?.toMillis() || 0) - (b.joinedAt?.toMillis() || 0));
        setGuildLinks(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `users/${uid}/guildLinks`)
    );

    const unsubNotifs = onSnapshot(
      query(collection(db, 'users', uid, 'notifications'), orderBy('createdAt', 'desc'), limit(40)),
      (snap) => {
        setNotifications(snap.docs.map((d) => d.data() as AppNotification));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `users/${uid}/notifications`)
    );

    const unsubIncoming = onSnapshot(
      query(collection(db, 'friendRequests'), where('toId', '==', uid)),
      (snap) => {
        setIncomingRequests(
          snap.docs
            .map((d) => d.data() as FriendRequest)
            .filter((r) => r.status === 'pending')
        );
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'friendRequests')
    );

    const unsubOutgoing = onSnapshot(
      query(collection(db, 'friendRequests'), where('fromId', '==', uid)),
      (snap) => {
        setOutgoingRequests(
          snap.docs
            .map((d) => d.data() as FriendRequest)
            .filter((r) => r.status === 'pending')
        );
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'friendRequests')
    );

    const unsubFriendships = onSnapshot(
      query(collection(db, 'friendships'), where('participants', 'array-contains', uid)),
      (snap) => {
        setFriendships(snap.docs.map((d) => d.data() as Friendship));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'friendships')
    );

    const unsubDms = onSnapshot(
      query(collection(db, 'dmThreads'), where('participants', 'array-contains', uid)),
      (snap) => {
        const threads = snap.docs.map((d) => d.data() as DmThread);
        threads.sort((a, b) => (b.lastMessageAt?.toMillis() || 0) - (a.lastMessageAt?.toMillis() || 0));
        setDmThreads(threads);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'dmThreads')
    );

    const unsubSessions = onSnapshot(
      collection(db, 'users', uid, 'sessions'),
      (snap) => {
        const list = snap.docs.map((d) => d.data() as UserSession);
        list.sort((a, b) => (b.lastActiveAt?.toMillis() || 0) - (a.lastActiveAt?.toMillis() || 0));
        setSessions(list);

        const activeSesId = currentSessionIdRef.current;
        if (activeSesId) {
          const mine = list.find((s) => s.id === activeSesId);
          if (mine && mine.revoked) {
            currentSessionIdRef.current = null;
            setCurrentSessionId(null);
            setAuthGatePassed(false);
            void signOut(auth);
          }
        }
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `users/${uid}/sessions`)
    );

    return () => {
      unsubProfile();
      unsubPrivate();
      unsubDirectory();
      unsubGuildLinks();
      unsubNotifs();
      unsubIncoming();
      unsubOutgoing();
      unsubFriendships();
      unsubDms();
      unsubSessions();
    };
  }, [isVerifiedAuth, uid]);

  // 3. Active Guild Subcollection Listeners
  useEffect(() => {
    if (!isVerifiedAuth || !uid || !activeGuildId) {
      setActiveGuild(null);
      setChannels([]);
      setMembers([]);
      setRoles([]);
      return;
    }

    const unsubGuild = onSnapshot(
      doc(db, 'guilds', activeGuildId),
      (snap) => {
        setActiveGuild(snap.exists() ? (snap.data() as Guild) : null);
      },
      (err) => handleFirestoreError(err, OperationType.GET, `guilds/${activeGuildId}`)
    );

    const unsubChannels = onSnapshot(
      collection(db, 'guilds', activeGuildId, 'channels'),
      (snap) => {
        const list = snap.docs.map((d) => d.data() as GuildChannel);
        list.sort((a, b) => a.position - b.position);
        setChannels(list);
        setActiveChannelId((prev) => {
          if (prev && list.some((c) => c.id === prev)) return prev;
          return list[0]?.id || null;
        });
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `guilds/${activeGuildId}/channels`)
    );

    const unsubMembers = onSnapshot(
      collection(db, 'guilds', activeGuildId, 'members'),
      (snap) => {
        setMembers(snap.docs.map((d) => d.data() as GuildMember));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `guilds/${activeGuildId}/members`)
    );

    const unsubRoles = onSnapshot(
      collection(db, 'guilds', activeGuildId, 'roles'),
      (snap) => {
        const list = snap.docs.map((d) => d.data() as GuildRole);
        list.sort((a, b) => a.position - b.position);
        setRoles(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `guilds/${activeGuildId}/roles`)
    );

    return () => {
      unsubGuild();
      unsubChannels();
      unsubMembers();
      unsubRoles();
    };
  }, [isVerifiedAuth, uid, activeGuildId]);

  // 4. Active Channel Messages Listener
  useEffect(() => {
    if (!isVerifiedAuth || activeScope !== 'guild' || !activeGuildId || !activeChannelId) {
      setChannelMessages([]);
      return;
    }

    const path = `guilds/${activeGuildId}/channels/${activeChannelId}/messages`;
    const q = query(collection(db, path), orderBy('createdAt', 'asc'), limit(150));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setChannelMessages(snap.docs.map((d) => d.data() as ChannelMessage));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, path)
    );

    return unsub;
  }, [isVerifiedAuth, activeScope, activeGuildId, activeChannelId]);

  // 5. Active DM Messages Listener
  useEffect(() => {
    if (!isVerifiedAuth || activeScope !== 'home' || homeSection !== 'dm' || !activeDmThreadId) {
      setDmMessages([]);
      return;
    }

    const path = `dmThreads/${activeDmThreadId}/messages`;
    const q = query(collection(db, path), orderBy('createdAt', 'asc'), limit(150));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setDmMessages(snap.docs.map((d) => d.data() as DmMessage));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, path)
    );

    return unsub;
  }, [isVerifiedAuth, activeScope, homeSection, activeDmThreadId]);

  // 6. Voice Participants Listeners for Voice Channels in Active Guild
  const voiceChannelIdsKey = useMemo(
    () =>
      channels
        .filter((c) => c.type === 'voice')
        .map((c) => c.id)
        .join('|'),
    [channels]
  );

  useEffect(() => {
    if (!isVerifiedAuth || !activeGuildId || !voiceChannelIdsKey) {
      setVoiceParticipantsByChannel({});
      return;
    }

    const ids = voiceChannelIdsKey.split('|').filter(Boolean);
    const unsubs = ids.map((chId) =>
      onSnapshot(
        collection(db, 'guilds', activeGuildId, 'channels', chId, 'voiceParticipants'),
        (snap) => {
          const list = snap.docs.map((d) => d.data() as VoiceParticipant);
          list.sort((a, b) => (a.joinedAt?.toMillis() || 0) - (b.joinedAt?.toMillis() || 0));
          setVoiceParticipantsByChannel((prev) => ({
            ...prev,
            [chId]: list,
          }));
        },
        (err) =>
          handleFirestoreError(
            err,
            OperationType.LIST,
            `guilds/${activeGuildId}/channels/${chId}/voiceParticipants`
          )
      )
    );

    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [isVerifiedAuth, activeGuildId, voiceChannelIdsKey]);

  const cleanupLocalAudio = () => {
    if (speakingIntervalRef.current !== null) {
      window.clearInterval(speakingIntervalRef.current);
      speakingIntervalRef.current = null;
    }
    if (mediaStreamRef.current) {
      for (const track of mediaStreamRef.current.getTracks()) {
        track.stop();
      }
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current) {
      void audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    lastSpeakingSentRef.current = false;
  };

  useEffect(() => {
    const onBeforeUnload = () => {
      cleanupLocalAudio();
      const active = activeVoiceRef.current;
      if (active) {
        void leaveVoiceChannel(active.guildId, active.channelId, active.uid);
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      cleanupLocalAudio();
      const active = activeVoiceRef.current;
      if (active) {
        void leaveVoiceChannel(active.guildId, active.channelId, active.uid);
      }
    };
  }, []);

  const myMembership = useMemo(
    () => members.find((m) => m.uid === uid),
    [members, uid]
  );

  const joinedGuildIds = useMemo(
    () => new Set(guildLinks.map((g) => g.guildId)),
    [guildLinks]
  );

  const friendUids = useMemo(() => {
    const set = new Set<string>();
    if (!uid) return set;
    for (const f of friendships) {
      set.add(f.uid1 === uid ? f.uid2 : f.uid1);
    }
    return set;
  }, [friendships, uid]);

  const activeChannel = useMemo(
    () => channels.find((c) => c.id === activeChannelId) || null,
    [channels, activeChannelId]
  );

  const activeDmThread = useMemo(
    () => dmThreads.find((t) => t.id === activeDmThreadId) || null,
    [dmThreads, activeDmThreadId]
  );

  const activeDmPartner = useMemo(() => {
    if (!activeDmThread || !uid) return null;
    const isP1Me = activeDmThread.p1Uid === uid;
    const partnerUid = isP1Me ? activeDmThread.p2Uid : activeDmThread.p1Uid;
    return (
      userDirectory[partnerUid] || {
        uid: partnerUid,
        displayName: isP1Me ? activeDmThread.p2Name : activeDmThread.p1Name,
        username: isP1Me ? activeDmThread.p2Username : activeDmThread.p1Username,
        avatarUrl: isP1Me ? activeDmThread.p2Avatar : activeDmThread.p1Avatar,
        bio: '',
        accentColor: '#7C3AED',
        status: 'offline' as PresenceStatus,
        customStatus: '',
        isVerified: true,
        twoFactorEnabled: false,
        linkedDiscord: EMPTY_LINKED_DISCORD,
        visibility: 'public' as const,
        lastSeenAt: null,
        createdAt: null,
        updatedAt: null,
      }
    );
  }, [activeDmThread, uid, userDirectory]);

  const activeVoiceChannelName = useMemo(() => {
    if (!activeVoiceChannelId) return null;
    return channels.find((c) => c.id === activeVoiceChannelId)?.name || 'Voice Lounge';
  }, [channels, activeVoiceChannelId]);

  const handleLeaveVoice = async () => {
    cleanupLocalAudio();
    const prev = activeVoiceRef.current;
    activeVoiceRef.current = null;
    voiceFlagsRef.current = { muted: false, deafened: false };
    setActiveVoiceGuildId(null);
    setActiveVoiceChannelId(null);
    setVoiceMuted(false);
    setVoiceDeafened(false);
    setMicAvailable(false);
    if (prev) {
      await leaveVoiceChannel(prev.guildId, prev.channelId, prev.uid);
    }
  };

  const handleJoinVoice = async (guildId: string, channelId: string) => {
    if (!profile) return;
    if (activeVoiceRef.current) {
      await handleLeaveVoice();
    }

    let hasMic = false;
    try {
      if (navigator.mediaDevices?.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaStreamRef.current = stream;
        hasMic = stream.getAudioTracks().length > 0;

        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (AudioCtx && hasMic) {
          const ctx = new AudioCtx();
          audioContextRef.current = ctx;
          const source = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          source.connect(analyser);
          const data = new Uint8Array(analyser.frequencyBinCount);

          speakingIntervalRef.current = window.setInterval(() => {
            const flags = voiceFlagsRef.current;
            const current = activeVoiceRef.current;
            if (!current) return;
            if (flags.muted || flags.deafened) {
              if (lastSpeakingSentRef.current) {
                lastSpeakingSentRef.current = false;
                void updateVoiceParticipantState(current.guildId, current.channelId, current.uid, {
                  speaking: false,
                });
              }
              return;
            }
            analyser.getByteFrequencyData(data);
            let sum = 0;
            for (let i = 0; i < data.length; i += 1) {
              sum += data[i];
            }
            const avg = data.length > 0 ? sum / data.length : 0;
            const isSpeaking = avg > 18;
            if (isSpeaking !== lastSpeakingSentRef.current) {
              lastSpeakingSentRef.current = isSpeaking;
              void updateVoiceParticipantState(current.guildId, current.channelId, current.uid, {
                speaking: isSpeaking,
              });
            }
          }, 260);
        }
      }
    } catch {
      hasMic = false;
    }

    const initialMuted = !hasMic;
    voiceFlagsRef.current = { muted: initialMuted, deafened: false };
    activeVoiceRef.current = { guildId, channelId, uid: profile.uid };
    setMicAvailable(hasMic);
    setVoiceMuted(initialMuted);
    setVoiceDeafened(false);
    setActiveVoiceGuildId(guildId);
    setActiveVoiceChannelId(channelId);

    await joinVoiceChannel(guildId, channelId, profile, {
      muted: initialMuted,
      deafened: false,
      speaking: false,
    });
  };

  const handleToggleVoiceMute = () => {
    const nextMuted = !voiceMuted;
    const nextDeafened = nextMuted ? voiceDeafened : false;
    voiceFlagsRef.current = { muted: nextMuted, deafened: nextDeafened };
    setVoiceMuted(nextMuted);
    if (!nextMuted && voiceDeafened) {
      setVoiceDeafened(false);
    }
    if (mediaStreamRef.current) {
      for (const track of mediaStreamRef.current.getAudioTracks()) {
        track.enabled = !nextMuted && !nextDeafened;
      }
    }
    const active = activeVoiceRef.current;
    if (active) {
      lastSpeakingSentRef.current = false;
      void updateVoiceParticipantState(active.guildId, active.channelId, active.uid, {
        muted: nextMuted,
        deafened: nextDeafened,
        speaking: false,
      });
    }
  };

  const handleToggleVoiceDeafen = () => {
    const nextDeafened = !voiceDeafened;
    const nextMuted = nextDeafened ? true : !micAvailable;
    voiceFlagsRef.current = { muted: nextMuted, deafened: nextDeafened };
    setVoiceDeafened(nextDeafened);
    setVoiceMuted(nextMuted);
    if (mediaStreamRef.current) {
      for (const track of mediaStreamRef.current.getAudioTracks()) {
        track.enabled = !nextMuted && !nextDeafened;
      }
    }
    const active = activeVoiceRef.current;
    if (active) {
      lastSpeakingSentRef.current = false;
      void updateVoiceParticipantState(active.guildId, active.channelId, active.uid, {
        muted: nextMuted,
        deafened: nextDeafened,
        speaking: false,
      });
    }
  };

  const unreadNotificationsCount = notifications.filter((n) => !n.read).length;

  const handleStartDm = async (partner: UserProfile) => {
    if (!profile) return;
    const threadId = await openOrCreateDmThread(profile, partner);
    setActiveScope('home');
    setHomeSection('dm');
    setActiveDmThreadId(threadId);
    setMobileMenuOpen(false);
  };

  const handleSelectGuild = (guildId: string) => {
    setActiveScope('guild');
    setActiveGuildId(guildId);
    setMobileMenuOpen(false);
  };

  const handleAuthCompleted = async ({
    user,
    rememberMe,
    dateOfBirth,
    preferredUsername,
    otpVerified,
    discordProfile,
    importDiscordUsername,
    importDiscordAvatar,
  }: {
    user: User;
    rememberMe: boolean;
    dateOfBirth?: string;
    preferredUsername?: string;
    otpVerified?: boolean;
    discordProfile?: DiscordOAuthProfile;
    importDiscordUsername?: boolean;
    importDiscordAvatar?: boolean;
  }) => {
    const ensured = await ensureUserProfile(user, {
      preferredDisplayName: preferredUsername,
      preferredUsername,
      dateOfBirth,
      isVerified: Boolean(otpVerified || user.emailVerified),
      discordProfile,
      importDiscordUsername,
      importDiscordAvatar,
    });

    if (!ensured.isVerified && !user.emailVerified) {
      await signOut(auth);
      throw new Error('Your account email is not verified yet. Please register or verify your email first.');
    }

    if (ensured.twoFactorEnabled && twoFactorPendingUser?.uid !== user.uid) {
      setTwoFactorPendingUser(user);
      setTwoFactorEmail(user.email || '');
      return;
    }

    const sesId = await createSessionRecord(user.uid, rememberMe);
    currentSessionIdRef.current = sesId;
    setCurrentSessionId(sesId);
    setTwoFactorPendingUser(null);
    setTwoFactorEmail('');
    setFirebaseUser(user);
    setProfile(ensured);
    setAuthGatePassed(true);
  };

  const handleCancelTwoFactor = async () => {
    setTwoFactorPendingUser(null);
    setTwoFactorEmail('');
    setAuthGatePassed(false);
    await signOut(auth);
  };

  const handleSignOut = async () => {
    await handleLeaveVoice();
    const sesId = currentSessionIdRef.current;
    if (profile) {
      try {
        await updatePresenceStatus(profile.uid, 'offline');
      } catch {
        // Ignore presence update failure on sign-out
      }
      if (sesId) {
        try {
          await revokeUserSession(profile.uid, sesId);
        } catch {
          // Ignore session revocation failure on sign-out
        }
      }
    }
    currentSessionIdRef.current = null;
    setCurrentSessionId(null);
    setAuthGatePassed(false);
    setTwoFactorPendingUser(null);
    setTwoFactorEmail('');
    await signOut(auth);
  };

  const handleNavigateNotification = (notif: AppNotification) => {
    if (notif.targetType === 'friends') {
      setActiveScope('home');
      setHomeSection('friends');
    } else if (notif.targetType === 'dm') {
      setActiveScope('home');
      setHomeSection('dm');
      setActiveDmThreadId(notif.targetId);
    } else if (notif.targetType === 'guild') {
      const [gId, chId] = notif.targetId.split('/');
      if (gId) {
        setActiveScope('guild');
        setActiveGuildId(gId);
        if (chId) setActiveChannelId(chId);
      }
    }
    setMobileMenuOpen(false);
  };

  const handleJumpToMessage = (messageId: string) => {
    setHighlightedMessageId(messageId);
    setTimeout(() => setHighlightedMessageId(null), 2600);
  };

  if (!authReady) {
    return (
      <div className="min-h-screen bg-[#0A0C12] flex flex-col items-center justify-center gap-3 text-slate-300">
        <BrandMark size={40} />
        <p className="text-sm font-medium">Loading Clerk...</p>
      </div>
    );
  }

  if (!firebaseUser || !authGatePassed || !profile || twoFactorPendingUser) {
    return (
      <AuthScreen
        twoFactorPendingUser={twoFactorPendingUser}
        twoFactorEmail={twoFactorEmail}
        onAuthCompleted={handleAuthCompleted}
        onCancelTwoFactor={handleCancelTwoFactor}
      />
    );
  }

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#0B0D14] text-slate-100 flex">
      {/* Desktop Left Navigation Rails */}
      <div className="hidden md:flex h-full shrink-0">
        <GuildRail
          guildLinks={guildLinks}
          activeScope={activeScope}
          activeGuildId={activeGuildId}
          unreadNotificationsCount={unreadNotificationsCount}
          pendingFriendRequestsCount={incomingRequests.length}
          onSelectHome={() => {
            setActiveScope('home');
            setMobileMenuOpen(false);
          }}
          onSelectGuild={handleSelectGuild}
          onOpenCreateGuild={() =>
            setCreateGuildModalState({ open: true, initialTab: 'create', initialInviteCode: '' })
          }
          onOpenDiscover={() => setShowDiscoverModal(true)}
        />

        <ChannelSidebar
          profile={profile}
          userDirectory={userDirectory}
          activeScope={activeScope}
          homeSection={homeSection}
          activeDmThreadId={activeDmThreadId}
          dmThreads={dmThreads}
          activeGuild={activeGuild}
          channels={channels}
          activeChannelId={activeChannelId}
          myMembership={myMembership}
          unreadNotificationsCount={unreadNotificationsCount}
          pendingFriendRequestsCount={incomingRequests.length}
          voiceParticipantsByChannel={voiceParticipantsByChannel}
          activeVoiceChannelId={activeVoiceChannelId}
          activeVoiceChannelName={activeVoiceChannelName}
          voiceMuted={voiceMuted}
          voiceDeafened={voiceDeafened}
          onSelectHomeSection={(section) => {
            setActiveScope('home');
            setHomeSection(section);
          }}
          onSelectDmThread={(threadId) => {
            setActiveScope('home');
            setHomeSection('dm');
            setActiveDmThreadId(threadId);
          }}
          onSelectChannel={(ch) => {
            setActiveChannelId(ch.id);
            if (ch.type === 'voice' && activeGuild && activeVoiceChannelId !== ch.id) {
              void handleJoinVoice(activeGuild.id, ch.id);
            }
          }}
          onToggleVoiceMute={handleToggleVoiceMute}
          onToggleVoiceDeafen={handleToggleVoiceDeafen}
          onLeaveVoice={() => void handleLeaveVoice()}
          onOpenCreateChannel={() => setChannelModalState({ open: true, editing: null })}
          onOpenEditChannel={(ch) => setChannelModalState({ open: true, editing: ch })}
          onOpenGuildSettings={() => setShowGuildSettingsModal(true)}
          onLeaveGuild={async () => {
            if (!activeGuild) return;
            if (activeVoiceGuildId === activeGuild.id) {
              await handleLeaveVoice();
            }
            await leaveGuild(profile.uid, activeGuild.id);
            setActiveScope('home');
            setActiveGuildId(null);
            setActiveChannelId(null);
          }}
          onOpenUserSettings={() => setShowUserSettingsModal(true)}
          onChangeStatus={(st) => void updatePresenceStatus(profile.uid, st)}
          onSignOut={() => void handleSignOut()}
          onOpenSearch={() => setShowSearchModal(true)}
        />
      </div>

      {/* Mobile Slide-Over Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 md:hidden flex">
          <div className="flex h-full shadow-2xl">
            <GuildRail
              guildLinks={guildLinks}
              activeScope={activeScope}
              activeGuildId={activeGuildId}
              unreadNotificationsCount={unreadNotificationsCount}
              pendingFriendRequestsCount={incomingRequests.length}
              onSelectHome={() => {
                setActiveScope('home');
                setMobileMenuOpen(false);
              }}
              onSelectGuild={handleSelectGuild}
              onOpenCreateGuild={() => {
                setMobileMenuOpen(false);
                setCreateGuildModalState({ open: true, initialTab: 'create', initialInviteCode: '' });
              }}
              onOpenDiscover={() => {
                setMobileMenuOpen(false);
                setShowDiscoverModal(true);
              }}
            />
            <ChannelSidebar
              profile={profile}
              userDirectory={userDirectory}
              activeScope={activeScope}
              homeSection={homeSection}
              activeDmThreadId={activeDmThreadId}
              dmThreads={dmThreads}
              activeGuild={activeGuild}
              channels={channels}
              activeChannelId={activeChannelId}
              myMembership={myMembership}
              unreadNotificationsCount={unreadNotificationsCount}
              pendingFriendRequestsCount={incomingRequests.length}
              voiceParticipantsByChannel={voiceParticipantsByChannel}
              activeVoiceChannelId={activeVoiceChannelId}
              activeVoiceChannelName={activeVoiceChannelName}
              voiceMuted={voiceMuted}
              voiceDeafened={voiceDeafened}
              onSelectHomeSection={(section) => {
                setActiveScope('home');
                setHomeSection(section);
                setMobileMenuOpen(false);
              }}
              onSelectDmThread={(threadId) => {
                setActiveScope('home');
                setHomeSection('dm');
                setActiveDmThreadId(threadId);
                setMobileMenuOpen(false);
              }}
              onSelectChannel={(ch) => {
                setActiveChannelId(ch.id);
                if (ch.type === 'voice' && activeGuild && activeVoiceChannelId !== ch.id) {
                  void handleJoinVoice(activeGuild.id, ch.id);
                }
                setMobileMenuOpen(false);
              }}
              onToggleVoiceMute={handleToggleVoiceMute}
              onToggleVoiceDeafen={handleToggleVoiceDeafen}
              onLeaveVoice={() => void handleLeaveVoice()}
              onOpenCreateChannel={() => {
                setMobileMenuOpen(false);
                setChannelModalState({ open: true, editing: null });
              }}
              onOpenEditChannel={(ch) => {
                setMobileMenuOpen(false);
                setChannelModalState({ open: true, editing: ch });
              }}
              onOpenGuildSettings={() => {
                setMobileMenuOpen(false);
                setShowGuildSettingsModal(true);
              }}
              onLeaveGuild={async () => {
                if (!activeGuild) return;
                if (activeVoiceGuildId === activeGuild.id) {
                  await handleLeaveVoice();
                }
                await leaveGuild(profile.uid, activeGuild.id);
                setActiveScope('home');
                setActiveGuildId(null);
                setMobileMenuOpen(false);
              }}
              onOpenUserSettings={() => {
                setMobileMenuOpen(false);
                setShowUserSettingsModal(true);
              }}
              onChangeStatus={(st) => void updatePresenceStatus(profile.uid, st)}
              onSignOut={() => void handleSignOut()}
              onOpenSearch={() => {
                setMobileMenuOpen(false);
                setShowSearchModal(true);
              }}
            />
          </div>
          <div
            className="flex-1 bg-black/60 backdrop-blur-xs relative"
            onClick={() => setMobileMenuOpen(false)}
          >
            <button
              type="button"
              onClick={() => setMobileMenuOpen(false)}
              aria-label="Close navigation"
              className="absolute top-3 right-3 p-2 rounded-full bg-[#151823] text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      {activeScope === 'guild' && activeGuild && activeChannel ? (
        <>
          {activeChannel.type === 'voice' ? (
            <VoiceRoomView
              profile={profile}
              userDirectory={userDirectory}
              guild={activeGuild}
              channel={activeChannel}
              participants={voiceParticipantsByChannel[activeChannel.id] || []}
              isConnectedHere={activeVoiceChannelId === activeChannel.id}
              muted={voiceMuted}
              deafened={voiceDeafened}
              micAvailable={micAvailable}
              messages={channelMessages}
              unreadNotificationsCount={unreadNotificationsCount}
              showMembersSidebar={showMembersSidebar}
              onJoinVoice={() => handleJoinVoice(activeGuild.id, activeChannel.id)}
              onLeaveVoice={handleLeaveVoice}
              onToggleMute={handleToggleVoiceMute}
              onToggleDeafen={handleToggleVoiceDeafen}
              onSendMessage={async (content) => {
                await sendChannelMessage({
                  guild: activeGuild,
                  channelId: activeChannel.id,
                  channelName: activeChannel.name,
                  author: profile,
                  authorMembership: myMembership,
                  content,
                  guildMembers: members,
                });
              }}
              onToggleMembersSidebar={() => setShowMembersSidebar((prev) => !prev)}
              onOpenMobileMenu={() => setMobileMenuOpen(true)}
              onOpenSearch={() => setShowSearchModal(true)}
              onOpenNotifications={() => {
                setActiveScope('home');
                setHomeSection('notifications');
              }}
            />
          ) : (
            <ChatArea
              mode="channel"
              profile={profile}
              userDirectory={userDirectory}
              guild={activeGuild}
              channel={activeChannel}
              guildMembers={members}
              myMembership={myMembership}
              messages={channelMessages}
              unreadNotificationsCount={unreadNotificationsCount}
              showMembersSidebar={showMembersSidebar}
              highlightedMessageId={highlightedMessageId}
              onToggleMembersSidebar={() => setShowMembersSidebar((prev) => !prev)}
              onOpenMobileMenu={() => setMobileMenuOpen(true)}
              onOpenSearch={() => setShowSearchModal(true)}
              onOpenNotifications={() => {
                setActiveScope('home');
                setHomeSection('notifications');
              }}
              onSendMessage={async ({ content, attachment, replyTo }) => {
                await sendChannelMessage({
                  guild: activeGuild,
                  channelId: activeChannel.id,
                  channelName: activeChannel.name,
                  author: profile,
                  authorMembership: myMembership,
                  content,
                  attachment,
                  replyTo,
                  guildMembers: members,
                });
              }}
              onEditMessage={(msgId, content) =>
                editChannelMessage(activeGuild.id, activeChannel.id, msgId, content)
              }
              onDeleteMessage={(msgId) =>
                deleteChannelMessage(activeGuild.id, activeChannel.id, msgId)
              }
              onTogglePin={(msgId, pinned) =>
                toggleChannelMessagePin(activeGuild.id, activeChannel.id, msgId, pinned)
              }
              onToggleReaction={(msgId, tokens, emoji) =>
                toggleMessageReaction(
                  {
                    kind: 'channel',
                    guildId: activeGuild.id,
                    channelId: activeChannel.id,
                    messageId: msgId,
                  },
                  tokens,
                  emoji,
                  profile.uid
                )
              }
            />
          )}

          {showMembersSidebar && (
            <div className="hidden lg:flex h-full shrink-0">
              <MembersSidebar
                guild={activeGuild}
                members={members}
                roles={roles}
                userDirectory={userDirectory}
                currentUid={profile.uid}
                myMembership={myMembership}
                friendUids={friendUids}
                onStartDm={(target) => void handleStartDm(target)}
                onAddFriend={(target) => void sendFriendRequest(profile, target)}
                onAssignRole={(targetUid, nextRole, customRole) =>
                  void assignMemberRole(profile, activeGuild, targetUid, nextRole as GuildRoleType, customRole)
                }
                onKickMember={(targetUid) => void kickGuildMember(activeGuild.id, targetUid)}
              />
            </div>
          )}
        </>
      ) : activeScope === 'guild' && activeGuild && !activeChannel ? (
        <main className="flex-1 flex flex-col items-center justify-center p-6 bg-[#131622] text-center space-y-4">
          <Sparkles className="w-8 h-8 text-violet-400" />
          <div className="space-y-1">
            <h2 className="text-lg font-bold font-display text-white">No Channels Yet</h2>
            <p className="text-xs text-slate-400">
              Create a text or voice channel to start hanging out in {activeGuild.name}.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setChannelModalState({ open: true, editing: null })}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 text-white text-xs font-semibold"
          >
            <Plus className="w-4 h-4" /> Create Channel
          </button>
        </main>
      ) : activeScope === 'home' && homeSection === 'dm' && activeDmThread && activeDmPartner ? (
        <ChatArea
          mode="dm"
          profile={profile}
          userDirectory={userDirectory}
          dmThread={activeDmThread}
          dmPartner={activeDmPartner}
          messages={dmMessages}
          unreadNotificationsCount={unreadNotificationsCount}
          showMembersSidebar={false}
          highlightedMessageId={highlightedMessageId}
          onToggleMembersSidebar={() => {}}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
          onOpenSearch={() => setShowSearchModal(true)}
          onOpenNotifications={() => setHomeSection('notifications')}
          onSendMessage={async ({ content, attachment }) => {
            await sendDmMessage({
              threadId: activeDmThread.id,
              author: profile,
              recipientUid: activeDmPartner.uid,
              content,
              attachment,
            });
          }}
          onEditMessage={(msgId, content) => editDmMessage(activeDmThread.id, msgId, content)}
          onDeleteMessage={(msgId) => deleteDmMessage(activeDmThread.id, msgId)}
          onToggleReaction={(msgId, tokens, emoji) =>
            toggleMessageReaction(
              { kind: 'dm', threadId: activeDmThread.id, messageId: msgId },
              tokens,
              emoji,
              profile.uid
            )
          }
        />
      ) : (
        <div className="flex-1 min-w-0 flex flex-col h-full">
          {guildLinks.length === 0 && homeSection === 'friends' && (
            <div className="px-6 py-3 bg-gradient-to-r from-violet-600/15 via-indigo-600/10 to-blue-600/15 border-b border-white/[0.06] flex flex-wrap items-center justify-between gap-3 shrink-0">
              <div className="text-xs text-slate-200">
                <strong className="text-white">Welcome to Clerk!</strong> Create your own server, join via invitation link, or explore public servers.
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setCreateGuildModalState({ open: true, initialTab: 'create', initialInviteCode: '' })
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold"
                >
                  <Plus className="w-3.5 h-3.5" /> Create Server
                </button>
                <button
                  type="button"
                  onClick={() => setShowDiscoverModal(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600/25 hover:bg-blue-600/40 text-blue-200 text-xs font-semibold"
                >
                  <Compass className="w-3.5 h-3.5" /> Explore
                </button>
              </div>
            </div>
          )}

          <FriendsAndHomeView
            section={homeSection === 'notifications' ? 'notifications' : 'friends'}
            profile={profile}
            userDirectory={userDirectory}
            friendships={friendships}
            incomingRequests={incomingRequests}
            outgoingRequests={outgoingRequests}
            notifications={notifications}
            onOpenMobileMenu={() => setMobileMenuOpen(true)}
            onOpenSearch={() => setShowSearchModal(true)}
            onStartDm={(partner) => void handleStartDm(partner)}
            onSendFriendRequest={(target) => sendFriendRequest(profile, target)}
            onRespondFriendRequest={(req, decision) =>
              respondToFriendRequest(
                { uid: req.fromId, displayName: req.fromName, avatarUrl: req.fromAvatar },
                profile,
                req.id,
                decision
              )
            }
            onCancelFriendRequest={(requestId) => cancelFriendRequest(requestId)}
            onRemoveFriend={(friendshipId) => removeFriendship(friendshipId)}
            onMarkNotificationRead={(id) => markNotificationRead(profile.uid, id)}
            onMarkAllNotificationsRead={() =>
              markAllNotificationsRead(
                profile.uid,
                notifications.filter((n) => !n.read).map((n) => n.id)
              )
            }
            onDeleteNotification={(id) => deleteNotification(profile.uid, id)}
            onNavigateNotification={handleNavigateNotification}
            onSectionChange={(sec) => setHomeSection(sec)}
          />
        </div>
      )}

      {/* Modals */}
      {createGuildModalState.open && (
        <CreateOrJoinGuildModal
          profile={profile}
          initialTab={createGuildModalState.initialTab}
          initialInviteCode={createGuildModalState.initialInviteCode}
          onClose={() =>
            setCreateGuildModalState({ open: false, initialTab: 'create', initialInviteCode: '' })
          }
          onCreatedOrJoined={(gId, chId) => {
            setActiveScope('guild');
            setActiveGuildId(gId);
            if (chId) setActiveChannelId(chId);
          }}
        />
      )}

      {showDiscoverModal && (
        <DiscoverGuildsModal
          profile={profile}
          joinedGuildIds={joinedGuildIds}
          onClose={() => setShowDiscoverModal(false)}
          onSelectOrJoin={(gId) => {
            setActiveScope('guild');
            setActiveGuildId(gId);
          }}
        />
      )}

      {channelModalState.open && activeGuild && (
        <ChannelModal
          guildId={activeGuild.id}
          userId={profile.uid}
          existingChannel={channelModalState.editing}
          nextPosition={channels.length}
          canDelete={channels.length > 1}
          onClose={() => setChannelModalState({ open: false, editing: null })}
          onSaved={(chId) => {
            if (chId) setActiveChannelId(chId);
          }}
        />
      )}

      {showGuildSettingsModal && activeGuild && (
        <GuildSettingsModal
          guild={activeGuild}
          roles={roles}
          myMembership={myMembership}
          userId={profile.uid}
          onClose={() => setShowGuildSettingsModal(false)}
          onDeleted={() => {
            setActiveScope('home');
            setActiveGuildId(null);
            setActiveChannelId(null);
          }}
        />
      )}

      {showUserSettingsModal && (
        <UserSettingsModal
          authUser={firebaseUser}
          profile={profile}
          privateAccount={privateAccount}
          sessions={sessions}
          currentSessionId={currentSessionId}
          joinedGuildIds={guildLinks.map((g) => g.guildId)}
          onClose={() => setShowUserSettingsModal(false)}
        />
      )}

      {showSearchModal && (
        <GlobalSearchModal
          currentUid={profile.uid}
          channels={channels}
          activeMessages={activeScope === 'guild' ? channelMessages : dmMessages}
          onClose={() => setShowSearchModal(false)}
          onSelectChannel={(chId) => {
            setActiveScope('guild');
            setActiveChannelId(chId);
          }}
          onJumpToMessage={handleJumpToMessage}
          onStartDm={(user) => void handleStartDm(user)}
          onSelectPublicGuild={async (guild) => {
            if (!joinedGuildIds.has(guild.id)) {
              await joinGuild(profile, guild, guild.inviteCode);
            }
            setActiveScope('guild');
            setActiveGuildId(guild.id);
          }}
        />
      )}
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <GuildspaceShell />
    </ErrorBoundary>
  );
}
