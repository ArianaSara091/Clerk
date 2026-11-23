import React, { useEffect, useState } from 'react';
import { Compass, Hash, Link2, Plus, Shield, Trash2, Upload, Users, Volume2, X } from 'lucide-react';
import {
  ACCENT_SWATCHES,
  ChannelType,
  Guild,
  GuildChannel,
  GuildInvite,
  GuildMember,
  GuildRole,
  PermissionKey,
  UserProfile,
} from '../types/guildspace';
import { extractInviteCode } from '../lib/validation';
import {
  createChannel,
  createGuildRole,
  createGuildWithDefaults,
  deleteChannel,
  deleteGuild,
  deleteGuildRole,
  joinGuild,
  lookupInviteCode,
  searchPublicGuilds,
  updateChannel,
  updateGuildSettings,
  uploadMediaFile,
} from '../services/guildspaceApi';

const ALL_PERMISSIONS: { key: PermissionKey; label: string }[] = [
  { key: 'MANAGE_CHANNELS', label: 'Manage Channels' },
  { key: 'MANAGE_MESSAGES', label: 'Manage & Pin Messages' },
  { key: 'KICK_MEMBERS', label: 'Remove Members' },
  { key: 'MANAGE_ROLES', label: 'Manage Roles' },
];

export const CreateOrJoinGuildModal: React.FC<{
  profile: UserProfile;
  initialTab?: 'create' | 'join';
  initialInviteCode?: string;
  onClose: () => void;
  onCreatedOrJoined: (guildId: string, channelId?: string) => void;
}> = ({ profile, initialTab = 'create', initialInviteCode = '', onClose, onCreatedOrJoined }) => {
  const [tab, setTab] = useState<'create' | 'join'>(initialInviteCode ? 'join' : initialTab);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [iconUrl, setIconUrl] = useState('');
  const [accentColor, setAccentColor] = useState<string>(ACCENT_SWATCHES[0]);
  const [isPublic, setIsPublic] = useState(true);
  const [inviteCode, setInviteCode] = useState(initialInviteCode);
  const [invitePreview, setInvitePreview] = useState<GuildInvite | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!initialInviteCode) return;
    let active = true;
    setTab('join');
    setInviteCode(initialInviteCode);
    (async () => {
      setSubmitting(true);
      try {
        const found = await lookupInviteCode(initialInviteCode);
        if (!active) return;
        if (!found) {
          setError('No Clerk server matches that invitation link.');
        } else {
          setInvitePreview(found);
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Invite lookup failed.');
      } finally {
        if (active) setSubmitting(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [initialInviteCode]);

  const handleIconUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const uploaded = await uploadMediaFile(file, `guild_icons/${profile.uid}`);
      setIconUrl(uploaded.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Icon upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim().length < 2) {
      setError('Server name must be at least 2 characters.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const { guildId, defaultChannelId } = await createGuildWithDefaults(profile, {
        name,
        description,
        iconUrl,
        accentColor,
        isPublic,
      });
      onCreatedOrJoined(guildId, defaultChannelId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create server.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleLookupInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInvitePreview(null);
    const extracted = extractInviteCode(inviteCode);
    if (extracted.length < 6) {
      setError('Paste a valid Clerk invitation link or invite code.');
      return;
    }
    setSubmitting(true);
    try {
      const found = await lookupInviteCode(extracted);
      if (!found) {
        setError('No Clerk server matches that invite link or code.');
      } else {
        setInvitePreview(found);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invite lookup failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleJoinByInvite = async () => {
    if (!invitePreview) return;
    setSubmitting(true);
    setError(null);
    try {
      await joinGuild(
        profile,
        {
          id: invitePreview.guildId,
          name: invitePreview.guildName,
          iconUrl: invitePreview.guildIcon,
          accentColor: invitePreview.guildAccent,
        },
        invitePreview.inviteCode
      );
      onCreatedOrJoined(invitePreview.guildId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join server.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-[#131622] border border-white/10 rounded-2xl overflow-hidden shadow-2xl">
        <div className="px-6 py-4 border-b border-white/[0.06] flex items-center justify-between">
          <h2 className="text-lg font-bold font-display text-white">Clerk Server Setup</h2>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-[#0B0D14] border border-white/[0.06]">
            <button
              type="button"
              onClick={() => {
                setTab('create');
                setError(null);
              }}
              className={`py-2 text-xs font-semibold rounded-lg transition-colors ${
                tab === 'create' ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Create Server
            </button>
            <button
              type="button"
              onClick={() => {
                setTab('join');
                setError(null);
              }}
              className={`py-2 text-xs font-semibold rounded-lg transition-colors ${
                tab === 'join' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Join via Invite Link
            </button>
          </div>

          {error && (
            <div className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/25 rounded-xl px-3.5 py-2.5">
              {error}
            </div>
          )}

          {tab === 'create' ? (
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="flex items-center gap-4">
                <div
                  style={{ backgroundColor: iconUrl ? undefined : accentColor }}
                  className="w-14 h-14 rounded-2xl overflow-hidden flex items-center justify-center font-display font-bold text-lg text-white shrink-0 border border-white/10"
                >
                  {iconUrl ? (
                    <img src={iconUrl} alt="Server icon" className="w-full h-full object-cover" />
                  ) : (
                    (name.trim()[0] || 'C').toUpperCase()
                  )}
                </div>
                <div className="space-y-1.5 flex-1">
                  <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-xs font-medium text-slate-200 cursor-pointer transition-colors">
                    <Upload className="w-3.5 h-3.5" />
                    <span>{uploading ? 'Uploading...' : 'Upload Icon'}</span>
                    <input type="file" accept="image/*" onChange={handleIconUpload} className="hidden" />
                  </label>
                  <p className="text-[11px] text-slate-500">Or choose an accent color below.</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {ACCENT_SWATCHES.map((swatch) => (
                  <button
                    key={swatch}
                    type="button"
                    onClick={() => setAccentColor(swatch)}
                    style={{ backgroundColor: swatch }}
                    aria-label={`Select accent ${swatch}`}
                    className={`w-6 h-6 rounded-full transition-transform ${
                      accentColor === swatch ? 'ring-2 ring-white scale-110' : 'opacity-70 hover:opacity-100'
                    }`}
                  />
                ))}
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-300">Server Name</label>
                <input
                  type="text"
                  required
                  minLength={2}
                  maxLength={60}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Design Collective"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#0B0D14] border border-white/10 text-sm text-white focus:outline-none focus:border-violet-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-300">Description</label>
                <textarea
                  rows={2}
                  maxLength={300}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What is this Clerk server about?"
                  className="w-full px-3.5 py-2 rounded-xl bg-[#0B0D14] border border-white/10 text-sm text-white resize-none focus:outline-none focus:border-violet-500"
                />
              </div>

              <label className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl bg-[#0B0D14] border border-white/[0.08] cursor-pointer">
                <div>
                  <div className="text-xs font-semibold text-white">Public Discovery</div>
                  <div className="text-[11px] text-slate-400">List in Explore Clerk Servers</div>
                </div>
                <input
                  type="checkbox"
                  checked={isPublic}
                  onChange={(e) => setIsPublic(e.target.checked)}
                  className="w-4 h-4 accent-violet-600"
                />
              </label>

              <button
                type="submit"
                disabled={submitting || uploading}
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-500 hover:to-blue-500 text-white text-sm font-semibold transition-all disabled:opacity-50"
              >
                {submitting ? 'Creating Server...' : 'Create Server'}
              </button>
            </form>
          ) : (
            <div className="space-y-4">
              <form onSubmit={handleLookupInvite} className="space-y-3">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-300">
                    Invitation Link or Code
                  </label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Link2 className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="text"
                        required
                        value={inviteCode}
                        onChange={(e) => setInviteCode(e.target.value)}
                        placeholder="https://.../?invite=CF9X4K2M or CF9X4K2M"
                        className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-[#0B0D14] border border-white/10 text-xs font-mono text-white focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={submitting}
                      className="px-4 py-2.5 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] text-xs font-semibold text-white whitespace-nowrap"
                    >
                      Look Up
                    </button>
                  </div>
                </div>
              </form>

              {invitePreview && (
                <div className="p-4 rounded-xl bg-[#0B0D14] border border-white/10 space-y-3">
                  <div className="flex items-center gap-3">
                    <div
                      style={{ backgroundColor: invitePreview.guildIcon ? undefined : invitePreview.guildAccent }}
                      className="w-11 h-11 rounded-xl overflow-hidden flex items-center justify-center font-display font-bold text-white shrink-0"
                    >
                      {invitePreview.guildIcon ? (
                        <img src={invitePreview.guildIcon} alt={invitePreview.guildName} className="w-full h-full object-cover" />
                      ) : (
                        invitePreview.guildName[0]?.toUpperCase()
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-white truncate">{invitePreview.guildName}</div>
                      <div className="text-xs text-slate-400 truncate">
                        {invitePreview.guildDescription || 'Ready to join on Clerk'}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={handleJoinByInvite}
                    className="w-full py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 text-white text-xs font-semibold"
                  >
                    {submitting ? 'Joining...' : `Join ${invitePreview.guildName}`}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const DiscoverGuildsModal: React.FC<{
  profile: UserProfile;
  joinedGuildIds: Set<string>;
  onClose: () => void;
  onSelectOrJoin: (guildId: string) => void;
}> = ({ profile, joinedGuildIds, onClose, onSelectOrJoin }) => {
  const [queryText, setQueryText] = useState('');
  const [guilds, setGuilds] = useState<Guild[]>([]);
  const [loading, setLoading] = useState(true);
  const [joiningId, setJoiningId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      try {
        const res = await searchPublicGuilds(queryText);
        if (active) setGuilds(res);
      } finally {
        if (active) setLoading(false);
      }
    };
    const timer = setTimeout(load, 180);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [queryText]);

  const handleJoin = async (guild: Guild) => {
    if (joinedGuildIds.has(guild.id)) {
      onSelectOrJoin(guild.id);
      onClose();
      return;
    }
    setJoiningId(guild.id);
    try {
      await joinGuild(profile, guild, guild.inviteCode);
      onSelectOrJoin(guild.id);
      onClose();
    } finally {
      setJoiningId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-[#131622] border border-white/10 rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[82vh]">
        <div className="px-6 py-4 border-b border-white/[0.06] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Compass className="w-5 h-5 text-blue-400" />
            <h2 className="text-lg font-bold font-display text-white">Explore Clerk Servers</h2>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 border-b border-white/[0.06]">
          <input
            type="text"
            value={queryText}
            onChange={(e) => setQueryText(e.target.value)}
            placeholder="Filter public servers by name or topic..."
            className="w-full px-3.5 py-2.5 rounded-xl bg-[#0B0D14] border border-white/10 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="flex-1 overflow-y-auto gs-scroll p-5">
          {loading ? (
            <div className="py-12 text-center text-xs text-slate-400">Loading public servers...</div>
          ) : guilds.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-400">
              No public servers found yet. Create the first one!
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {guilds.map((g) => {
                const isJoined = joinedGuildIds.has(g.id);
                return (
                  <div
                    key={g.id}
                    className="p-4 rounded-xl bg-[#0B0D14] border border-white/[0.07] flex flex-col justify-between gap-4"
                  >
                    <div className="flex items-start gap-3">
                      <div
                        style={{ backgroundColor: g.iconUrl ? undefined : g.accentColor }}
                        className="w-11 h-11 rounded-xl overflow-hidden flex items-center justify-center font-display font-bold text-white shrink-0"
                      >
                        {g.iconUrl ? (
                          <img src={g.iconUrl} alt={g.name} className="w-full h-full object-cover" />
                        ) : (
                          g.name[0]?.toUpperCase()
                        )}
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-sm font-bold text-white truncate">{g.name}</h3>
                        <p className="text-xs text-slate-400 line-clamp-2 mt-0.5">
                          {g.description || 'Active Clerk community.'}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/[0.06]">
                      <span className="inline-flex items-center gap-1.5 text-xs font-mono text-slate-400">
                        <Users className="w-3.5 h-3.5" />
                        {g.memberCount}
                      </span>
                      <button
                        type="button"
                        disabled={joiningId === g.id}
                        onClick={() => void handleJoin(g)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                          isJoined
                            ? 'bg-white/[0.08] hover:bg-white/[0.14] text-white'
                            : 'bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-500 hover:to-blue-500 text-white'
                        }`}
                      >
                        {joiningId === g.id ? 'Joining...' : isJoined ? 'Open' : 'Join'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const ChannelModal: React.FC<{
  guildId: string;
  userId: string;
  existingChannel: GuildChannel | null;
  nextPosition: number;
  canDelete: boolean;
  onClose: () => void;
  onSaved: (channelId?: string) => void;
}> = ({ guildId, userId, existingChannel, nextPosition, canDelete, onClose, onSaved }) => {
  const [channelType, setChannelType] = useState<ChannelType>(existingChannel?.type || 'text');
  const [name, setName] = useState(existingChannel?.name || '');
  const [category, setCategory] = useState(
    existingChannel?.category || (existingChannel?.type === 'voice' ? 'Voice Channels' : 'Text Channels')
  );
  const [topic, setTopic] = useState(existingChannel?.topic || '');
  const [submitting, setSubmitting] = useState(false);

  const handleSelectType = (nextType: ChannelType) => {
    if (existingChannel) return;
    setChannelType(nextType);
    if (category === 'Text Channels' && nextType === 'voice') {
      setCategory('Voice Channels');
    } else if (category === 'Voice Channels' && nextType === 'text') {
      setCategory('Text Channels');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      if (existingChannel) {
        await updateChannel(guildId, existingChannel.id, {
          name,
          type: existingChannel.type || 'text',
          topic,
          category,
        });
        onSaved(existingChannel.id);
      } else {
        const chId = await createChannel(guildId, userId, {
          name,
          type: channelType,
          topic,
          category,
          position: nextPosition,
        });
        onSaved(chId);
      }
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!existingChannel) return;
    setSubmitting(true);
    try {
      await deleteChannel(guildId, existingChannel.id);
      onSaved();
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-[#131622] border border-white/10 rounded-2xl overflow-hidden shadow-2xl">
        <div className="px-6 py-4 border-b border-white/[0.06] flex items-center justify-between">
          <div className="flex items-center gap-2">
            {channelType === 'voice' ? (
              <Volume2 className="w-4 h-4 text-emerald-400" />
            ) : (
              <Hash className="w-4 h-4 text-violet-400" />
            )}
            <h2 className="text-base font-bold font-display text-white">
              {existingChannel ? 'Edit Channel' : 'Create Channel'}
            </h2>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Channel Type Selector */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-300">Channel Type</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={Boolean(existingChannel)}
                onClick={() => handleSelectType('text')}
                className={`flex items-center gap-2.5 p-3 rounded-xl border text-left transition-colors ${
                  channelType === 'text'
                    ? 'bg-violet-600/20 border-violet-500/60 text-white'
                    : 'bg-[#0B0D14] border-white/[0.08] text-slate-400 hover:text-white'
                } disabled:opacity-70`}
              >
                <Hash className="w-4 h-4 text-violet-400 shrink-0" />
                <div>
                  <div className="text-xs font-semibold">Text</div>
                  <div className="text-[10px] text-slate-400">Messages &amp; files</div>
                </div>
              </button>

              <button
                type="button"
                disabled={Boolean(existingChannel)}
                onClick={() => handleSelectType('voice')}
                className={`flex items-center gap-2.5 p-3 rounded-xl border text-left transition-colors ${
                  channelType === 'voice'
                    ? 'bg-emerald-600/20 border-emerald-500/60 text-white'
                    : 'bg-[#0B0D14] border-white/[0.08] text-slate-400 hover:text-white'
                } disabled:opacity-70`}
              >
                <Volume2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <div>
                  <div className="text-xs font-semibold">Voice</div>
                  <div className="text-[10px] text-slate-400">Live room &amp; chat</div>
                </div>
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-300">Channel Name</label>
            <input
              type="text"
              required
              maxLength={48}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={channelType === 'voice' ? 'team-standup' : 'engineering-updates'}
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#0B0D14] border border-white/10 text-sm text-white focus:outline-none focus:border-violet-500"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-300">Category</label>
            <input
              type="text"
              required
              maxLength={40}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder={channelType === 'voice' ? 'Voice Channels' : 'Text Channels'}
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#0B0D14] border border-white/10 text-sm text-white focus:outline-none focus:border-violet-500"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-300">Topic</label>
            <input
              type="text"
              maxLength={200}
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder={
                channelType === 'voice'
                  ? 'Drop in for voice chat or study sessions'
                  : 'What should members discuss here?'
              }
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#0B0D14] border border-white/10 text-sm text-white focus:outline-none focus:border-violet-500"
            />
          </div>

          <div className="flex items-center justify-between gap-3 pt-2">
            {existingChannel && canDelete ? (
              <button
                type="button"
                onClick={handleDelete}
                disabled={submitting}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 text-xs font-semibold"
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete
              </button>
            ) : (
              <span />
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl bg-white/5 text-slate-300 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 text-white text-xs font-semibold"
              >
                {existingChannel ? 'Save Changes' : 'Create Channel'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export const GuildSettingsModal: React.FC<{
  guild: Guild;
  roles: GuildRole[];
  myMembership: GuildMember | undefined;
  userId: string;
  onClose: () => void;
  onDeleted: () => void;
}> = ({ guild, roles, myMembership, userId, onClose, onDeleted }) => {
  const [tab, setTab] = useState<'overview' | 'roles'>('overview');
  const [name, setName] = useState(guild.name);
  const [description, setDescription] = useState(guild.description);
  const [iconUrl, setIconUrl] = useState(guild.iconUrl);
  const [accentColor, setAccentColor] = useState(guild.accentColor);
  const [isPublic, setIsPublic] = useState(guild.isPublic);
  const [roleName, setRoleName] = useState('');
  const [roleColor, setRoleColor] = useState<string>(ACCENT_SWATCHES[0]);
  const [rolePerms, setRolePerms] = useState<PermissionKey[]>(['MANAGE_MESSAGES']);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isOwner = myMembership?.role === 'owner' || guild.ownerId === userId;

  const handleSaveOverview = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await updateGuildSettings(guild, { name, description, iconUrl, accentColor, isPublic });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update server.');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roleName.trim()) return;
    setSaving(true);
    try {
      await createGuildRole(guild.id, {
        name: roleName,
        color: roleColor,
        permissions: rolePerms,
        position: roles.length + 1,
      });
      setRoleName('');
    } finally {
      setSaving(false);
    }
  };

  const togglePerm = (perm: PermissionKey) => {
    setRolePerms((prev) =>
      prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm]
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-xl bg-[#131622] border border-white/10 rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
        <div className="px-6 py-4 border-b border-white/[0.06] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Shield className="w-5 h-5 text-violet-400" />
            <h2 className="text-lg font-bold font-display text-white">Server Settings &amp; Roles</h2>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 pt-4">
          <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-[#0B0D14] border border-white/[0.06]">
            <button
              type="button"
              onClick={() => setTab('overview')}
              className={`py-2 text-xs font-semibold rounded-lg transition-colors ${
                tab === 'overview' ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Overview
            </button>
            <button
              type="button"
              onClick={() => setTab('roles')}
              className={`py-2 text-xs font-semibold rounded-lg transition-colors ${
                tab === 'roles' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Custom Roles ({roles.length})
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto gs-scroll p-6 space-y-5">
          {error && (
            <div className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/25 rounded-xl px-3.5 py-2.5">
              {error}
            </div>
          )}

          {tab === 'overview' ? (
            <form onSubmit={handleSaveOverview} className="space-y-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-300">Server Name</label>
                <input
                  type="text"
                  required
                  minLength={2}
                  maxLength={60}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#0B0D14] border border-white/10 text-sm text-white focus:outline-none focus:border-violet-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-300">Description</label>
                <textarea
                  rows={2}
                  maxLength={300}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl bg-[#0B0D14] border border-white/10 text-sm text-white resize-none focus:outline-none focus:border-violet-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-300">Icon URL (optional)</label>
                <input
                  type="url"
                  maxLength={500}
                  value={iconUrl}
                  onChange={(e) => setIconUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full px-3.5 py-2 rounded-xl bg-[#0B0D14] border border-white/10 text-sm text-white focus:outline-none focus:border-violet-500"
                />
              </div>

              <div className="flex items-center gap-2">
                {ACCENT_SWATCHES.map((swatch) => (
                  <button
                    key={swatch}
                    type="button"
                    onClick={() => setAccentColor(swatch)}
                    style={{ backgroundColor: swatch }}
                    className={`w-6 h-6 rounded-full ${
                      accentColor === swatch ? 'ring-2 ring-white scale-110' : 'opacity-70'
                    }`}
                  />
                ))}
              </div>

              <label className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl bg-[#0B0D14] border border-white/[0.08] cursor-pointer">
                <div>
                  <div className="text-xs font-semibold text-white">Public Server</div>
                  <div className="text-[11px] text-slate-400">Visible in Explore Clerk Servers</div>
                </div>
                <input
                  type="checkbox"
                  checked={isPublic}
                  onChange={(e) => setIsPublic(e.target.checked)}
                  className="w-4 h-4 accent-violet-600"
                />
              </label>

              <div className="flex items-center justify-between pt-2">
                {isOwner ? (
                  <button
                    type="button"
                    onClick={async () => {
                      await deleteGuild(userId, guild);
                      onDeleted();
                      onClose();
                    }}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 text-xs font-semibold"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Delete Server
                  </button>
                ) : (
                  <span />
                )}
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 text-white text-xs font-semibold"
                >
                  {saving ? 'Saving...' : 'Save Settings'}
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-5">
              <form onSubmit={handleCreateRole} className="p-4 rounded-xl bg-[#0B0D14] border border-white/[0.08] space-y-3">
                <div className="text-xs font-semibold text-white">Create Custom Role Tag</div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    required
                    maxLength={32}
                    value={roleName}
                    onChange={(e) => setRoleName(e.target.value)}
                    placeholder="Core Maintainer"
                    className="flex-1 px-3 py-2 rounded-lg bg-[#131622] border border-white/10 text-xs text-white focus:outline-none focus:border-violet-500"
                  />
                  <button
                    type="submit"
                    disabled={saving}
                    className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold whitespace-nowrap"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add Role
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  {ACCENT_SWATCHES.map((swatch) => (
                    <button
                      key={swatch}
                      type="button"
                      onClick={() => setRoleColor(swatch)}
                      style={{ backgroundColor: swatch }}
                      className={`w-5 h-5 rounded-full ${
                        roleColor === swatch ? 'ring-2 ring-white scale-110' : 'opacity-70'
                      }`}
                    />
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-2 pt-1">
                  {ALL_PERMISSIONS.map((perm) => (
                    <label key={perm.key} className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={rolePerms.includes(perm.key)}
                        onChange={() => togglePerm(perm.key)}
                        className="accent-violet-600"
                      />
                      <span>{perm.label}</span>
                    </label>
                  ))}
                </div>
              </form>

              <div className="space-y-2">
                {roles.length === 0 ? (
                  <p className="text-xs text-slate-500 text-center py-4">
                    No custom roles yet. Create one above and assign it from the Members sidebar.
                  </p>
                ) : (
                  roles.map((role) => (
                    <div
                      key={role.id}
                      className="px-3.5 py-2.5 rounded-xl bg-[#0B0D14] border border-white/[0.06] flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: role.color }} />
                          <span className="text-sm font-semibold text-white truncate">{role.name}</span>
                        </div>
                        <div className="text-[11px] text-slate-400 truncate mt-0.5">
                          {role.permissions.join(' · ') || 'Cosmetic role'}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void deleteGuildRole(guild.id, role.id)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/15"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
