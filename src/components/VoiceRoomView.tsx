import React, { useState } from 'react';
import {
  Bell,
  HeadphoneOff,
  Headphones,
  Menu,
  MessageSquare,
  Mic,
  MicOff,
  PhoneOff,
  Radio,
  Search,
  SendHorizontal,
  Users,
  Volume2,
} from 'lucide-react';
import {
  ChannelMessage,
  Guild,
  GuildChannel,
  UserProfile,
  VoiceParticipant,
} from '../types/guildspace';
import { formatMessageTime } from '../lib/validation';
import { Avatar } from './Avatar';

interface VoiceRoomViewProps {
  profile: UserProfile;
  userDirectory: Record<string, UserProfile>;
  guild: Guild;
  channel: GuildChannel;
  participants: VoiceParticipant[];
  isConnectedHere: boolean;
  muted: boolean;
  deafened: boolean;
  micAvailable: boolean;
  messages: ChannelMessage[];
  unreadNotificationsCount: number;
  showMembersSidebar: boolean;
  onJoinVoice: () => Promise<void>;
  onLeaveVoice: () => Promise<void>;
  onToggleMute: () => void;
  onToggleDeafen: () => void;
  onSendMessage: (content: string) => Promise<void>;
  onToggleMembersSidebar: () => void;
  onOpenMobileMenu: () => void;
  onOpenSearch: () => void;
  onOpenNotifications: () => void;
}

export const VoiceRoomView: React.FC<VoiceRoomViewProps> = ({
  profile,
  userDirectory,
  guild,
  channel,
  participants,
  isConnectedHere,
  muted,
  deafened,
  micAvailable,
  messages,
  unreadNotificationsCount,
  showMembersSidebar,
  onJoinVoice,
  onLeaveVoice,
  onToggleMute,
  onToggleDeafen,
  onSendMessage,
  onToggleMembersSidebar,
  onOpenMobileMenu,
  onOpenSearch,
  onOpenNotifications,
}) => {
  const [showCompanionChat, setShowCompanionChat] = useState(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      await onSendMessage(trimmed);
      setDraft('');
    } finally {
      setSending(false);
    }
  };

  return (
    <main className="flex-1 min-w-0 h-full bg-[#131622] flex flex-col relative">
      {/* Top Voice Channel Header */}
      <header className="h-14 px-4 border-b border-white/[0.06] bg-[#131622]/95 backdrop-blur flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onOpenMobileMenu}
            aria-label="Open navigation menu"
            className="md:hidden p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06]"
          >
            <Menu className="w-5 h-5" />
          </button>

          <Volume2 className="w-5 h-5 text-emerald-400 shrink-0" />
          <div className="min-w-0 flex items-baseline gap-3">
            <h1 className="font-display font-bold text-sm sm:text-base text-white truncate">
              {channel.name}
            </h1>
            {channel.topic && (
              <p className="hidden lg:block text-xs text-slate-400 truncate max-w-md">
                {channel.topic}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setShowCompanionChat((p) => !p)}
            title="Toggle Voice Channel Chat"
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              showCompanionChat
                ? 'bg-violet-500/20 text-violet-200'
                : 'text-slate-400 hover:text-white hover:bg-white/[0.06]'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Chat</span>
          </button>

          <button
            type="button"
            onClick={onOpenSearch}
            title="Search (Ctrl+K)"
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-[#0B0D14] border border-white/[0.08] text-xs text-slate-400 hover:text-slate-200 transition-colors"
          >
            <Search className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Search</span>
          </button>

          <button
            type="button"
            onClick={onOpenNotifications}
            title="Notifications"
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors relative"
          >
            <Bell className="w-4 h-4" />
            {unreadNotificationsCount > 0 && (
              <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-rose-500" />
            )}
          </button>

          <button
            type="button"
            onClick={onToggleMembersSidebar}
            title="Toggle Member List"
            className={`p-2 rounded-lg transition-colors ${
              showMembersSidebar
                ? 'bg-blue-500/15 text-blue-300'
                : 'text-slate-400 hover:text-white hover:bg-white/[0.06]'
            }`}
          >
            <Users className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Voice Stage + Companion Chat */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
        <div className="flex-1 flex flex-col justify-between p-6 bg-gradient-to-b from-[#0E111B] to-[#131622] overflow-y-auto gs-scroll">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold ${
                    isConnectedHere
                      ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                      : 'bg-white/[0.06] text-slate-300 border border-white/10'
                  }`}
                >
                  <Radio className="w-3.5 h-3.5" />
                  {isConnectedHere ? 'Voice Connected' : 'Voice Channel Standby'}
                </span>
                <span className="text-xs text-slate-400 font-mono">
                  {participants.length} {participants.length === 1 ? 'member' : 'members'} in room
                </span>
              </div>

              {isConnectedHere && !micAvailable && (
                <span className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/25 px-2.5 py-1 rounded-lg">
                  Listen-only mode (microphone unavailable or blocked)
                </span>
              )}
            </div>

            {participants.length === 0 ? (
              <div className="py-14 px-6 rounded-2xl bg-[#0B0D14]/80 border border-white/[0.07] text-center space-y-3">
                <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-emerald-500/20 to-blue-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-300">
                  <Volume2 className="w-7 h-7" />
                </div>
                <h2 className="text-lg font-bold font-display text-white">
                  Nobody is in #{channel.name} yet
                </h2>
                <p className="text-xs text-slate-400 max-w-sm mx-auto">
                  Join the voice channel in {guild.name} to start a live audio hangout with members.
                </p>
                {!isConnectedHere && (
                  <button
                    type="button"
                    onClick={() => void onJoinVoice()}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-semibold transition-all"
                  >
                    <Volume2 className="w-4 h-4" />
                    Join Voice Channel
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {participants.map((p) => {
                  const live = userDirectory[p.uid];
                  const displayName = live?.displayName || p.displayName;
                  const avatarUrl = live?.avatarUrl ?? p.avatarUrl;
                  const accent = live?.accentColor || p.accentColor;
                  const isMe = p.uid === profile.uid;

                  return (
                    <div
                      key={p.uid}
                      className={`p-5 rounded-2xl bg-[#0B0D14] border transition-all flex flex-col items-center justify-center gap-3 text-center relative ${
                        p.speaking && !p.muted
                          ? 'border-emerald-400 ring-2 ring-emerald-500/30'
                          : 'border-white/[0.08]'
                      }`}
                    >
                      <div
                        className={`rounded-full p-1 transition-all ${
                          p.speaking && !p.muted ? 'ring-2 ring-emerald-400' : ''
                        }`}
                      >
                        <Avatar
                          name={displayName}
                          src={avatarUrl}
                          accentColor={accent}
                          status="online"
                          size="xl"
                        />
                      </div>

                      <div className="min-w-0 w-full">
                        <div className="text-sm font-semibold text-white truncate">
                          {displayName} {isMe && <span className="text-xs text-violet-300">(You)</span>}
                        </div>
                        <div className="text-xs text-slate-400 truncate">@{p.username}</div>
                      </div>

                      <div className="flex items-center gap-2">
                        {p.muted && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-500/15 text-rose-300 text-[11px]">
                            <MicOff className="w-3 h-3" /> Muted
                          </span>
                        )}
                        {p.deafened && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-300 text-[11px]">
                            <HeadphoneOff className="w-3 h-3" /> Deafened
                          </span>
                        )}
                        {!p.muted && !p.deafened && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-300 text-[11px]">
                            <Mic className="w-3 h-3" /> {p.speaking ? 'Speaking' : 'Live'}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Bottom Stage Controls */}
          <div className="pt-6 flex items-center justify-center gap-3">
            {!isConnectedHere ? (
              <button
                type="button"
                onClick={() => void onJoinVoice()}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-sm font-semibold shadow-lg transition-all"
              >
                <Volume2 className="w-4 h-4" />
                Join Voice
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onToggleMute}
                  className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition-colors ${
                    muted
                      ? 'bg-rose-500/20 text-rose-200 border border-rose-500/40'
                      : 'bg-[#191D2D] text-white border border-white/10 hover:bg-white/10'
                  }`}
                >
                  {muted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                  {muted ? 'Unmute' : 'Mute'}
                </button>

                <button
                  type="button"
                  onClick={onToggleDeafen}
                  className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition-colors ${
                    deafened
                      ? 'bg-amber-500/20 text-amber-200 border border-amber-500/40'
                      : 'bg-[#191D2D] text-white border border-white/10 hover:bg-white/10'
                  }`}
                >
                  {deafened ? <HeadphoneOff className="w-4 h-4" /> : <Headphones className="w-4 h-4" />}
                  {deafened ? 'Undeafen' : 'Deafen'}
                </button>

                <button
                  type="button"
                  onClick={() => void onLeaveVoice()}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold transition-colors"
                >
                  <PhoneOff className="w-4 h-4" />
                  Disconnect
                </button>
              </>
            )}
          </div>
        </div>

        {/* Companion Voice Text Chat Panel */}
        {showCompanionChat && (
          <section className="w-full lg:w-[340px] h-72 lg:h-full border-t lg:border-t-0 lg:border-l border-white/[0.06] bg-[#10131D] flex flex-col shrink-0">
            <div className="px-4 py-3 border-b border-white/[0.06] text-xs font-semibold text-slate-300 flex items-center gap-2">
              <MessageSquare className="w-3.5 h-3.5 text-violet-400" />
              <span>Voice Lounge Chat</span>
            </div>

            <div className="flex-1 overflow-y-auto gs-scroll p-3 space-y-3">
              {messages.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-6">
                  Drop notes or links while chatting in #{channel.name}.
                </p>
              ) : (
                messages.map((m) => (
                  <div key={m.id} className="flex items-start gap-2.5 text-xs">
                    <Avatar name={m.authorName} src={m.authorAvatar} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="font-semibold text-white truncate">{m.authorName}</span>
                        <span className="text-[10px] font-mono text-slate-500 shrink-0">
                          {formatMessageTime(m.createdAt)}
                        </span>
                      </div>
                      <p className="text-slate-300 break-words mt-0.5">{m.content}</p>
                    </div>
                  </div>
                ))
              )}
            </div>

            <form onSubmit={handleSend} className="p-3 border-t border-white/[0.06] flex items-center gap-2">
              <input
                type="text"
                maxLength={2000}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={`Message #${channel.name}...`}
                className="flex-1 px-3 py-2 rounded-xl bg-[#090B11] border border-white/10 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-500"
              />
              <button
                type="submit"
                disabled={sending || !draft.trim()}
                aria-label="Send voice chat message"
                className="p-2 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 text-white disabled:opacity-40"
              >
                <SendHorizontal className="w-3.5 h-3.5" />
              </button>
            </form>
          </section>
        )}
      </div>
    </main>
  );
};
