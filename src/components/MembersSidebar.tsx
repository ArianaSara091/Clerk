import React, { useState } from 'react';
import { Crown, Link2, MessageSquare, Shield, ShieldAlert, UserMinus, UserPlus } from 'lucide-react';
import {
  EMPTY_LINKED_DISCORD,
  Guild,
  GuildMember,
  GuildRole,
  GuildRoleType,
  STATUS_META,
  UserProfile,
} from '../types/guildspace';
import { Avatar } from './Avatar';

interface MembersSidebarProps {
  guild: Guild;
  members: GuildMember[];
  roles: GuildRole[];
  userDirectory: Record<string, UserProfile>;
  currentUid: string;
  myMembership: GuildMember | undefined;
  friendUids: Set<string>;
  onStartDm: (target: UserProfile) => void;
  onAddFriend: (target: UserProfile) => void;
  onAssignRole: (
    targetUid: string,
    role: GuildRoleType,
    customRole?: { id: string; name: string; color: string } | null
  ) => void;
  onKickMember: (targetUid: string) => void;
}

export const MembersSidebar: React.FC<MembersSidebarProps> = ({
  guild,
  members,
  roles,
  userDirectory,
  currentUid,
  myMembership,
  friendUids,
  onStartDm,
  onAddFriend,
  onAssignRole,
  onKickMember,
}) => {
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const canAdminister = myMembership?.role === 'owner' || myMembership?.role === 'admin';

  const enriched = members.map((m) => {
    const live = userDirectory[m.uid];
    const status = live?.status || 'offline';
    return {
      member: m,
      live,
      status,
      displayName: live?.displayName || m.displayName,
      username: live?.username || m.username,
      avatarUrl: live?.avatarUrl ?? m.avatarUrl,
      accentColor: live?.accentColor || guild.accentColor,
      customStatus: live?.customStatus || '',
      bio: live?.bio || '',
      linkedDiscord: live?.linkedDiscord?.id ? live.linkedDiscord : null,
    };
  });

  const roleOrder: Record<GuildRoleType, number> = { owner: 0, admin: 1, moderator: 2, member: 3 };
  enriched.sort((a, b) => {
    const rDiff = roleOrder[a.member.role] - roleOrder[b.member.role];
    if (rDiff !== 0) return rDiff;
    return a.displayName.localeCompare(b.displayName);
  });

  const onlineList = enriched.filter((item) => item.status !== 'offline');
  const offlineList = enriched.filter((item) => item.status === 'offline');

  const selectedItem = enriched.find((item) => item.member.uid === selectedUid) || null;

  const renderRoleBadge = (m: GuildMember) => {
    if (m.role === 'owner') {
      return <Crown className="w-3.5 h-3.5 text-amber-400 shrink-0" aria-label="Owner" />;
    }
    if (m.role === 'admin') {
      return <ShieldAlert className="w-3.5 h-3.5 text-violet-400 shrink-0" aria-label="Admin" />;
    }
    if (m.role === 'moderator') {
      return <Shield className="w-3.5 h-3.5 text-blue-400 shrink-0" aria-label="Moderator" />;
    }
    return null;
  };

  const renderGroup = (title: string, list: typeof enriched, dimmed = false) => {
    if (list.length === 0) return null;
    return (
      <div className="space-y-1">
        <div className="px-2.5 text-xs font-semibold text-slate-500">
          {title} — <span className="font-mono">{list.length}</span>
        </div>
        <div className="space-y-0.5">
          {list.map((item) => {
            const isSelected = selectedUid === item.member.uid;
            return (
              <button
                key={item.member.uid}
                type="button"
                onClick={() => setSelectedUid(isSelected ? null : item.member.uid)}
                className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left transition-colors ${
                  isSelected
                    ? 'bg-violet-600/15 border border-violet-500/30'
                    : 'hover:bg-white/[0.04] border border-transparent'
                } ${dimmed ? 'opacity-60 hover:opacity-100' : ''}`}
              >
                <Avatar
                  name={item.displayName}
                  src={item.avatarUrl}
                  accentColor={item.accentColor}
                  status={item.status}
                  showStatus
                  size="sm"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span
                      style={item.member.customRoleColor ? { color: item.member.customRoleColor } : undefined}
                      className="text-sm font-medium text-slate-200 truncate"
                    >
                      {item.displayName}
                    </span>
                    {renderRoleBadge(item.member)}
                  </div>
                  {(item.member.customRoleName || item.customStatus) && (
                    <div className="text-[11px] text-slate-500 truncate">
                      {item.member.customRoleName
                        ? item.member.customRoleName
                        : item.customStatus}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const buildFallbackProfile = (item: NonNullable<typeof selectedItem>): UserProfile => ({
    uid: item.member.uid,
    displayName: item.displayName,
    username: item.username,
    avatarUrl: item.avatarUrl,
    bio: item.bio,
    accentColor: item.accentColor,
    status: item.status,
    customStatus: item.customStatus,
    isVerified: true,
    twoFactorEnabled: false,
    linkedDiscord: item.linkedDiscord || EMPTY_LINKED_DISCORD,
    visibility: 'public',
    lastSeenAt: null,
    createdAt: null,
    updatedAt: null,
  });

  return (
    <aside
      aria-label="Server members"
      className="w-[248px] shrink-0 h-full bg-[#10131D] border-l border-white/[0.06] flex flex-col select-none"
    >
      <div className="h-14 px-4 border-b border-white/[0.06] flex items-center justify-between shrink-0">
        <span className="text-sm font-semibold font-display text-white">Members</span>
        <span className="text-xs font-mono text-slate-400">
          {onlineList.length}/{enriched.length}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto gs-scroll px-2.5 py-3 space-y-5">
        {renderGroup('Online', onlineList)}
        {renderGroup('Offline', offlineList, true)}
      </div>

      {/* Selected Member Inspector Drawer */}
      {selectedItem && (
        <div className="p-3.5 bg-[#151927] border-t border-white/10 space-y-3 shrink-0">
          <div className="flex items-start gap-3">
            <Avatar
              name={selectedItem.displayName}
              src={selectedItem.avatarUrl}
              accentColor={selectedItem.accentColor}
              status={selectedItem.status}
              showStatus
              size="md"
            />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-white truncate">{selectedItem.displayName}</div>
              <div className="text-xs text-slate-400 truncate">
                @{selectedItem.username} · {STATUS_META[selectedItem.status].label}
              </div>
              <div className="text-[11px] text-violet-300 mt-0.5">
                {selectedItem.member.customRoleName || selectedItem.member.role}
              </div>
            </div>
          </div>

          {selectedItem.linkedDiscord && (
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#5865F2]/15 border border-[#5865F2]/30 text-[11px] text-indigo-200 truncate">
              <Link2 className="w-3 h-3 text-[#8B97FF] shrink-0" />
              <span className="truncate">Discord: @{selectedItem.linkedDiscord.username}</span>
            </div>
          )}

          {selectedItem.bio && (
            <p className="text-xs text-slate-300 leading-relaxed line-clamp-3">{selectedItem.bio}</p>
          )}

          {selectedItem.member.uid !== currentUid && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onStartDm(selectedItem.live || buildFallbackProfile(selectedItem))}
                className="flex-1 flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium transition-colors whitespace-nowrap"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                Message
              </button>
              {!friendUids.has(selectedItem.member.uid) && (
                <button
                  type="button"
                  onClick={() => onAddFriend(selectedItem.live || buildFallbackProfile(selectedItem))}
                  title="Send Friend Request"
                  aria-label="Send Friend Request"
                  className="p-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-slate-200 transition-colors"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}

          {canAdminister &&
            selectedItem.member.uid !== currentUid &&
            selectedItem.member.role !== 'owner' && (
              <div className="pt-2 border-t border-white/[0.08] space-y-2">
                <label className="block text-[11px] font-medium text-slate-400">
                  Assign Permission Role
                </label>
                <div className="flex items-center gap-1.5">
                  <select
                    value={selectedItem.member.role}
                    onChange={(e) => {
                      const nextRole = e.target.value as GuildRoleType;
                      onAssignRole(selectedItem.member.uid, nextRole, null);
                    }}
                    className="flex-1 bg-[#0B0D14] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-violet-500"
                  >
                    <option value="member">Member</option>
                    <option value="moderator">Moderator</option>
                    {myMembership?.role === 'owner' && <option value="admin">Admin</option>}
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      onKickMember(selectedItem.member.uid);
                      setSelectedUid(null);
                    }}
                    title="Remove from Server"
                    aria-label="Remove from Server"
                    className="p-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-400 transition-colors"
                  >
                    <UserMinus className="w-4 h-4" />
                  </button>
                </div>

                {roles.length > 0 && (
                  <select
                    value={selectedItem.member.customRoleId}
                    onChange={(e) => {
                      const found = roles.find((r) => r.id === e.target.value) || null;
                      onAssignRole(
                        selectedItem.member.uid,
                        selectedItem.member.role,
                        found ? { id: found.id, name: found.name, color: found.color } : null
                      );
                    }}
                    className="w-full bg-[#0B0D14] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-violet-500"
                  >
                    <option value="">No Custom Tag</option>
                    {roles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}
        </div>
      )}
    </aside>
  );
};
