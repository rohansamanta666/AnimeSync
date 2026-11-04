import React, { forwardRef } from 'react';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(({
  label,
  error,
  helperText,
  leftIcon,
  rightIcon,
  className = '',
  disabled,
  id,
  ...props
}, ref) => {
  const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

  return (
    <div className="w-full space-y-1.5">
      {label && (
        <label htmlFor={inputId} className="block text-xs font-medium text-ink-muted tracking-wide uppercase">
          {label}
        </label>
      )}
      <div className="relative flex items-center">
        {leftIcon && (
          <div className="absolute left-3.5 text-ink-dim pointer-events-none flex items-center">
            {leftIcon}
          </div>
        )}
        <input
          ref={ref}
          id={inputId}
          disabled={disabled}
          className={`w-full rounded-xl bg-void-800/90 border transition-all duration-150 text-ink-text placeholder-ink-dim/60 text-sm focus:outline-none focus:ring-2 focus:ring-violet-accent/50 focus:border-violet-accent disabled:opacity-50 disabled:bg-void-900 ${
            leftIcon ? 'pl-10' : 'pl-3.5'
          } ${rightIcon ? 'pr-10' : 'pr-3.5'} py-2.5 ${
            error ? 'border-rose-500/80 focus:border-rose-500 focus:ring-rose-500/30' : 'border-void-600 hover:border-void-500'
          } ${className}`}
          {...props}
        />
        {rightIcon && (
          <div className="absolute right-3.5 text-ink-dim flex items-center">
            {rightIcon}
          </div>
        )}
      </div>
      {error ? (
        <p className="text-xs text-rose-400 font-medium pl-1">{error}</p>
      ) : helperText ? (
        <p className="text-xs text-ink-dim pl-1">{helperText}</p>
      ) : null}
    </div>
  );
});

Input.displayName = 'Input';
