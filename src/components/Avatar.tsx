import React, { useState } from 'react';
import { PresenceStatus, STATUS_META } from '../types/guildspace';

interface AvatarProps {
  name: string;
  src?: string;
  accentColor?: string;
  status?: PresenceStatus;
  showStatus?: boolean;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const SIZE_MAP = {
  xs: 'w-6 h-6 text-[11px]',
  sm: 'w-8 h-8 text-xs',
  md: 'w-9 h-9 text-sm',
  lg: 'w-11 h-11 text-base',
  xl: 'w-16 h-16 text-xl',
};

const DOT_MAP = {
  xs: 'w-2 h-2 -bottom-0.5 -right-0.5',
  sm: 'w-2.5 h-2.5 -bottom-0.5 -right-0.5',
  md: 'w-3 h-3 -bottom-0.5 -right-0.5',
  lg: 'w-3.5 h-3.5 bottom-0 right-0',
  xl: 'w-4 h-4 bottom-0.5 right-0.5',
};

export const Avatar: React.FC<AvatarProps> = ({
  name,
  src,
  accentColor = '#7C3AED',
  status = 'online',
  showStatus = false,
  size = 'md',
  className = '',
}) => {
  const [imgError, setImgError] = useState(false);
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('') || 'G';

  const statusMeta = STATUS_META[status] || STATUS_META.online;

  return (
    <div className={`relative inline-flex shrink-0 select-none ${className}`}>
      {src && !imgError ? (
        <img
          src={src}
          alt={name}
          referrerPolicy="no-referrer"
          onError={() => setImgError(true)}
          className={`${SIZE_MAP[size]} rounded-full object-cover bg-slate-800`}
        />
      ) : (
        <div
          style={{ backgroundColor: accentColor }}
          className={`${SIZE_MAP[size]} rounded-full flex items-center justify-center font-display font-semibold text-white`}
        >
          {initials}
        </div>
      )}
      {showStatus && (
        <span
          title={statusMeta.label}
          aria-label={statusMeta.label}
          className={`absolute ${DOT_MAP[size]} ${statusMeta.colorClass} rounded-full ring-2 ring-[#11131D]`}
        />
      )}
    </div>
  );
};
