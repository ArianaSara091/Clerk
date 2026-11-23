import React, { useEffect, useState } from 'react';
import {
  Bell,
  Check,
  CheckCheck,
  Menu,
  MessageSquare,
  Search,
  Trash2,
  UserCheck,
  UserMinus,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import {
  AppNotification,
  FriendRequest,
  Friendship,
  STATUS_META,
  UserProfile,
} from '../types/guildspace';
import { formatRelativeTime } from '../lib/validation';
import { searchPublicUsers } from '../services/guildspaceApi';
import { Avatar } from './Avatar';

interface FriendsAndHomeViewProps {
  section: 'friends' | 'notifications';
  profile: UserProfile;
  userDirectory: Record<string, UserProfile>;
  friendships: Friendship[];
  incomingRequests: FriendRequest[];
  outgoingRequests: FriendRequest[];
  notifications: AppNotification[];
  onOpenMobileMenu: () => void;
  onOpenSearch: () => void;
  onStartDm: (partner: UserProfile) => void;
  onSendFriendRequest: (target: UserProfile) => Promise<void>;
  onRespondFriendRequest: (req: FriendRequest, decision: 'accepted' | 'declined') => Promise<void>;
  onCancelFriendRequest: (requestId: string) => Promise<void>;
  onRemoveFriend: (friendshipId: string) => Promise<void>;
  onMarkNotificationRead: (id: string) => Promise<void>;
  onMarkAllNotificationsRead: () => Promise<void>;
  onDeleteNotification: (id: string) => Promise<void>;
  onNavigateNotification: (notif: AppNotification) => void;
  onSectionChange: (section: 'friends' | 'notifications') => void;
}

export const FriendsAndHomeView: React.FC<FriendsAndHomeViewProps> = ({
  section,
  profile,
  userDirectory,
  friendships,
  incomingRequests,
  outgoingRequests,
  notifications,
  onOpenMobileMenu,
  onOpenSearch,
  onStartDm,
  onSendFriendRequest,
  onRespondFriendRequest,
  onCancelFriendRequest,
  onRemoveFriend,
  onMarkNotificationRead,
  onMarkAllNotificationsRead,
  onDeleteNotification,
  onNavigateNotification,
  onSectionChange,
}) => {
  const [friendTab, setFriendTab] = useState<'online' | 'all' | 'pending' | 'add'>('online');
  const [directoryQuery, setDirectoryQuery] = useState('');
  const [directoryResults, setDirectoryResults] = useState<UserProfile[]>([]);
  const [searchingUsers, setSearchingUsers] = useState(false);
  const [sentFeedbackId, setSentFeedbackId] = useState<string | null>(null);

  const friendIds = new Set(
    friendships.map((f) => (f.uid1 === profile.uid ? f.uid2 : f.uid1))
  );
  const outgoingSet = new Set(outgoingRequests.map((r) => r.toId));
  const incomingSet = new Set(incomingRequests.map((r) => r.fromId));

  const friendProfiles = friendships
    .map((f) => {
      const otherUid = f.uid1 === profile.uid ? f.uid2 : f.uid1;
      return {
        friendshipId: f.id,
        user: userDirectory[otherUid],
        uid: otherUid,
      };
    })
    .filter((entry): entry is { friendshipId: string; user: UserProfile; uid: string } => Boolean(entry.user));

  const visibleFriends =
    friendTab === 'online'
      ? friendProfiles.filter((entry) => entry.user.status !== 'offline')
      : friendProfiles;

  useEffect(() => {
    if (section !== 'friends' || friendTab !== 'add') return;
    let active = true;
    const load = async () => {
      setSearchingUsers(true);
      try {
        const res = await searchPublicUsers(directoryQuery);
        if (active) {
          setDirectoryResults(res.filter((u) => u.uid !== profile.uid));
        }
      } finally {
        if (active) setSearchingUsers(false);
      }
    };
    const timer = setTimeout(load, 180);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [section, friendTab, directoryQuery, profile.uid]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <main className="flex-1 min-w-0 h-full bg-[#131622] flex flex-col">
      {/* Header Bar */}
      <header className="h-14 px-4 sm:px-6 border-b border-white/[0.06] flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onOpenMobileMenu}
            aria-label="Open navigation menu"
            className="md:hidden p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06]"
          >
            <Menu className="w-5 h-5" />
          </button>

          {section === 'friends' ? (
            <div className="flex items-center gap-3 overflow-x-auto gs-scroll-none">
              <div className="flex items-center gap-2 text-white font-display font-bold text-sm whitespace-nowrap shrink-0">
                <Users className="w-4 h-4 text-violet-400" />
                <span>Friends</span>
              </div>
              <span className="h-4 w-px bg-white/10 shrink-0" />
              <div className="flex items-center gap-1 shrink-0">
                {(
                  [
                    { id: 'online', label: 'Online' },
                    { id: 'all', label: 'All' },
                    {
                      id: 'pending',
                      label: `Pending${incomingRequests.length ? ` (${incomingRequests.length})` : ''}`,
                    },
                    { id: 'add', label: 'Add Friend' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setFriendTab(tab.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      tab.id === 'add'
                        ? friendTab === 'add'
                          ? 'bg-gradient-to-r from-violet-600 to-blue-600 text-white'
                          : 'bg-violet-600/20 text-violet-200 hover:bg-violet-600/30'
                        : friendTab === tab.id
                        ? 'bg-white/[0.09] text-white'
                        : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-white font-display font-bold text-sm">
              <Bell className="w-4 h-4 text-violet-400" />
              <span>Notifications</span>
              {unreadCount > 0 && (
                <span className="text-xs font-mono font-normal text-slate-400">
                  · {unreadCount} unread
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {section === 'notifications' && unreadCount > 0 && (
            <button
              type="button"
              onClick={() => void onMarkAllNotificationsRead()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-xs font-medium text-slate-200 transition-colors whitespace-nowrap"
            >
              <CheckCheck className="w-3.5 h-3.5 text-violet-400" />
              Mark all read
            </button>
          )}
          <button
            type="button"
            onClick={() => onSectionChange(section === 'friends' ? 'notifications' : 'friends')}
            className="px-3 py-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.09] text-xs font-medium text-slate-300 whitespace-nowrap"
          >
            {section === 'friends' ? 'Notifications' : 'Friends'}
          </button>
          <button
            type="button"
            onClick={onOpenSearch}
            title="Search"
            aria-label="Search"
            className="p-2 rounded-lg bg-[#0B0D14] border border-white/[0.08] text-slate-400 hover:text-white"
          >
            <Search className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto gs-scroll p-6">
        {section === 'friends' ? (
          <div className="max-w-3xl mx-auto space-y-6">
            {friendTab === 'add' ? (
              <div className="space-y-4">
                <div className="space-y-1">
                  <h2 className="text-lg font-bold font-display text-white">Add Friend</h2>
                  <p className="text-xs text-slate-400">
                    Search Clerk members by display name or @username to send a friend request.
                  </p>
                </div>

                <div className="relative">
                  <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={directoryQuery}
                    onChange={(e) => setDirectoryQuery(e.target.value)}
                    placeholder="Search users by name or @username..."
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-[#0B0D14] border border-white/10 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-500"
                  />
                </div>

                {searchingUsers ? (
                  <div className="py-10 text-center text-xs text-slate-400">Searching directory...</div>
                ) : directoryResults.length === 0 ? (
                  <div className="py-10 text-center text-sm text-slate-500 border border-white/[0.06] rounded-2xl bg-[#10131D]">
                    No matching Clerk users found yet.
                  </div>
                ) : (
                  <div className="divide-y divide-white/[0.06] border border-white/[0.06] rounded-2xl bg-[#10131D] overflow-hidden">
                    {directoryResults.map((user) => {
                      const isFriend = friendIds.has(user.uid);
                      const isSent = outgoingSet.has(user.uid) || sentFeedbackId === user.uid;
                      const hasIncoming = incomingSet.has(user.uid);

                      return (
                        <div
                          key={user.uid}
                          className="px-4 py-3 flex items-center justify-between gap-4 hover:bg-white/[0.02]"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <Avatar
                              name={user.displayName}
                              src={user.avatarUrl}
                              accentColor={user.accentColor}
                              status={user.status}
                              showStatus
                              size="md"
                            />
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-white truncate">
                                {user.displayName}
                              </div>
                              <div className="text-xs text-slate-400 truncate">
                                @{user.username} · {STATUS_META[user.status].label}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => onStartDm(user)}
                              className="px-3 py-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-xs font-medium text-slate-200 transition-colors whitespace-nowrap"
                            >
                              Message
                            </button>
                            {isFriend ? (
                              <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-300 text-xs font-medium whitespace-nowrap">
                                <UserCheck className="w-3.5 h-3.5" />
                                Friends
                              </span>
                            ) : hasIncoming ? (
                              <button
                                type="button"
                                onClick={() => setFriendTab('pending')}
                                className="px-3 py-1.5 rounded-lg bg-blue-600/20 text-blue-300 text-xs font-medium whitespace-nowrap"
                              >
                                Respond in Pending
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled={isSent}
                                onClick={async () => {
                                  await onSendFriendRequest(user);
                                  setSentFeedbackId(user.uid);
                                }}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-500 hover:to-blue-500 disabled:opacity-50 text-white text-xs font-medium transition-colors whitespace-nowrap"
                              >
                                <UserPlus className="w-3.5 h-3.5" />
                                {isSent ? 'Request Sent' : 'Add Friend'}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : friendTab === 'pending' ? (
              <div className="space-y-6">
                <div className="space-y-2">
                  <h2 className="text-sm font-semibold text-slate-300">
                    Incoming Requests ({incomingRequests.length})
                  </h2>
                  {incomingRequests.length === 0 ? (
                    <div className="p-6 text-center text-xs text-slate-500 rounded-2xl border border-white/[0.06] bg-[#10131D]">
                      No incoming friend requests.
                    </div>
                  ) : (
                    <div className="divide-y divide-white/[0.06] border border-white/[0.06] rounded-2xl bg-[#10131D] overflow-hidden">
                      {incomingRequests.map((req) => (
                        <div key={req.id} className="px-4 py-3 flex items-center justify-between gap-4">
                          <div className="flex items-center gap-3 min-w-0">
                            <Avatar name={req.fromName} src={req.fromAvatar} size="md" />
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-white truncate">{req.fromName}</div>
                              <div className="text-xs text-slate-400 truncate">@{req.fromUsername}</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => void onRespondFriendRequest(req, 'accepted')}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium"
                            >
                              <Check className="w-3.5 h-3.5" /> Accept
                            </button>
                            <button
                              type="button"
                              onClick={() => void onRespondFriendRequest(req, 'declined')}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-rose-500/20 text-slate-300 hover:text-rose-300 text-xs font-medium"
                            >
                              <X className="w-3.5 h-3.5" /> Decline
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <h2 className="text-sm font-semibold text-slate-300">
                    Sent Requests ({outgoingRequests.length})
                  </h2>
                  {outgoingRequests.length === 0 ? (
                    <div className="p-6 text-center text-xs text-slate-500 rounded-2xl border border-white/[0.06] bg-[#10131D]">
                      No outgoing pending requests.
                    </div>
                  ) : (
                    <div className="divide-y divide-white/[0.06] border border-white/[0.06] rounded-2xl bg-[#10131D] overflow-hidden">
                      {outgoingRequests.map((req) => (
                        <div key={req.id} className="px-4 py-3 flex items-center justify-between gap-4">
                          <div className="flex items-center gap-3 min-w-0">
                            <Avatar name={req.toName} src={req.toAvatar} size="md" />
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-white truncate">{req.toName}</div>
                              <div className="text-xs text-slate-400 truncate">
                                @{req.toUsername} · Pending
                              </div>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => void onCancelFriendRequest(req.id)}
                            className="px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-rose-500/20 text-xs font-medium text-slate-300 hover:text-rose-300"
                          >
                            Cancel
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : visibleFriends.length === 0 ? (
              <div className="p-10 text-center rounded-2xl border border-white/[0.06] bg-[#10131D] space-y-3">
                <Users className="w-8 h-8 text-violet-400 mx-auto" />
                <h3 className="text-base font-semibold font-display text-white">
                  {friendTab === 'online' ? 'No friends online right now' : 'No friends added yet'}
                </h3>
                <p className="text-xs text-slate-400 max-w-sm mx-auto">
                  Find members in your servers or search the Clerk directory to connect and start direct messaging.
                </p>
                <button
                  type="button"
                  onClick={() => setFriendTab('add')}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 text-white text-xs font-semibold"
                >
                  <UserPlus className="w-4 h-4" />
                  Find Friends
                </button>
              </div>
            ) : (
              <div className="divide-y divide-white/[0.06] border border-white/[0.06] rounded-2xl bg-[#10131D] overflow-hidden">
                {visibleFriends.map(({ friendshipId, user }) => (
                  <div
                    key={friendshipId}
                    className="px-4 py-3 flex items-center justify-between gap-4 hover:bg-white/[0.02]"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar
                        name={user.displayName}
                        src={user.avatarUrl}
                        accentColor={user.accentColor}
                        status={user.status}
                        showStatus
                        size="md"
                      />
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-white truncate">{user.displayName}</div>
                        <div className="text-xs text-slate-400 truncate">
                          @{user.username} · {user.customStatus || STATUS_META[user.status].label}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => onStartDm(user)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600/20 hover:bg-violet-600/35 text-violet-200 text-xs font-medium transition-colors"
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                        Message
                      </button>
                      <button
                        type="button"
                        onClick={() => void onRemoveFriend(friendshipId)}
                        title="Remove friend"
                        aria-label="Remove friend"
                        className="p-2 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/15 transition-colors"
                      >
                        <UserMinus className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* Notifications Feed */
          <div className="max-w-3xl mx-auto space-y-3">
            {notifications.length === 0 ? (
              <div className="p-10 text-center rounded-2xl border border-white/[0.06] bg-[#10131D] space-y-2">
                <Bell className="w-8 h-8 text-blue-400 mx-auto" />
                <h3 className="text-base font-semibold font-display text-white">You&apos;re all caught up</h3>
                <p className="text-xs text-slate-400">
                  Mentions, direct messages, role updates, and friend requests appear here in real time.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-white/[0.06] border border-white/[0.06] rounded-2xl bg-[#10131D] overflow-hidden">
                {notifications.map((notif) => (
                  <div
                    key={notif.id}
                    className={`px-4 py-3.5 flex items-start justify-between gap-4 transition-colors ${
                      notif.read ? 'opacity-70' : 'bg-violet-500/[0.05]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        if (!notif.read) void onMarkNotificationRead(notif.id);
                        onNavigateNotification(notif);
                      }}
                      className="flex items-start gap-3 text-left min-w-0 flex-1"
                    >
                      <Avatar name={notif.actorName} src={notif.actorAvatar} size="md" />
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-white truncate">{notif.title}</span>
                          <span className="text-[11px] font-mono text-slate-500 shrink-0">
                            {formatRelativeTime(notif.createdAt)}
                          </span>
                        </div>
                        <p className="text-xs text-slate-300 leading-relaxed">{notif.body}</p>
                      </div>
                    </button>

                    <div className="flex items-center gap-1 shrink-0">
                      {!notif.read && (
                        <button
                          type="button"
                          onClick={() => void onMarkNotificationRead(notif.id)}
                          title="Mark read"
                          aria-label="Mark read"
                          className="p-1.5 rounded-lg text-violet-400 hover:bg-violet-500/15"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void onDeleteNotification(notif.id)}
                        title="Delete notification"
                        aria-label="Delete notification"
                        className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/15"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
};
