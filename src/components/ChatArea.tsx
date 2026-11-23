import React, { useEffect, useRef, useState } from 'react';
import {
  Bell,
  Check,
  CornerUpLeft,
  Edit3,
  FileText,
  Hash,
  Menu,
  Paperclip,
  Pin,
  Search,
  SendHorizontal,
  Smile,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import {
  ChannelMessage,
  DmMessage,
  DmThread,
  Guild,
  GuildChannel,
  GuildMember,
  STATUS_META,
  UserProfile,
} from '../types/guildspace';
import { formatMessageTime, groupReactions } from '../lib/validation';
import { uploadMediaFile } from '../services/guildspaceApi';
import { Avatar } from './Avatar';

const QUICK_EMOJIS = ['👍', '🔥', '💜', '🚀', '👀', '🎉'];

interface ChatAreaProps {
  mode: 'channel' | 'dm';
  profile: UserProfile;
  userDirectory: Record<string, UserProfile>;
  guild?: Guild | null;
  channel?: GuildChannel | null;
  guildMembers?: GuildMember[];
  myMembership?: GuildMember;
  dmThread?: DmThread | null;
  dmPartner?: UserProfile | null;
  messages: (ChannelMessage | DmMessage)[];
  unreadNotificationsCount: number;
  showMembersSidebar: boolean;
  highlightedMessageId?: string | null;
  onToggleMembersSidebar: () => void;
  onOpenMobileMenu: () => void;
  onOpenSearch: () => void;
  onOpenNotifications: () => void;
  onSendMessage: (payload: {
    content: string;
    attachment?: { url: string; name: string; type: string } | null;
    replyTo?: { id: string; snippet: string; author: string } | null;
  }) => Promise<void>;
  onEditMessage: (messageId: string, content: string) => Promise<void>;
  onDeleteMessage: (messageId: string) => Promise<void>;
  onTogglePin?: (messageId: string, currentlyPinned: boolean) => Promise<void>;
  onToggleReaction: (messageId: string, currentTokens: string[], emoji: string) => Promise<void>;
}

export const ChatArea: React.FC<ChatAreaProps> = ({
  mode,
  profile,
  userDirectory,
  guild,
  channel,
  guildMembers = [],
  myMembership,
  dmThread,
  dmPartner,
  messages,
  unreadNotificationsCount,
  showMembersSidebar,
  highlightedMessageId,
  onToggleMembersSidebar,
  onOpenMobileMenu,
  onOpenSearch,
  onOpenNotifications,
  onSendMessage,
  onEditMessage,
  onDeleteMessage,
  onTogglePin,
  onToggleReaction,
}) => {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [pendingAttachment, setPendingAttachment] = useState<{
    url: string;
    name: string;
    type: string;
  } | null>(null);
  const [replyTo, setReplyTo] = useState<{ id: string; snippet: string; author: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showPinnedDrawer, setShowPinnedDrawer] = useState(false);
  const [reactingMessageId, setReactingMessageId] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const canModerate =
    myMembership?.role === 'owner' ||
    myMembership?.role === 'admin' ||
    myMembership?.role === 'moderator';

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, channel?.id, dmThread?.id]);

  const pinnedMessages =
    mode === 'channel'
      ? (messages as ChannelMessage[]).filter((m) => m.pinned)
      : [];

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError(null);
    setUploading(true);
    try {
      const scope = mode === 'channel' ? `attachments/${guild?.id || 'guild'}` : `attachments/dm_${dmThread?.id || 'thread'}`;
      const uploaded = await uploadMediaFile(file, `${scope}/${profile.uid}`);
      setPendingAttachment(uploaded);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (sending || uploading) return;
    const trimmed = draft.trim();
    if (!trimmed && !pendingAttachment) return;

    setSending(true);
    setUploadError(null);
    try {
      await onSendMessage({
        content: trimmed,
        attachment: pendingAttachment,
        replyTo,
      });
      setDraft('');
      setPendingAttachment(null);
      setReplyTo(null);
      setShowEmojiPicker(false);
      inputRef.current?.focus();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Failed to send message.');
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handleSaveEdit = async (messageId: string) => {
    const trimmed = editingText.trim();
    if (!trimmed) return;
    await onEditMessage(messageId, trimmed);
    setEditingId(null);
    setEditingText('');
  };

  const renderMessageText = (text: string) => {
    if (!text) return null;
    const parts = text.split(/(@[a-z0-9_.-]+)/gi);
    return parts.map((part, idx) => {
      if (part.startsWith('@') && part.length > 2) {
        return (
          <span
            key={idx}
            className="px-1 py-0.5 rounded bg-violet-500/20 text-violet-200 font-medium"
          >
            {part}
          </span>
        );
      }
      return <React.Fragment key={idx}>{part}</React.Fragment>;
    });
  };

  const headerTitle =
    mode === 'channel'
      ? channel?.name || 'general'
      : dmPartner?.displayName || 'Direct Message';

  const headerSub =
    mode === 'channel'
      ? channel?.topic || ''
      : dmPartner
      ? `@${dmPartner.username} · ${STATUS_META[dmPartner.status].label}`
      : '';

  return (
    <main className="flex-1 min-w-0 h-full bg-[#131622] flex flex-col relative">
      {/* Top Chat Bar */}
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

          {mode === 'channel' ? (
            <Hash className="w-5 h-5 text-violet-400 shrink-0" />
          ) : (
            dmPartner && (
              <Avatar
                name={dmPartner.displayName}
                src={dmPartner.avatarUrl}
                accentColor={dmPartner.accentColor}
                status={dmPartner.status}
                showStatus
                size="sm"
              />
            )
          )}

          <div className="min-w-0 flex items-baseline gap-3">
            <h1 className="font-display font-bold text-sm sm:text-base text-white truncate">
              {headerTitle}
            </h1>
            {headerSub && (
              <p className="hidden lg:block text-xs text-slate-400 truncate max-w-md">
                {headerSub}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {mode === 'channel' && (
            <button
              type="button"
              onClick={() => setShowPinnedDrawer((prev) => !prev)}
              title="Pinned Messages"
              aria-label="Pinned Messages"
              className={`p-2 rounded-lg transition-colors relative ${
                showPinnedDrawer
                  ? 'bg-violet-500/20 text-violet-300'
                  : 'text-slate-400 hover:text-white hover:bg-white/[0.06]'
              }`}
            >
              <Pin className="w-4 h-4" />
              {pinnedMessages.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[15px] h-[15px] px-1 rounded-full bg-violet-600 text-[10px] font-mono text-white flex items-center justify-center">
                  {pinnedMessages.length}
                </span>
              )}
            </button>
          )}

          <button
            type="button"
            onClick={onOpenSearch}
            title="Search (Ctrl+K)"
            aria-label="Search Clerk"
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-[#0B0D14] border border-white/[0.08] text-xs text-slate-400 hover:text-slate-200 hover:border-violet-500/40 transition-colors whitespace-nowrap"
          >
            <Search className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Search</span>
          </button>

          <button
            type="button"
            onClick={onOpenNotifications}
            title="Notifications"
            aria-label="Notifications"
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors relative"
          >
            <Bell className="w-4 h-4" />
            {unreadNotificationsCount > 0 && (
              <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-rose-500" />
            )}
          </button>

          {mode === 'channel' && (
            <button
              type="button"
              onClick={onToggleMembersSidebar}
              title="Toggle Member List"
              aria-label="Toggle Member List"
              className={`p-2 rounded-lg transition-colors ${
                showMembersSidebar
                  ? 'bg-blue-500/15 text-blue-300'
                  : 'text-slate-400 hover:text-white hover:bg-white/[0.06]'
              }`}
            >
              <Users className="w-4 h-4" />
            </button>
          )}
        </div>
      </header>

      {/* Collapsible Pinned Messages Bar */}
      {mode === 'channel' && showPinnedDrawer && (
        <div className="border-b border-white/[0.08] bg-[#171B2A] px-4 py-3 space-y-2 max-h-60 overflow-y-auto gs-scroll shrink-0">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-violet-300">
              Pinned Messages ({pinnedMessages.length})
            </span>
            <button
              type="button"
              onClick={() => setShowPinnedDrawer(false)}
              className="p-1 rounded text-slate-400 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          {pinnedMessages.length === 0 ? (
            <p className="text-xs text-slate-400">No pinned messages in this channel yet.</p>
          ) : (
            <div className="space-y-2">
              {pinnedMessages.map((pm) => (
                <div
                  key={pm.id}
                  className="p-2.5 rounded-xl bg-[#10131D] border border-white/[0.06] flex items-start justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-white">
                      {pm.authorName}{' '}
                      <span className="font-mono font-normal text-slate-500 ml-1">
                        {formatMessageTime(pm.createdAt)}
                      </span>
                    </div>
                    <p className="text-xs text-slate-300 mt-0.5 break-words">{pm.content}</p>
                  </div>
                  {canModerate && onTogglePin && (
                    <button
                      type="button"
                      onClick={() => void onTogglePin(pm.id, true)}
                      className="text-[11px] text-slate-400 hover:text-rose-300 whitespace-nowrap shrink-0"
                    >
                      Unpin
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Message Stream */}
      <div className="flex-1 overflow-y-auto gs-scroll px-4 sm:px-6 py-5 space-y-1">
        {/* Channel / DM Welcome Banner */}
        <div className="pb-6 mb-4 border-b border-white/[0.06] space-y-2">
          {mode === 'channel' ? (
            <>
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-600/25 to-blue-600/25 border border-violet-500/30 flex items-center justify-center text-violet-300">
                <Hash className="w-6 h-6" />
              </div>
              <h2 className="text-2xl font-bold font-display text-white">
                Welcome to #{channel?.name}
              </h2>
              <p className="text-sm text-slate-400 max-w-xl">
                {channel?.topic || `This is the start of the #${channel?.name} channel in ${guild?.name}.`}
              </p>
            </>
          ) : (
            dmPartner && (
              <>
                <Avatar
                  name={dmPartner.displayName}
                  src={dmPartner.avatarUrl}
                  accentColor={dmPartner.accentColor}
                  status={dmPartner.status}
                  showStatus
                  size="xl"
                />
                <h2 className="text-2xl font-bold font-display text-white">{dmPartner.displayName}</h2>
                <p className="text-sm text-slate-400 max-w-xl">
                  @{dmPartner.username} — Start of your direct message history with {dmPartner.displayName}.
                </p>
              </>
            )
          )}
        </div>

        {messages.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-500">
            No messages yet. Say hello below to start the conversation.
          </div>
        ) : (
          messages.map((msg, index) => {
            const prev = index > 0 ? messages[index - 1] : null;
            const isChannelMsg = 'replyToId' in msg;
            const sameAuthor =
              prev &&
              prev.authorId === msg.authorId &&
              !(isChannelMsg && msg.replyToId) &&
              prev.createdAt &&
              msg.createdAt &&
              msg.createdAt.toMillis() - prev.createdAt.toMillis() < 5 * 60 * 1000;

            const liveAuthor = userDirectory[msg.authorId];
            const authorName = liveAuthor?.displayName || msg.authorName;
            const authorAvatar = liveAuthor?.avatarUrl ?? msg.authorAvatar;
            const authorAccent = liveAuthor?.accentColor || '#7C3AED';
            const authorStatus = liveAuthor?.status || 'offline';
            const isMine = msg.authorId === profile.uid;
            const canDelete = isMine || (mode === 'channel' && canModerate);
            const reactions = groupReactions(msg.reactionTokens || [], profile.uid);
            const isHighlighted = highlightedMessageId === msg.id;
            const isImageAttachment =
              msg.attachmentUrl &&
              (msg.attachmentType.startsWith('image/') ||
                /\.(png|jpe?g|gif|webp)$/i.test(msg.attachmentName));

            return (
              <div
                key={msg.id}
                className={`group relative rounded-xl px-3 py-1.5 transition-colors ${
                  sameAuthor ? '' : 'mt-3 pt-2'
                } ${
                  isHighlighted
                    ? 'bg-violet-500/15 ring-1 ring-violet-500/40'
                    : 'hover:bg-white/[0.025]'
                }`}
              >
                {/* Reply Reference */}
                {isChannelMsg && msg.replyToId && (
                  <div className="flex items-center gap-2 pl-12 pb-1 text-xs text-slate-400">
                    <CornerUpLeft className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                    <span className="font-medium text-violet-300">{msg.replyToAuthor}</span>
                    <span className="truncate max-w-md text-slate-400">{msg.replyToSnippet}</span>
                  </div>
                )}

                <div className="flex items-start gap-3.5">
                  {sameAuthor ? (
                    <div className="w-9 shrink-0 flex items-center justify-end">
                      <span className="opacity-0 group-hover:opacity-100 text-[10px] font-mono text-slate-500 transition-opacity">
                        {msg.createdAt
                          ? msg.createdAt.toDate().toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : ''}
                      </span>
                    </div>
                  ) : (
                    <Avatar
                      name={authorName}
                      src={authorAvatar}
                      accentColor={authorAccent}
                      status={authorStatus}
                      showStatus
                      size="md"
                      className="mt-0.5"
                    />
                  )}

                  <div className="min-w-0 flex-1 space-y-1">
                    {!sameAuthor && (
                      <div className="flex items-baseline flex-wrap gap-2">
                        <span
                          style={
                            isChannelMsg && msg.authorRoleColor
                              ? { color: msg.authorRoleColor }
                              : undefined
                          }
                          className="text-sm font-semibold text-white"
                        >
                          {authorName}
                        </span>
                        {isChannelMsg && msg.authorRole && (
                          <span className="text-[11px] font-medium text-violet-300">
                            {msg.authorRole}
                          </span>
                        )}
                        <span className="text-[11px] font-mono text-slate-500">
                          {formatMessageTime(msg.createdAt)}
                        </span>
                        {isChannelMsg && msg.pinned && (
                          <span className="text-[11px] text-amber-400 font-medium">· Pinned</span>
                        )}
                      </div>
                    )}

                    {editingId === msg.id ? (
                      <div className="space-y-2 py-1">
                        <input
                          type="text"
                          value={editingText}
                          onChange={(e) => setEditingText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void handleSaveEdit(msg.id);
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                          className="w-full px-3 py-2 rounded-lg bg-[#0B0D14] border border-violet-500/50 text-sm text-white focus:outline-none"
                          autoFocus
                        />
                        <div className="flex items-center gap-2 text-xs">
                          <button
                            type="button"
                            onClick={() => void handleSaveEdit(msg.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-violet-600 text-white font-medium"
                          >
                            <Check className="w-3 h-3" /> Save
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="px-2.5 py-1 rounded-md bg-white/5 text-slate-300"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      msg.content && (
                        <p className="text-[15px] text-slate-200 leading-relaxed whitespace-pre-wrap break-words">
                          {renderMessageText(msg.content)}
                          {msg.edited && (
                            <span className="text-[11px] text-slate-500 ml-1.5">(edited)</span>
                          )}
                        </p>
                      )
                    )}

                    {/* Attachment Rendering */}
                    {msg.attachmentUrl && (
                      <div className="pt-1">
                        {isImageAttachment ? (
                          <a
                            href={msg.attachmentUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-block max-w-sm rounded-xl overflow-hidden border border-white/10 bg-[#0B0D14]"
                          >
                            <img
                              src={msg.attachmentUrl}
                              alt={msg.attachmentName || 'Attachment'}
                              referrerPolicy="no-referrer"
                              className="max-h-72 object-contain"
                            />
                          </a>
                        ) : (
                          <a
                            href={msg.attachmentUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-[#0B0D14] border border-white/10 hover:border-violet-500/40 text-xs text-slate-200 transition-colors"
                          >
                            <FileText className="w-4 h-4 text-blue-400 shrink-0" />
                            <span className="truncate max-w-xs">{msg.attachmentName || 'Download attachment'}</span>
                          </a>
                        )}
                      </div>
                    )}

                    {/* Reaction Chips */}
                    {reactions.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 pt-1">
                        {reactions.map((r) => (
                          <button
                            key={r.emoji}
                            type="button"
                            onClick={() => void onToggleReaction(msg.id, msg.reactionTokens || [], r.emoji)}
                            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-xs border transition-colors ${
                              r.reactedByMe
                                ? 'bg-violet-600/25 border-violet-500/50 text-violet-100'
                                : 'bg-[#0B0D14] border-white/[0.08] text-slate-300 hover:border-white/20'
                            }`}
                          >
                            <span>{r.emoji}</span>
                            <span className="font-mono text-[11px]">{r.count}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Hover Quick Actions Toolbar */}
                <div className="opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity absolute right-3 -top-3 z-10 flex items-center gap-0.5 bg-[#191D2D] border border-white/10 rounded-lg p-1 shadow-lg">
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() =>
                        setReactingMessageId(reactingMessageId === msg.id ? null : msg.id)
                      }
                      title="Add Reaction"
                      aria-label="Add Reaction"
                      className="p-1.5 rounded hover:bg-white/10 text-slate-300 hover:text-white"
                    >
                      <Smile className="w-3.5 h-3.5" />
                    </button>
                    {reactingMessageId === msg.id && (
                      <div className="absolute right-0 top-8 z-20 flex items-center gap-1 bg-[#1B2032] border border-white/10 rounded-xl p-1.5 shadow-xl">
                        {QUICK_EMOJIS.map((emoji) => (
                          <button
                            key={emoji}
                            type="button"
                            onClick={() => {
                              void onToggleReaction(msg.id, msg.reactionTokens || [], emoji);
                              setReactingMessageId(null);
                            }}
                            className="w-7 h-7 rounded-lg hover:bg-white/10 flex items-center justify-center text-sm"
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {mode === 'channel' && (
                    <button
                      type="button"
                      onClick={() => {
                        setReplyTo({
                          id: msg.id,
                          author: authorName,
                          snippet: msg.content || msg.attachmentName || 'Attachment',
                        });
                        inputRef.current?.focus();
                      }}
                      title="Reply"
                      aria-label="Reply"
                      className="p-1.5 rounded hover:bg-white/10 text-slate-300 hover:text-white"
                    >
                      <CornerUpLeft className="w-3.5 h-3.5" />
                    </button>
                  )}

                  {mode === 'channel' && canModerate && onTogglePin && isChannelMsg && (
                    <button
                      type="button"
                      onClick={() => void onTogglePin(msg.id, msg.pinned)}
                      title={msg.pinned ? 'Unpin message' : 'Pin message'}
                      aria-label={msg.pinned ? 'Unpin message' : 'Pin message'}
                      className={`p-1.5 rounded hover:bg-white/10 ${
                        msg.pinned ? 'text-amber-400' : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      <Pin className="w-3.5 h-3.5" />
                    </button>
                  )}

                  {isMine && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(msg.id);
                        setEditingText(msg.content);
                      }}
                      title="Edit message"
                      aria-label="Edit message"
                      className="p-1.5 rounded hover:bg-white/10 text-slate-300 hover:text-white"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                  )}

                  {canDelete && (
                    <button
                      type="button"
                      onClick={() => void onDeleteMessage(msg.id)}
                      title="Delete message"
                      aria-label="Delete message"
                      className="p-1.5 rounded hover:bg-rose-500/20 text-slate-300 hover:text-rose-400"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Composer Area */}
      <footer className="px-4 sm:px-6 pb-4 pt-1 shrink-0">
        {uploadError && (
          <div className="mb-2 px-3.5 py-2 rounded-xl bg-rose-500/10 border border-rose-500/25 text-xs text-rose-300 flex items-center justify-between gap-2">
            <span>{uploadError}</span>
            <button type="button" onClick={() => setUploadError(null)} className="text-rose-300 hover:text-white">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {(replyTo || pendingAttachment) && (
          <div className="mb-1.5 px-3.5 py-2 rounded-t-xl bg-[#1A1E2E] border border-b-0 border-white/[0.08] flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              {replyTo && (
                <span className="text-slate-300 truncate">
                  Replying to <strong className="text-violet-300">{replyTo.author}</strong>: {replyTo.snippet}
                </span>
              )}
              {pendingAttachment && (
                <span className="text-blue-300 truncate">
                  Attached: <strong>{pendingAttachment.name}</strong>
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                setReplyTo(null);
                setPendingAttachment(null);
              }}
              className="text-slate-400 hover:text-white shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <form
          onSubmit={handleSend}
          className={`relative flex items-end gap-2 bg-[#1A1E2B] border border-white/[0.09] focus-within:border-violet-500/50 transition-colors px-3 py-2 ${
            replyTo || pendingAttachment ? 'rounded-b-xl' : 'rounded-xl'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            onChange={handleFileSelected}
            className="hidden"
            accept="image/*,.pdf,.txt,.md,.json,.zip"
          />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            title="Upload image or file"
            aria-label="Upload image or file"
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors shrink-0 disabled:opacity-50"
          >
            <Paperclip className="w-4 h-4" />
          </button>

          <textarea
            ref={inputRef}
            rows={1}
            maxLength={2000}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              uploading
                ? 'Uploading attachment...'
                : mode === 'channel'
                ? `Message #${channel?.name || 'general'}${guildMembers.length > 1 ? ' (use @username to mention)' : ''}`
                : `Message ${dmPartner?.displayName || 'friend'}`
            }
            className="flex-1 bg-transparent text-sm text-white placeholder:text-slate-500 resize-none py-2 max-h-32 focus:outline-none gs-scroll"
          />

          <div className="relative flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setShowEmojiPicker((prev) => !prev)}
              title="Insert emoji"
              aria-label="Insert emoji"
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors"
            >
              <Smile className="w-4 h-4" />
            </button>

            {showEmojiPicker && (
              <div className="absolute right-0 bottom-12 z-20 flex items-center gap-1 bg-[#1B2032] border border-white/10 rounded-xl p-1.5 shadow-xl">
                {QUICK_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => {
                      setDraft((d) => `${d}${emoji}`);
                      setShowEmojiPicker(false);
                      inputRef.current?.focus();
                    }}
                    className="w-8 h-8 rounded-lg hover:bg-white/10 flex items-center justify-center text-base"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}

            <button
              type="submit"
              disabled={sending || uploading || (!draft.trim() && !pendingAttachment)}
              aria-label="Send message"
              className="p-2 rounded-lg bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-500 hover:to-blue-500 text-white disabled:opacity-40 transition-all"
            >
              <SendHorizontal className="w-4 h-4" />
            </button>
          </div>
        </form>
      </footer>
    </main>
  );
};
