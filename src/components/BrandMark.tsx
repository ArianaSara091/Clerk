import React from 'react';

interface BrandMarkProps {
  size?: number;
  className?: string;
}

export const BrandMark: React.FC<BrandMarkProps> = ({ size = 28, className = '' }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 36 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="gs-prism-grad" x1="4" y1="3" x2="32" y2="33" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#8B5CF6" />
          <stop offset="55%" stopColor="#6366F1" />
          <stop offset="100%" stopColor="#3B82F6" />
        </linearGradient>
      </defs>
      <path
        d="M18 2.5L31.42 10.25V25.75L18 33.5L4.58 25.75V10.25L18 2.5Z"
        fill="url(#gs-prism-grad)"
      />
      <path
        d="M18 8.5L26 13.1V22.9L18 27.5L10 22.9V13.1L18 8.5Z"
        stroke="white"
        strokeOpacity="0.92"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M18 14.2V21.8M14.2 16.4L18 14.2L21.8 16.4"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="18" cy="22.4" r="1.5" fill="white" />
    </svg>
  );
};
