import React, { useEffect, useState } from 'react';
import { sendPasswordResetEmail, User } from 'firebase/auth';
import {
  Check,
  CheckCircle2,
  Copy,
  Hash,
  KeyRound,
  Laptop,
  Link2,
  LogOut,
  MessageSquare,
  Search,
  Shield,
  ShieldCheck,
  Unlink,
  Upload,
  Users,
  Volume2,
  X,
} from 'lucide-react';
import { appCheckActive, auth } from '../lib/firebase';
import { formatRelativeTime } from '../lib/validation';
import {
  checkUsernameAvailability,
  DiscordOAuthPopupError,
  linkDiscordToProfile,
  openDiscordOAuthPopup,
  revokeOtherUserSessions,
  revokeUserSession,
  unlinkDiscordFromProfile,
} from '../services/authService';
import {
  ACCENT_SWATCHES,
  ChannelMessage,
  DiscordOAuthProfile,
  DmMessage,
  Guild,
  GuildChannel,
  PresenceStatus,
  STATUS_META,
  UserPrivateAccount,
  UserProfile,
  UserSession,
} from '../types/guildspace';
import {
  searchPublicGuilds,
  searchPublicUsers,
  toggleTwoFactorSetting,
  updatePrivateNotificationsSetting,
  updateUserProfile,
  uploadMediaFile,
} from '../services/guildspaceApi';
import { Avatar } from './Avatar';

export const UserSettingsModal: React.FC<{
  authUser: User;
  profile: UserProfile;
  privateAccount: UserPrivateAccount | null;
  sessions: UserSession[];
  currentSessionId: string | null;
  joinedGuildIds: string[];
  onClose: () => void;
}> = ({
  authUser,
  profile,
  privateAccount,
  sessions,
  currentSessionId,
  joinedGuildIds,
  onClose,
}) => {
  const [tab, setTab] = useState<'profile' | 'security'>('profile');
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [username, setUsername] = useState(profile.username);
  const [usernameFeedback, setUsernameFeedback] = useState<{
    available: boolean | null;
    message: string;
  }>({ available: null, message: '' });
  const [bio, setBio] = useState(profile.bio);
  const [customStatus, setCustomStatus] = useState(profile.customStatus);
  const [status, setStatus] = useState<PresenceStatus>(profile.status);
  const [avatarUrl, setAvatarUrl] = useState(profile.avatarUrl);
  const [accentColor, setAccentColor] = useState(profile.accentColor);
  const [notificationsEnabled, setNotificationsEnabled] = useState(
    privateAccount?.notificationsEnabled ?? true
  );
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(
    privateAccount?.twoFactorEnabled ?? profile.twoFactorEnabled ?? false
  );
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [copiedUid, setCopiedUid] = useState(false);
  const [discordBusy, setDiscordBusy] = useState(false);
  const [pendingDiscordLink, setPendingDiscordLink] = useState<DiscordOAuthProfile | null>(null);
  const [importDiscordUsername, setImportDiscordUsername] = useState(false);
  const [importDiscordAvatar, setImportDiscordAvatar] = useState(true);
  const [discordRedirectHint, setDiscordRedirectHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const clean = username.trim().toLowerCase();
    if (!clean || clean === profile.username) {
      setUsernameFeedback({ available: null, message: '' });
      return;
    }
    let active = true;
    const timer = setTimeout(async () => {
      const res = await checkUsernameAvailability(clean);
      if (active) {
        setUsernameFeedback({
          available: res.available,
          message: res.available ? `@${res.normalized} is available` : res.error || 'Unavailable',
        });
      }
    }, 280);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [username, profile.username]);

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const uploaded = await uploadMediaFile(file, `avatars/${profile.uid}`);
      setAvatarUrl(uploaded.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Avatar upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (username.trim().toLowerCase() !== profile.username && usernameFeedback.available === false) {
      setError(usernameFeedback.message || 'Choose an available username.');
      return;
    }

    setSaving(true);
    try {
      await updateUserProfile(
        profile.uid,
        {
          displayName,
          username,
          previousUsername: profile.username,
          bio,
          avatarUrl,
          accentColor,
          customStatus,
          status,
        },
        joinedGuildIds,
        authUser
      );
      if (privateAccount && notificationsEnabled !== privateAccount.notificationsEnabled) {
        await updatePrivateNotificationsSetting(profile.uid, notificationsEnabled);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save profile.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle2FA = async () => {
    setError(null);
    const next = !twoFactorEnabled;
    setTwoFactorEnabled(next);
    try {
      await toggleTwoFactorSetting(profile.uid, next);
    } catch (err) {
      setTwoFactorEnabled(!next);
      setError(err instanceof Error ? err.message : 'Failed to update 2FA setting.');
    }
  };

  const handleSendPasswordReset = async () => {
    const email = privateAccount?.email || authUser.email;
    if (!email) return;
    setError(null);
    try {
      await sendPasswordResetEmail(auth, email);
      setResetSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send password reset email.');
    }
  };

  const handleStartDiscordLink = async () => {
    setError(null);
    setDiscordRedirectHint(null);
    setDiscordBusy(true);
    try {
      const res = await openDiscordOAuthPopup('link');
      setPendingDiscordLink(res.discordProfile);
      setImportDiscordUsername(false);
      setImportDiscordAvatar(true);
    } catch (err) {
      if (err instanceof DiscordOAuthPopupError && err.needsConfig) {
        setDiscordRedirectHint(err.redirectUri || null);
      }
      setError(err instanceof Error ? err.message : 'Could not connect Discord.');
    } finally {
      setDiscordBusy(false);
    }
  };

  const handleConfirmDiscordLink = async () => {
    if (!pendingDiscordLink) return;
    setError(null);
    setDiscordBusy(true);
    try {
      await linkDiscordToProfile({
        uid: profile.uid,
        authUser,
        discordProfile: pendingDiscordLink,
        importUsername: importDiscordUsername,
        importAvatar: importDiscordAvatar,
        currentUsername: profile.username,
        currentDisplayName: profile.displayName,
        currentAvatarUrl: profile.avatarUrl,
        joinedGuildIds,
      });
      if (importDiscordAvatar && pendingDiscordLink.avatarUrl) {
        setAvatarUrl(pendingDiscordLink.avatarUrl);
      }
      if (importDiscordUsername) {
        setDisplayName(pendingDiscordLink.globalName || pendingDiscordLink.username);
      }
      setPendingDiscordLink(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save Discord link.');
    } finally {
      setDiscordBusy(false);
    }
  };

  const handleUnlinkDiscord = async () => {
    setError(null);
    setDiscordBusy(true);
    try {
      await unlinkDiscordFromProfile(profile.uid);
      setPendingDiscordLink(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not unlink Discord.');
    } finally {
      setDiscordBusy(false);
    }
  };

  const activeSessions = sessions.filter((s) => !s.revoked);
  const linkedDiscord = profile.linkedDiscord?.id ? profile.linkedDiscord : null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-xl bg-[#131622] border border-white/10 rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[88vh]">
        <div className="px-6 py-4 border-b border-white/[0.06] flex items-center justify-between">
          <h2 className="text-lg font-bold font-display text-white">Clerk Profile &amp; Security</h2>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 pt-4">
          <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-[#0B0D14] border border-white/[0.06]">
            <button
              type="button"
              onClick={() => setTab('profile')}
              className={`py-2 text-xs font-semibold rounded-lg transition-colors ${
                tab === 'profile' ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Profile &amp; Connections
            </button>
            <button
              type="button"
              onClick={() => setTab('security')}
              className={`py-2 text-xs font-semibold rounded-lg transition-colors ${
                tab === 'security' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Security &amp; Sessions ({activeSessions.length})
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto gs-scroll p-6">
          {error && (
            <div className="mb-4 text-xs text-rose-300 bg-rose-500/10 border border-rose-500/25 rounded-xl px-3.5 py-2.5 space-y-1">
              <div>{error}</div>
              {discordRedirectHint && (
                <div className="font-mono text-[11px] text-indigo-300 break-all">
                  Redirect URI: {discordRedirectHint}
                </div>
              )}
            </div>
          )}

          {tab === 'profile' ? (
            <form onSubmit={handleSave} className="space-y-5">
              <div className="flex items-center gap-4">
                <Avatar
                  name={displayName || profile.displayName}
                  src={avatarUrl}
                  accentColor={accentColor}
                  status={status}
                  showStatus
                  size="xl"
                />
                <div className="space-y-2 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white/[0.07] hover:bg-white/[0.12] text-xs font-semibold text-white cursor-pointer transition-colors">
                      <Upload className="w-3.5 h-3.5" />
                      <span>{uploading ? 'Uploading...' : 'Upload Avatar'}</span>
                      <input type="file" accept="image/*" onChange={handleAvatarUpload} className="hidden" />
                    </label>
                    <span className="inline-flex items-center gap-1 text-xs text-emerald-400 font-medium">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      {profile.isVerified ? 'Verified Account' : 'Pending Verification'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {ACCENT_SWATCHES.map((swatch) => (
                      <button
                        key={swatch}
                        type="button"
                        onClick={() => setAccentColor(swatch)}
                        style={{ backgroundColor: swatch }}
                        className={`w-5 h-5 rounded-full ${
                          accentColor === swatch ? 'ring-2 ring-white scale-110' : 'opacity-70'
                        }`}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-300">Display Name</label>
                  <input
                    type="text"
                    required
                    maxLength={40}
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#0B0D14] border border-white/10 text-sm text-white focus:outline-none focus:border-violet-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <label className="block text-xs font-medium text-slate-300">Username</label>
                    {usernameFeedback.message && (
                      <span
                        className={`text-[11px] ${
                          usernameFeedback.available ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {usernameFeedback.message}
                      </span>
                    )}
                  </div>
                  <input
                    type="text"
                    required
                    minLength={3}
                    maxLength={32}
                    value={username}
                    onChange={(e) => setUsername(e.target.value.toLowerCase())}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#0B0D14] border border-white/10 text-sm font-mono text-white focus:outline-none focus:border-violet-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-300">Presence Status</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as PresenceStatus)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#0B0D14] border border-white/10 text-sm text-white focus:outline-none focus:border-violet-500"
                  >
                    {(['online', 'idle', 'dnd', 'offline'] as PresenceStatus[]).map((st) => (
                      <option key={st} value={st}>
                        {STATUS_META[st].label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-300">Custom Status Note</label>
                  <input
                    type="text"
                    maxLength={80}
                    value={customStatus}
                    onChange={(e) => setCustomStatus(e.target.value)}
                    placeholder="Shipping v2..."
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#0B0D14] border border-white/10 text-sm text-white focus:outline-none focus:border-violet-500"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-300">Biography</label>
                <textarea
                  rows={2}
                  maxLength={240}
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="Tell your Clerk communities about yourself..."
                  className="w-full px-3.5 py-2 rounded-xl bg-[#0B0D14] border border-white/10 text-sm text-white resize-none focus:outline-none focus:border-violet-500"
                />
              </div>

              {/* Unique Clerk User ID, Account Creation Date & Private Info */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs p-3.5 rounded-xl bg-[#0B0D14] border border-white/[0.06]">
                <div>
                  <div className="text-slate-500">Clerk User ID</div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <code className="text-slate-200 font-mono text-[11px] truncate">{profile.uid}</code>
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard.writeText(profile.uid);
                        setCopiedUid(true);
                        setTimeout(() => setCopiedUid(false), 1600);
                      }}
                      className="text-violet-400 hover:text-violet-300 shrink-0"
                      title="Copy Clerk User ID"
                    >
                      {copiedUid ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">Account Created · Private Email</div>
                  <div className="text-slate-200 font-mono text-[11px] truncate mt-0.5">
                    {profile.createdAt ? profile.createdAt.toDate().toLocaleDateString() : 'Today'} ·{' '}
                    {privateAccount?.email || authUser.email}
                  </div>
                </div>
              </div>

              {/* Discord Identity Connection Card */}
              <div className="p-4 rounded-xl bg-[#0B0D14] border border-white/[0.08] space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-[#5865F2]/20 border border-[#5865F2]/40 flex items-center justify-center text-[#8B97FF] shrink-0">
                      <Link2 className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-white">Linked Discord Account</div>
                      <div className="text-[11px] text-slate-400 truncate">
                        {linkedDiscord
                          ? `Connected as @${linkedDiscord.username}`
                          : 'Optional OAuth2 connection (never shares passwords)'}
                      </div>
                    </div>
                  </div>

                  {linkedDiscord ? (
                    <button
                      type="button"
                      disabled={discordBusy}
                      onClick={() => void handleUnlinkDiscord()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 text-xs font-semibold transition-colors shrink-0"
                    >
                      <Unlink className="w-3.5 h-3.5" />
                      Unlink
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={discordBusy}
                      onClick={() => void handleStartDiscordLink()}
                      className="px-3 py-1.5 rounded-lg bg-[#5865F2] hover:bg-[#4752C4] text-white text-xs font-semibold transition-colors shrink-0"
                    >
                      {discordBusy ? 'Authorizing...' : 'Connect Discord'}
                    </button>
                  )}
                </div>

                {linkedDiscord && !pendingDiscordLink && (
                  <div className="flex items-center gap-3 pt-2 border-t border-white/[0.06]">
                    {linkedDiscord.avatarUrl && (
                      <img
                        src={linkedDiscord.avatarUrl}
                        alt={linkedDiscord.username}
                        referrerPolicy="no-referrer"
                        className="w-9 h-9 rounded-full object-cover border border-white/10 shrink-0"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold text-white truncate">
                        {linkedDiscord.globalName || linkedDiscord.username}
                      </div>
                      <div className="text-[11px] font-mono text-indigo-300 truncate">
                        @{linkedDiscord.username} · ID {linkedDiscord.id}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={discordBusy}
                      onClick={() => void handleStartDiscordLink()}
                      className="text-[11px] font-medium text-indigo-300 hover:text-white whitespace-nowrap"
                    >
                      Re-sync
                    </button>
                  </div>
                )}

                {pendingDiscordLink && (
                  <div className="p-3 rounded-lg bg-[#131622] border border-[#5865F2]/35 space-y-2.5">
                    <div className="flex items-center gap-2.5">
                      <img
                        src={pendingDiscordLink.avatarUrl}
                        alt={pendingDiscordLink.username}
                        referrerPolicy="no-referrer"
                        className="w-9 h-9 rounded-full object-cover"
                      />
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-white truncate">
                          Link @{pendingDiscordLink.username}?
                        </div>
                        <div className="text-[11px] text-slate-400">Select fields to import with consent:</div>
                      </div>
                    </div>
                    <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={importDiscordUsername}
                        onChange={(e) => setImportDiscordUsername(e.target.checked)}
                        className="accent-[#5865F2]"
                      />
                      <span>Import Discord username &amp; display name</span>
                    </label>
                    <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={importDiscordAvatar}
                        onChange={(e) => setImportDiscordAvatar(e.target.checked)}
                        className="accent-[#5865F2]"
                      />
                      <span>Import Discord avatar</span>
                    </label>
                    <div className="flex items-center justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setPendingDiscordLink(null)}
                        className="px-3 py-1.5 rounded-lg bg-white/5 text-slate-300 text-xs"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={discordBusy}
                        onClick={() => void handleConfirmDiscordLink()}
                        className="px-3 py-1.5 rounded-lg bg-[#5865F2] hover:bg-[#4752C4] text-white text-xs font-semibold"
                      >
                        {discordBusy ? 'Linking...' : 'Confirm Link'}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <label className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl bg-[#0B0D14] border border-white/[0.08] cursor-pointer">
                <div>
                  <div className="text-xs font-semibold text-white">Real-time Notifications</div>
                  <div className="text-[11px] text-slate-400">
                    Receive alerts for @mentions, DMs, and friend requests
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={notificationsEnabled}
                  onChange={(e) => setNotificationsEnabled(e.target.checked)}
                  className="w-4 h-4 accent-violet-600"
                />
              </label>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-xl bg-white/5 text-slate-300 text-xs font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || uploading}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 text-white text-xs font-semibold"
                >
                  {saving ? 'Saving...' : 'Save Profile'}
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-5">
              {/* Two-Factor Authentication Card */}
              <div className="p-4 rounded-xl bg-[#0B0D14] border border-white/[0.08] flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm font-semibold text-white">
                    <ShieldCheck className="w-4 h-4 text-violet-400" />
                    <span>Two-Factor Authentication (2FA)</span>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Require a 6-digit email security verification code every time you sign in to Clerk.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleToggle2FA}
                  className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                    twoFactorEnabled
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/35 hover:bg-rose-500/20 hover:text-rose-300 hover:border-rose-500/35'
                      : 'bg-gradient-to-r from-violet-600 to-blue-600 text-white'
                  }`}
                >
                  {twoFactorEnabled ? 'Enabled (Disable)' : 'Enable 2FA'}
                </button>
              </div>

              {/* Password Reset & App Check Row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-4 rounded-xl bg-[#0B0D14] border border-white/[0.08] space-y-2.5">
                  <div className="flex items-center gap-2 text-xs font-semibold text-white">
                    <KeyRound className="w-4 h-4 text-blue-400" />
                    <span>Password Reset</span>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Send a Firebase password reset link to your email.
                  </p>
                  <button
                    type="button"
                    onClick={handleSendPasswordReset}
                    disabled={resetSent}
                    className="w-full py-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-xs font-medium text-white disabled:text-emerald-300"
                  >
                    {resetSent ? 'Reset Email Sent' : 'Send Reset Email'}
                  </button>
                </div>

                <div className="p-4 rounded-xl bg-[#0B0D14] border border-white/[0.08] space-y-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-white">
                    <Shield className="w-4 h-4 text-violet-400" />
                    <span>Firebase App Check</span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    {appCheckActive
                      ? 'Active with reCAPTCHA v3 attestation.'
                      : 'Ready — add recaptchaSiteKey in config or VITE_RECAPTCHA_SITE_KEY to enforce reCAPTCHA v3.'}
                  </p>
                </div>
              </div>

              {/* Active Login Sessions */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-slate-300">
                    Active Login Sessions ({activeSessions.length})
                  </h3>
                  {activeSessions.length > 1 && currentSessionId && (
                    <button
                      type="button"
                      onClick={() =>
                        void revokeOtherUserSessions(profile.uid, currentSessionId, activeSessions)
                      }
                      className="text-xs font-medium text-rose-400 hover:text-rose-300"
                    >
                      Sign out all other devices
                    </button>
                  )}
                </div>

                <div className="divide-y divide-white/[0.06] border border-white/[0.08] rounded-xl bg-[#0B0D14] overflow-hidden">
                  {activeSessions.length === 0 ? (
                    <div className="p-4 text-xs text-slate-500 text-center">No active sessions recorded.</div>
                  ) : (
                    activeSessions.map((ses) => {
                      const isCurrent = ses.id === currentSessionId;
                      return (
                        <div
                          key={ses.id}
                          className="px-4 py-3 flex items-center justify-between gap-3"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <Laptop className="w-4 h-4 text-violet-400 shrink-0" />
                            <div className="min-w-0">
                              <div className="text-xs font-semibold text-white truncate">
                                {ses.deviceLabel}
                                {isCurrent && (
                                  <span className="ml-2 text-emerald-400 font-medium">· Current</span>
                                )}
                              </div>
                              <div className="text-[11px] text-slate-400">
                                Active {formatRelativeTime(ses.lastActiveAt)} ·{' '}
                                {ses.rememberMe ? 'Persistent session' : 'Browser session'}
                              </div>
                            </div>
                          </div>

                          {!isCurrent && (
                            <button
                              type="button"
                              onClick={() => void revokeUserSession(profile.uid, ses.id)}
                              title="Revoke session"
                              aria-label="Revoke session"
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 text-[11px] font-medium shrink-0"
                            >
                              <LogOut className="w-3 h-3" />
                              Revoke
                            </button>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const GlobalSearchModal: React.FC<{
  currentUid: string;
  channels: GuildChannel[];
  activeMessages: (ChannelMessage | DmMessage)[];
  onClose: () => void;
  onSelectChannel: (channelId: string) => void;
  onJumpToMessage: (messageId: string) => void;
  onStartDm: (user: UserProfile) => void;
  onSelectPublicGuild: (guild: Guild) => void;
}> = ({
  currentUid,
  channels,
  activeMessages,
  onClose,
  onSelectChannel,
  onJumpToMessage,
  onStartDm,
  onSelectPublicGuild,
}) => {
  const [queryText, setQueryText] = useState('');
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [guilds, setGuilds] = useState<Guild[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      try {
        const [uRes, gRes] = await Promise.all([
          searchPublicUsers(queryText),
          searchPublicGuilds(queryText),
        ]);
        if (active) {
          setUsers(uRes.filter((u) => u.uid !== currentUid).slice(0, 6));
          setGuilds(gRes.slice(0, 5));
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    const timer = setTimeout(load, 160);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [queryText, currentUid]);

  const term = queryText.trim().toLowerCase();
  const matchedChannels = channels
    .filter((c) => !term || c.name.toLowerCase().includes(term) || c.topic.toLowerCase().includes(term))
    .slice(0, 6);

  const matchedMessages = term
    ? activeMessages
        .filter(
          (m) =>
            m.content.toLowerCase().includes(term) ||
            m.authorName.toLowerCase().includes(term)
        )
        .slice(-8)
        .reverse()
    : [];

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-start justify-center pt-16 p-4">
      <div className="w-full max-w-xl bg-[#131622] border border-white/10 rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[75vh]">
        <div className="px-4 py-3 border-b border-white/[0.08] flex items-center gap-3">
          <Search className="w-4 h-4 text-violet-400 shrink-0" />
          <input
            type="text"
            autoFocus
            value={queryText}
            onChange={(e) => setQueryText(e.target.value)}
            placeholder="Search messages, channels, members, or servers..."
            className="flex-1 bg-transparent text-sm text-white placeholder:text-slate-500 focus:outline-none"
          />
          <button type="button" onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto gs-scroll p-4 space-y-5">
          {matchedMessages.length > 0 && (
            <div className="space-y-1.5">
              <div className="px-2 text-xs font-semibold text-slate-400">Messages in current view</div>
              {matchedMessages.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    onJumpToMessage(m.id);
                    onClose();
                  }}
                  className="w-full text-left px-3 py-2 rounded-xl hover:bg-white/[0.05] transition-colors space-y-0.5"
                >
                  <div className="text-xs font-semibold text-violet-300">{m.authorName}</div>
                  <div className="text-xs text-slate-300 truncate">{m.content}</div>
                </button>
              ))}
            </div>
          )}

          {matchedChannels.length > 0 && (
            <div className="space-y-1.5">
              <div className="px-2 text-xs font-semibold text-slate-400">Channels</div>
              {matchedChannels.map((ch) => (
                <button
                  key={ch.id}
                  type="button"
                  onClick={() => {
                    onSelectChannel(ch.id);
                    onClose();
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-white/[0.05] text-left transition-colors"
                >
                  {ch.type === 'voice' ? (
                    <Volume2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  ) : (
                    <Hash className="w-4 h-4 text-violet-400 shrink-0" />
                  )}
                  <span className="text-sm font-medium text-white">{ch.name}</span>
                  {ch.topic && <span className="text-xs text-slate-500 truncate">{ch.topic}</span>}
                </button>
              ))}
            </div>
          )}

          <div className="space-y-1.5">
            <div className="px-2 text-xs font-semibold text-slate-400">
              People {loading ? '· Searching...' : ''}
            </div>
            {users.length === 0 ? (
              <p className="px-3 py-2 text-xs text-slate-500">No matching members.</p>
            ) : (
              users.map((u) => (
                <button
                  key={u.uid}
                  type="button"
                  onClick={() => {
                    onStartDm(u);
                    onClose();
                  }}
                  className="w-full flex items-center justify-between gap-3 px-3 py-2 rounded-xl hover:bg-white/[0.05] text-left transition-colors"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Avatar
                      name={u.displayName}
                      src={u.avatarUrl}
                      accentColor={u.accentColor}
                      status={u.status}
                      showStatus
                      size="sm"
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-white truncate">{u.displayName}</div>
                      <div className="text-xs text-slate-400 truncate">@{u.username}</div>
                    </div>
                  </div>
                  <MessageSquare className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                </button>
              ))
            )}
          </div>

          {guilds.length > 0 && (
            <div className="space-y-1.5">
              <div className="px-2 text-xs font-semibold text-slate-400">Public Clerk Servers</div>
              {guilds.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => {
                    onSelectPublicGuild(g);
                    onClose();
                  }}
                  className="w-full flex items-center justify-between gap-3 px-3 py-2 rounded-xl hover:bg-white/[0.05] text-left transition-colors"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Users className="w-4 h-4 text-blue-400 shrink-0" />
                    <span className="text-sm font-medium text-white truncate">{g.name}</span>
                  </div>
                  <span className="text-xs font-mono text-slate-500">{g.memberCount} members</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
