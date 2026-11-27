import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X, Sparkles } from 'lucide-react';
import { api } from '../../services/api';
import { ProviderSuggestionItem } from '../../types';
import { Button } from '../common/Button';

export interface AnimeSearchProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (query: string) => void;
  onClear?: () => void;
  onRandomClick?: () => void;
  isLoading?: boolean;
  isRandomLoading?: boolean;
}

export const AnimeSearch: React.FC<AnimeSearchProps> = ({
  value,
  onChange,
  onSubmit,
  onClear,
  onRandomClick,
  isLoading = false,
  isRandomLoading = false,
}) => {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [suggestions, setSuggestions] = useState<ProviderSuggestionItem[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);

  useEffect(() => {
    const trimmed = value.trim();
    if (trimmed.length < 2) {
      setSuggestions([]);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .getProviderSuggestions(trimmed)
        .then((res) => {
          if (!cancelled) {
            setSuggestions((res.suggestions || []).slice(0, 7));
          }
        })
        .catch(() => {
          if (!cancelled) setSuggestions([]);
        });
    }, 240);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [value]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setShowDropdown(false);
    onSubmit(value);
  };

  return (
    <div ref={containerRef} className="relative w-full md:w-[480px]">
      <form onSubmit={handleFormSubmit} className="flex items-center gap-2 w-full">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-ink-dim absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={value}
            onFocus={() => setShowDropdown(true)}
            onChange={(e) => {
              onChange(e.target.value);
              setShowDropdown(true);
            }}
            placeholder="Search anime titles to watch & stream..."
            aria-label="Search anime"
            className="w-full pl-9 pr-8 py-2 rounded-lg bg-void-900 border border-void-700 text-sm text-white placeholder-ink-dim focus:outline-none focus:border-violet-500"
          />
          {value && onClear && (
            <button
              type="button"
              onClick={() => {
                setSuggestions([]);
                setShowDropdown(false);
                onClear();
              }}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-dim hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <Button type="submit" variant="primary" size="sm" isLoading={isLoading}>
          Search
        </Button>

        {onRandomClick && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onRandomClick}
            isLoading={isRandomLoading}
            leftIcon={<Sparkles className="w-3.5 h-3.5 text-pink-400" />}
            title="Open a random anime"
          >
            Random
          </Button>
        )}
      </form>

      {showDropdown && suggestions.length > 0 && (
        <div className="absolute left-0 right-0 mt-1.5 z-50 rounded-xl bg-void-900 border border-void-700 shadow-2xl overflow-hidden divide-y divide-void-800">
          {suggestions.map((item, idx) => (
            <button
              key={`${item.id || idx}`}
              type="button"
              onClick={() => {
                setShowDropdown(false);
                if (item.id) {
                  navigate(`/browse/${encodeURIComponent(item.id)}`);
                } else if (item.title) {
                  onChange(item.title);
                  onSubmit(item.title);
                }
              }}
              className="w-full flex items-center gap-3 p-2.5 text-left hover:bg-void-800/80 transition-colors"
            >
              {item.poster && (
                <img
                  src={item.poster}
                  alt={item.title || 'Anime'}
                  className="w-9 h-12 rounded object-cover shrink-0 border border-void-700"
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-white truncate">
                  {item.title || item.alternativeTitle}
                </p>
                {item.alternativeTitle && item.alternativeTitle !== item.title && (
                  <p className="text-[11px] text-ink-dim truncate">{item.alternativeTitle}</p>
                )}
                <p className="text-[10px] font-mono text-ink-muted mt-0.5">
                  {[item.aired, item.type, item.duration].filter(Boolean).join(' • ')}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
