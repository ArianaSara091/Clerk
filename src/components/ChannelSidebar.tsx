import React, { useState } from 'react';
import {
  Bell,
  Check,
  ChevronDown,
  Copy,
  Hash,
  HeadphoneOff,
  Headphones,
  Link2,
  LogOut,
  MessageSquarePlus,
  Mic,
  MicOff,
  PhoneOff,
  Plus,
  Settings,
  Shield,
  Trash2,
  Users,
  Volume2,
} from 'lucide-react';
import {
  DmThread,
  Guild,
  GuildChannel,
  GuildMember,
  PresenceStatus,
  STATUS_META,
  UserProfile,
  VoiceParticipant,
} from '../types/guildspace';
import { buildInviteLink } from '../lib/validation';
import { Avatar } from './Avatar';

interface ChannelSidebarProps {
  profile: UserProfile;
  userDirectory: Record<string, UserProfile>;
  activeScope: 'home' | 'guild';
  homeSection: 'friends' | 'notifications' | 'dm';
  activeDmThreadId: string | null;
  dmThreads: DmThread[];
  activeGuild: Guild | null;
  channels: GuildChannel[];
  activeChannelId: string | null;
  myMembership: GuildMember | undefined;
  unreadNotificationsCount: number;
  pendingFriendRequestsCount: number;
  voiceParticipantsByChannel: Record<string, VoiceParticipant[]>;
  activeVoiceChannelId: string | null;
  activeVoiceChannelName: string | null;
  voiceMuted: boolean;
  voiceDeafened: boolean;
  onSelectHomeSection: (section: 'friends' | 'notifications') => void;
  onSelectDmThread: (threadId: string) => void;
  onSelectChannel: (channel: GuildChannel) => void;
  onToggleVoiceMute: () => void;
  onToggleVoiceDeafen: () => void;
  onLeaveVoice: () => void;
  onOpenCreateChannel: () => void;
  onOpenEditChannel: (channel: GuildChannel) => void;
  onOpenGuildSettings: () => void;
  onLeaveGuild: () => void;
  onOpenUserSettings: () => void;
  onChangeStatus: (status: PresenceStatus) => void;
  onSignOut: () => void;
  onOpenSearch: () => void;
}

export const ChannelSidebar: React.FC<ChannelSidebarProps> = ({
  profile,
  userDirectory,
  activeScope,
  homeSection,
  activeDmThreadId,
  dmThreads,
  activeGuild,
  channels,
  activeChannelId,
  myMembership,
  unreadNotificationsCount,
  pendingFriendRequestsCount,
  voiceParticipantsByChannel,
  activeVoiceChannelId,
  activeVoiceChannelName,
  voiceMuted,
  voiceDeafened,
  onSelectHomeSection,
  onSelectDmThread,
  onSelectChannel,
  onToggleVoiceMute,
  onToggleVoiceDeafen,
  onLeaveVoice,
  onOpenCreateChannel,
  onOpenEditChannel,
  onOpenGuildSettings,
  onLeaveGuild,
  onOpenUserSettings,
  onChangeStatus,
  onSignOut,
  onOpenSearch,
}) => {
  const [guildMenuOpen, setGuildMenuOpen] = useState(false);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [copiedInvite, setCopiedInvite] = useState<'code' | 'link' | null>(null);

  const canManageChannels =
    myMembership?.role === 'owner' ||
    myMembership?.role === 'admin' ||
    myMembership?.role === 'moderator';
  const canManageGuild = myMembership?.role === 'owner' || myMembership?.role === 'admin';

  // Group channels by category
  const groupedChannels = channels.reduce<Record<string, GuildChannel[]>>((acc, ch) => {
    const key = ch.category || (ch.type === 'voice' ? 'Voice Channels' : 'Text Channels');
    if (!acc[key]) acc[key] = [];
    acc[key].push(ch);
    return acc;
  }, {});

  const handleCopyInviteCode = () => {
    if (!activeGuild) return;
    void navigator.clipboard.writeText(activeGuild.inviteCode);
    setCopiedInvite('code');
    setTimeout(() => setCopiedInvite(null), 1800);
  };

  const handleCopyInviteLink = () => {
    if (!activeGuild) return;
    void navigator.clipboard.writeText(buildInviteLink(activeGuild.inviteCode));
    setCopiedInvite('link');
    setTimeout(() => setCopiedInvite(null), 1800);
  };

  return (
    <aside
      aria-label="Channel and conversation navigation"
      className="w-[248px] shrink-0 h-full bg-[#10131D] border-r border-white/[0.06] flex flex-col select-none"
    >
      {/* Top Workspace / Server Header */}
      {activeScope === 'home' || !activeGuild ? (
        <div className="h-14 px-3.5 border-b border-white/[0.06] flex items-center justify-between gap-2 shrink-0">
          <button
            type="button"
            onClick={onOpenSearch}
            className="w-full text-left px-3 py-1.5 rounded-lg bg-[#090B10] border border-white/[0.07] text-xs text-slate-400 hover:text-slate-200 hover:border-violet-500/40 transition-colors truncate"
          >
            Find conversation or channel...
          </button>
        </div>
      ) : (
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setGuildMenuOpen((prev) => !prev)}
            className="w-full h-14 px-4 border-b border-white/[0.06] flex items-center justify-between gap-2 hover:bg-white/[0.03] transition-colors text-left"
          >
            <span className="font-display font-bold text-sm text-white truncate">
              {activeGuild.name}
            </span>
            <ChevronDown
              className={`w-4 h-4 text-slate-400 shrink-0 transition-transform duration-150 ${
                guildMenuOpen ? 'rotate-180' : ''
              }`}
            />
          </button>

          {guildMenuOpen && (
            <div className="absolute left-2.5 right-2.5 top-[58px] z-30 bg-[#171B29] border border-white/10 rounded-xl p-1.5 shadow-2xl space-y-1">
              <button
                type="button"
                onClick={handleCopyInviteLink}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-xs font-medium text-violet-300 hover:bg-violet-500/15 transition-colors"
              >
                <span className="flex items-center gap-2 truncate">
                  <Link2 className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">Copy Invite Link</span>
                </span>
                {copiedInvite === 'link' ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                ) : (
                  <Copy className="w-3.5 h-3.5 shrink-0" />
                )}
              </button>

              {canManageGuild && (
                <button
                  type="button"
                  onClick={() => {
                    setGuildMenuOpen(false);
                    onOpenGuildSettings();
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-slate-200 hover:bg-white/[0.06] transition-colors"
                >
                  <Shield className="w-3.5 h-3.5 text-blue-400" />
                  Server Settings &amp; Roles
                </button>
              )}

              {canManageChannels && (
                <button
                  type="button"
                  onClick={() => {
                    setGuildMenuOpen(false);
                    onOpenCreateChannel();
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-slate-200 hover:bg-white/[0.06] transition-colors"
                >
                  <Plus className="w-3.5 h-3.5 text-violet-400" />
                  Create Text or Voice Channel
                </button>
              )}

              {myMembership?.role !== 'owner' && (
                <button
                  type="button"
                  onClick={() => {
                    setGuildMenuOpen(false);
                    onLeaveGuild();
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-rose-400 hover:bg-rose-500/15 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Leave Server
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Middle Navigation List */}
      <div className="flex-1 overflow-y-auto gs-scroll px-2.5 py-3 space-y-5">
        {activeScope === 'home' || !activeGuild ? (
          <>
            <div className="space-y-1">
              <button
                type="button"
                onClick={() => onSelectHomeSection('friends')}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                  homeSection === 'friends'
                    ? 'bg-gradient-to-r from-violet-600/20 to-blue-600/15 text-white border border-violet-500/30'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-white/[0.04]'
                }`}
              >
                <span className="flex items-center gap-2.5 whitespace-nowrap">
                  <Users className="w-4 h-4 shrink-0" />
                  Friends
                </span>
                {pendingFriendRequestsCount > 0 && (
                  <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300">
                    {pendingFriendRequestsCount}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => onSelectHomeSection('notifications')}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                  homeSection === 'notifications'
                    ? 'bg-gradient-to-r from-violet-600/20 to-blue-600/15 text-white border border-violet-500/30'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-white/[0.04]'
                }`}
              >
                <span className="flex items-center gap-2.5 whitespace-nowrap">
                  <Bell className="w-4 h-4 shrink-0" />
                  Notifications
                </span>
                {unreadNotificationsCount > 0 && (
                  <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-violet-500/25 text-violet-200">
                    {unreadNotificationsCount}
                  </span>
                )}
              </button>
            </div>

            <div className="space-y-1.5">
              <div className="px-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500">Direct Messages</span>
                <button
                  type="button"
                  onClick={() => onSelectHomeSection('friends')}
                  title="Start Direct Message"
                  aria-label="Start Direct Message"
                  className="p-1 rounded-md text-slate-500 hover:text-slate-200 hover:bg-white/[0.06] transition-colors"
                >
                  <MessageSquarePlus className="w-3.5 h-3.5" />
                </button>
              </div>

              {dmThreads.length === 0 ? (
                <p className="px-2.5 py-3 text-xs text-slate-500 leading-relaxed">
                  No direct messages yet. Add friends or search Clerk members to start a thread.
                </p>
              ) : (
                <div className="space-y-0.5">
                  {dmThreads.map((thread) => {
                    const isP1Me = thread.p1Uid === profile.uid;
                    const partnerUid = isP1Me ? thread.p2Uid : thread.p1Uid;
                    const partnerLive = userDirectory[partnerUid];
                    const partnerName = partnerLive?.displayName || (isP1Me ? thread.p2Name : thread.p1Name);
                    const partnerAvatar = partnerLive?.avatarUrl ?? (isP1Me ? thread.p2Avatar : thread.p1Avatar);
                    const partnerStatus = partnerLive?.status || 'offline';
                    const isActive = homeSection === 'dm' && activeDmThreadId === thread.id;

                    return (
                      <button
                        key={thread.id}
                        type="button"
                        onClick={() => onSelectDmThread(thread.id)}
                        className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left transition-colors ${
                          isActive
                            ? 'bg-white/[0.08] text-white'
                            : 'text-slate-400 hover:text-slate-100 hover:bg-white/[0.04]'
                        }`}
                      >
                        <Avatar
                          name={partnerName}
                          src={partnerAvatar}
                          accentColor={partnerLive?.accentColor}
                          status={partnerStatus}
                          showStatus
                          size="sm"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium truncate">{partnerName}</div>
                          <div className="text-xs text-slate-500 truncate">
                            {thread.lastMessage || 'Open conversation'}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            {/* Server Invite Quick Strip */}
            <div className="p-2 rounded-xl bg-[#0B0D14] border border-white/[0.06] space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[10px] text-slate-500">Server Invite</div>
                  <div className="text-xs font-mono font-semibold text-violet-300 truncate">
                    {activeGuild.inviteCode}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={handleCopyInviteCode}
                    className="px-2 py-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-[11px] font-medium text-slate-200 transition-colors"
                  >
                    {copiedInvite === 'code' ? 'Copied' : 'Code'}
                  </button>
                  <button
                    type="button"
                    onClick={handleCopyInviteLink}
                    title="Copy Invitation Link"
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-violet-600/20 hover:bg-violet-600/35 text-[11px] font-medium text-violet-200 transition-colors"
                  >
                    <Link2 className="w-3 h-3" />
                    {copiedInvite === 'link' ? 'Copied' : 'Link'}
                  </button>
                </div>
              </div>
            </div>

            {Object.entries(groupedChannels).map(([category, list]) => (
              <div key={category} className="space-y-1">
                <div className="px-2 flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-500 truncate">{category}</span>
                  {canManageChannels && (
                    <button
                      type="button"
                      onClick={onOpenCreateChannel}
                      title="Create Channel"
                      aria-label="Create Channel"
                      className="p-1 rounded-md text-slate-500 hover:text-slate-200 hover:bg-white/[0.06] transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <div className="space-y-0.5">
                  {list.map((ch) => {
                    const isActive = ch.id === activeChannelId;
                    const isVoice = ch.type === 'voice';
                    const isVoiceConnectedHere = activeVoiceChannelId === ch.id;
                    const voiceUsers = voiceParticipantsByChannel[ch.id] || [];

                    return (
                      <div key={ch.id} className="space-y-0.5">
                        <div className="group flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => onSelectChannel(ch)}
                            className={`flex-1 min-w-0 flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl text-sm transition-colors ${
                              isActive || isVoiceConnectedHere
                                ? 'bg-gradient-to-r from-violet-600/20 to-blue-600/15 text-white font-medium border border-violet-500/25'
                                : 'text-slate-400 hover:text-slate-100 hover:bg-white/[0.04]'
                            }`}
                          >
                            <span className="flex items-center gap-2 min-w-0">
                              {isVoice ? (
                                <Volume2
                                  className={`w-4 h-4 shrink-0 ${
                                    isVoiceConnectedHere
                                      ? 'text-emerald-400'
                                      : isActive
                                      ? 'text-violet-300'
                                      : 'text-slate-500 group-hover:text-slate-400'
                                  }`}
                                />
                              ) : (
                                <Hash
                                  className={`w-4 h-4 shrink-0 ${
                                    isActive ? 'text-violet-400' : 'text-slate-500 group-hover:text-slate-400'
                                  }`}
                                />
                              )}
                              <span className="truncate">{ch.name}</span>
                            </span>
                            {isVoice && voiceUsers.length > 0 && (
                              <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 shrink-0">
                                {voiceUsers.length}
                              </span>
                            )}
                          </button>
                          {canManageChannels && (
                            <button
                              type="button"
                              onClick={() => onOpenEditChannel(ch)}
                              title={`Edit ${ch.name}`}
                              aria-label={`Edit ${ch.name}`}
                              className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 p-1.5 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-white/[0.06] transition-opacity shrink-0"
                            >
                              <Settings className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>

                        {/* Nested Connected Voice Participants */}
                        {isVoice && voiceUsers.length > 0 && (
                          <div className="pl-6 pr-2 py-0.5 space-y-1">
                            {voiceUsers.map((vp) => {
                              const live = userDirectory[vp.uid];
                              return (
                                <div
                                  key={vp.uid}
                                  className="flex items-center justify-between gap-2 px-2 py-1 rounded-lg bg-white/[0.02]"
                                >
                                  <div className="flex items-center gap-2 min-w-0">
                                    <div
                                      className={`rounded-full ${
                                        vp.speaking && !vp.muted ? 'ring-2 ring-emerald-400' : ''
                                      }`}
                                    >
                                      <Avatar
                                        name={live?.displayName || vp.displayName}
                                        src={live?.avatarUrl ?? vp.avatarUrl}
                                        accentColor={vp.accentColor}
                                        size="xs"
                                      />
                                    </div>
                                    <span className="text-xs text-slate-300 truncate">
                                      {live?.displayName || vp.displayName}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-1 shrink-0">
                                    {vp.muted && <MicOff className="w-3 h-3 text-rose-400" />}
                                    {vp.deafened && <HeadphoneOff className="w-3 h-3 text-amber-400" />}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Active Voice Connected Dock */}
      {activeVoiceChannelId && (
        <div className="px-3 py-2.5 bg-[#0D1419] border-t border-emerald-500/25 flex items-center justify-between gap-2 shrink-0">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold text-emerald-400 truncate">
              Voice Connected
            </div>
            <div className="text-[11px] text-slate-300 truncate">
              {activeVoiceChannelName || 'voice-lounge'}
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={onToggleVoiceMute}
              title={voiceMuted ? 'Unmute' : 'Mute'}
              aria-label={voiceMuted ? 'Unmute' : 'Mute'}
              className={`p-1.5 rounded-lg transition-colors ${
                voiceMuted
                  ? 'bg-rose-500/20 text-rose-300'
                  : 'text-slate-300 hover:bg-white/[0.08]'
              }`}
            >
              {voiceMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
            </button>
            <button
              type="button"
              onClick={onToggleVoiceDeafen}
              title={voiceDeafened ? 'Undeafen' : 'Deafen'}
              aria-label={voiceDeafened ? 'Undeafen' : 'Deafen'}
              className={`p-1.5 rounded-lg transition-colors ${
                voiceDeafened
                  ? 'bg-amber-500/20 text-amber-300'
                  : 'text-slate-300 hover:bg-white/[0.08]'
              }`}
            >
              {voiceDeafened ? (
                <HeadphoneOff className="w-3.5 h-3.5" />
              ) : (
                <Headphones className="w-3.5 h-3.5" />
              )}
            </button>
            <button
              type="button"
              onClick={onLeaveVoice}
              title="Disconnect Voice"
              aria-label="Disconnect Voice"
              className="p-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/30 text-rose-300 transition-colors"
            >
              <PhoneOff className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Bottom User Profile & Settings Panel */}
      <div className="relative p-2.5 bg-[#0C0E16] border-t border-white/[0.06] shrink-0">
        {statusMenuOpen && (
          <div className="absolute left-2.5 right-2.5 bottom-[66px] z-30 bg-[#171B29] border border-white/10 rounded-xl p-1.5 shadow-2xl space-y-0.5">
            {(['online', 'idle', 'dnd', 'offline'] as PresenceStatus[]).map((st) => {
              const meta = STATUS_META[st];
              const selected = profile.status === st;
              return (
                <button
                  key={st}
                  type="button"
                  onClick={() => {
                    onChangeStatus(st);
                    setStatusMenuOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs transition-colors ${
                    selected ? 'bg-violet-500/20 text-white font-medium' : 'text-slate-300 hover:bg-white/[0.06]'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <span className={`w-2.5 h-2.5 rounded-full ${meta.colorClass}`} />
                    <span>{meta.label}</span>
                  </span>
                  {selected && <Check className="w-3.5 h-3.5 text-violet-400" />}
                </button>
              );
            })}
            <div className="my-1 border-t border-white/[0.08]" />
            <button
              type="button"
              onClick={() => {
                setStatusMenuOpen(false);
                onSignOut();
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-rose-400 hover:bg-rose-500/15 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign Out
            </button>
          </div>
        )}

        <div className="flex items-center justify-between gap-1.5">
          <button
            type="button"
            onClick={() => setStatusMenuOpen((prev) => !prev)}
            className="flex items-center gap-2.5 min-w-0 flex-1 p-1.5 rounded-xl hover:bg-white/[0.05] transition-colors text-left"
          >
            <Avatar
              name={profile.displayName}
              src={profile.avatarUrl}
              accentColor={profile.accentColor}
              status={profile.status}
              showStatus
              size="sm"
            />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-white truncate">{profile.displayName}</div>
              <div className="text-[11px] text-slate-400 truncate">
                {profile.customStatus || STATUS_META[profile.status].label}
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={onOpenUserSettings}
            title="Profile & Settings"
            aria-label="Profile & Settings"
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors shrink-0"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );
};
