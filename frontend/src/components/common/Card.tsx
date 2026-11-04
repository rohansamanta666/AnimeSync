import React from 'react';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'elevated' | 'interactive' | 'outline';
  glow?: 'none' | 'violet' | 'pink' | 'cyan';
}

export const Card: React.FC<CardProps> = ({
  children,
  variant = 'default',
  glow = 'none',
  className = '',
  ...props
}) => {
  const variantStyles = {
    default: 'glass-panel rounded-2xl p-6',
    elevated: 'glass-panel-elevated rounded-2xl p-6 shadow-2xl',
    interactive: 'glass-panel rounded-2xl p-6 hover:border-violet-accent/60 hover:shadow-glow-violet transition-all duration-300 cursor-pointer',
    outline: 'rounded-2xl border border-void-600 bg-void-900/40 p-6',
  };

  const glowStyles = {
    none: '',
    violet: 'shadow-glow-violet border-violet-500/30',
    pink: 'shadow-glow-pink border-pink-500/30',
    cyan: 'shadow-glow-cyan border-cyan-500/30',
  };

  return (
    <div className={`${variantStyles[variant]} ${glowStyles[glow]} ${className}`} {...props}>
      {children}
    </div>
  );
};
