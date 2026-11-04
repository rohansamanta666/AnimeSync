import React from 'react';
import { ParticipantStatus } from '../../types';

export interface BadgeProps {
  status?: ParticipantStatus | string;
  variant?: 'violet' | 'pink' | 'cyan' | 'green' | 'amber' | 'rose' | 'neutral';
  size?: 'sm' | 'md';
  pulse?: boolean;
  children?: React.ReactNode;
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({
  status,
  variant,
  size = 'md',
  pulse = false,
  children,
  className = '',
}) => {
  // Determine variant based on ParticipantStatus if not explicitly provided
  let resolvedVariant = variant || 'neutral';
  let label = children;

  if (status) {
    switch (status) {
      case 'READY':
        resolvedVariant = 'green';
        label = label || 'Ready';
        break;
      case 'VERIFIED':
        resolvedVariant = 'cyan';
        label = label || 'Verified';
        break;
      case 'WATCHING':
        resolvedVariant = 'violet';
        label = label || 'Watching';
        break;
      case 'VERIFYING':
        resolvedVariant = 'amber';
        label = label || 'Verifying...';
        pulse = true;
        break;
      case 'DOWNLOADING':
        resolvedVariant = 'cyan';
        label = label || 'Downloading...';
        pulse = true;
        break;
      case 'DOWNLOADED':
        resolvedVariant = 'neutral';
        label = label || 'Downloaded';
        break;
      case 'WAITING_FOR_FILE':
        resolvedVariant = 'neutral';
        label = label || 'Waiting for File';
        break;
      case 'BUFFERING':
        resolvedVariant = 'amber';
        label = label || 'Buffering';
        pulse = true;
        break;
      case 'VERIFICATION_FAILED':
        resolvedVariant = 'rose';
        label = label || 'Checksum Mismatch';
        break;
      case 'DISCONNECTED':
        resolvedVariant = 'neutral';
        label = label || 'Disconnected';
        break;
      default:
        label = label || status;
    }
  }

  const variantStyles = {
    violet: 'bg-violet-950/80 text-violet-300 border-violet-800/80',
    pink: 'bg-pink-950/80 text-pink-300 border-pink-800/80',
    cyan: 'bg-cyan-950/80 text-cyan-300 border-cyan-800/80',
    green: 'bg-emerald-950/80 text-emerald-300 border-emerald-800/80',
    amber: 'bg-amber-950/80 text-amber-300 border-amber-800/80',
    rose: 'bg-rose-950/80 text-rose-300 border-rose-800/80',
    neutral: 'bg-void-800 text-ink-muted border-void-600',
  };

  const sizeStyles = {
    sm: 'text-[11px] px-2 py-0.5 gap-1',
    md: 'text-xs px-2.5 py-1 gap-1.5',
  };

  return (
    <span
      className={`inline-flex items-center font-medium rounded-full border ${variantStyles[resolvedVariant]} ${sizeStyles[size]} ${className}`}
    >
      {pulse && (
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-current opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-current"></span>
        </span>
      )}
      <span>{label}</span>
    </span>
  );
};
