import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PlaySquare, HardDrive, Plus, LogIn } from 'lucide-react';
import { api } from '../../services/api';
import { HealthInfo } from '../../types';
import { Button } from './Button';

interface NavbarProps {
  onCreateRoom?: () => void;
  onJoinRoom?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ onCreateRoom, onJoinRoom }) => {
  const [health, setHealth] = useState<HealthInfo | null>(null);

  useEffect(() => {
    api.getHealth()
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  return (
    <header className="sticky top-0 z-40 w-full glass-panel border-b border-void-600/60">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-3 group">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-violet-600 to-pink-600 flex items-center justify-center shadow-lg shadow-violet-900/30 group-hover:shadow-glow-violet transition-all duration-300">
            <PlaySquare className="w-5 h-5 text-white fill-white/20" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-lg tracking-tight text-white">Anime<span className="text-violet-accent">Sync</span></span>
              <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-violet-950 text-violet-400 border border-violet-800/60">
                同期
              </span>
            </div>
            <p className="text-[10px] text-ink-dim hidden sm:block font-mono">P2P Watch Party</p>
          </div>
        </Link>

        {/* Server & Storage Indicators */}
        <div className="flex items-center gap-3">
          {health && (
            <div className="hidden md:flex items-center gap-4 text-xs font-mono text-ink-muted bg-void-900/80 px-3 py-1.5 rounded-lg border border-void-700">
              <div className="flex items-center gap-1.5" title="Server Status">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>Host Ready</span>
              </div>
              <span className="text-void-600">|</span>
              <div className="flex items-center gap-1.5" title="Free Host Disk Space">
                <HardDrive className="w-3.5 h-3.5 text-violet-400" />
                <span>{health.storage.free_gb} GB Free</span>
              </div>
            </div>
          )}

          {/* Quick Action Buttons */}
          <div className="flex items-center gap-2">
            {onJoinRoom && (
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<LogIn className="w-3.5 h-3.5" />}
                onClick={onJoinRoom}
              >
                Join Room
              </Button>
            )}
            {onCreateRoom && (
              <Button
                variant="primary"
                size="sm"
                leftIcon={<Plus className="w-3.5 h-3.5" />}
                onClick={onCreateRoom}
              >
                New Room
              </Button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
