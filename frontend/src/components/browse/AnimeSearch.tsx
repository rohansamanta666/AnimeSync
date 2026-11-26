import React from 'react';
import { Search, X } from 'lucide-react';
import { Button } from '../common/Button';

export interface AnimeSearchProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (query: string) => void;
  onClear?: () => void;
  isLoading?: boolean;
}

export const AnimeSearch: React.FC<AnimeSearchProps> = ({
  value,
  onChange,
  onSubmit,
  onClear,
  isLoading = false,
}) => {
  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(value);
  };

  return (
    <form onSubmit={handleFormSubmit} className="flex items-center gap-2 w-full md:w-[420px]">
      <div className="relative flex-1">
        <Search className="w-4 h-4 text-ink-dim absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Search anime titles on AniList..."
          aria-label="Search anime"
          className="w-full pl-9 pr-8 py-2 rounded-lg bg-void-900 border border-void-700 text-sm text-white placeholder-ink-dim focus:outline-none focus:border-violet-500"
        />
        {value && onClear && (
          <button
            type="button"
            onClick={onClear}
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
    </form>
  );
};
