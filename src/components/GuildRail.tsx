import React from 'react';
import { Compass, Plus } from 'lucide-react';
import { UserGuildLink } from '../types/guildspace';
import { BrandMark } from './BrandMark';

interface GuildRailProps {
  guildLinks: UserGuildLink[];
  activeScope: 'home' | 'guild';
  activeGuildId: string | null;
  unreadNotificationsCount: number;
  pendingFriendRequestsCount: number;
  onSelectHome: () => void;
  onSelectGuild: (guildId: string) => void;
  onOpenCreateGuild: () => void;
  onOpenDiscover: () => void;
}

export const GuildRail: React.FC<GuildRailProps> = ({
  guildLinks,
  activeScope,
  activeGuildId,
  unreadNotificationsCount,
  pendingFriendRequestsCount,
  onSelectHome,
  onSelectGuild,
  onOpenCreateGuild,
  onOpenDiscover,
}) => {
  const homeAlertCount = unreadNotificationsCount + pendingFriendRequestsCount;

  return (
    <aside
      aria-label="Communities navigation"
      className="w-[72px] shrink-0 h-full bg-[#090B10] border-r border-white/[0.06] flex flex-col items-center py-3 gap-2 select-none"
    >
      {/* Home / Direct Messages & Friends */}
      <div className="relative group flex items-center justify-center w-full">
        <span
          className={`absolute left-0 w-1 rounded-r-full bg-gradient-to-b from-violet-400 to-blue-500 transition-all duration-150 ${
            activeScope === 'home' ? 'h-8 opacity-100' : 'h-0 group-hover:h-4 opacity-0 group-hover:opacity-100'
          }`}
        />
        <button
          type="button"
          onClick={onSelectHome}
          title="Home · Direct Messages & Friends"
          aria-label="Home · Direct Messages & Friends"
          className={`relative w-12 h-12 flex items-center justify-center transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
            activeScope === 'home'
              ? 'rounded-2xl bg-gradient-to-br from-violet-600/30 to-blue-600/30 border border-violet-500/50'
              : 'rounded-[22px] hover:rounded-2xl bg-[#151823] hover:bg-violet-600/20 border border-white/[0.06]'
          }`}
        >
          <BrandMark size={26} />
          {homeAlertCount > 0 && (
            <span className="absolute -bottom-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-[10px] font-mono font-semibold text-white flex items-center justify-center ring-2 ring-[#090B10]">
              {homeAlertCount > 9 ? '9+' : homeAlertCount}
            </span>
          )}
        </button>
      </div>

      <div className="w-8 h-px bg-white/[0.08] my-1" />

      {/* Joined Communities */}
      <div className="flex-1 w-full overflow-y-auto gs-scroll-none flex flex-col items-center gap-2 py-1">
        {guildLinks.map((g) => {
          const isActive = activeScope === 'guild' && activeGuildId === g.guildId;
          const initials = g.guildName
            .split(/\s+/)
            .slice(0, 2)
            .map((w) => w[0]?.toUpperCase() || '')
            .join('') || 'G';

          return (
            <div key={g.guildId} className="relative group flex items-center justify-center w-full">
              <span
                className={`absolute left-0 w-1 rounded-r-full bg-gradient-to-b from-violet-400 to-blue-400 transition-all duration-150 ${
                  isActive ? 'h-9 opacity-100' : 'h-0 group-hover:h-5 opacity-0 group-hover:opacity-100'
                }`}
              />
              <button
                type="button"
                onClick={() => onSelectGuild(g.guildId)}
                title={g.guildName}
                aria-label={g.guildName}
                style={!g.guildIcon ? { backgroundColor: isActive ? g.guildAccent : '#161925' } : undefined}
                className={`w-12 h-12 overflow-hidden flex items-center justify-center font-display font-bold text-sm transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
                  isActive
                    ? 'rounded-2xl text-white ring-2 ring-violet-400/70'
                    : 'rounded-[24px] hover:rounded-2xl text-slate-200 hover:text-white border border-white/[0.06]'
                }`}
              >
                {g.guildIcon ? (
                  <img
                    src={g.guildIcon}
                    alt={g.guildName}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span>{initials}</span>
                )}
              </button>
            </div>
          );
        })}

        {/* Create / Join via Invite */}
        <button
          type="button"
          onClick={onOpenCreateGuild}
          title="Create or Join Server"
          aria-label="Create or Join Server"
          className="w-12 h-12 rounded-[24px] hover:rounded-2xl bg-[#151823] hover:bg-violet-600 text-violet-400 hover:text-white border border-white/[0.07] flex items-center justify-center transition-all duration-150 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
        >
          <Plus className="w-5 h-5" />
        </button>

        {/* Discover Public Servers */}
        <button
          type="button"
          onClick={onOpenDiscover}
          title="Explore Public Servers"
          aria-label="Explore Public Servers"
          className="w-12 h-12 rounded-[24px] hover:rounded-2xl bg-[#151823] hover:bg-blue-600 text-blue-400 hover:text-white border border-white/[0.07] flex items-center justify-center transition-all duration-150 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          <Compass className="w-5 h-5" />
        </button>
      </div>
    </aside>
  );
};
