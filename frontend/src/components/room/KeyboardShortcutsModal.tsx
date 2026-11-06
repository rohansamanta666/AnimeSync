/**
 * KeyboardShortcutsModal — Phase 8 Task 8.4
 *
 * Japanese-styled keyboard shortcuts cheat sheet modal.
 */
import React, { useEffect } from 'react';
import { X, Keyboard } from 'lucide-react';
import { Button } from '../common/Button';

export interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ShortcutItem {
  keys: string[];
  description: string;
  category: 'playback' | 'communication' | 'navigation';
}

const SHORTCUTS: ShortcutItem[] = [
  // Playback
  { keys: ['Space'], description: 'Play / Pause playback', category: 'playback' },
  { keys: ['←', '→'], description: 'Seek backward / forward 5s', category: 'playback' },
  { keys: ['↑', '↓'], description: 'Increase / decrease anime volume 10%', category: 'playback' },
  { keys: ['M'], description: 'Mute / unmute anime soundtrack', category: 'playback' },
  { keys: ['F'], description: 'Toggle Fullscreen mode', category: 'playback' },
  { keys: ['T'], description: 'Toggle Theater Mode (full-width stage)', category: 'playback' },
  { keys: ['S'], description: 'Toggle Subtitles on / off', category: 'playback' },
  { keys: ['Shift', 'R'], description: 'Manual Resync with authoritative server time', category: 'playback' },

  // Communication
  { keys: ['V'], description: 'Push-to-Talk (hold while speaking)', category: 'communication' },
  { keys: ['C'], description: 'Toggle Fullscreen Chat & Voice overlay', category: 'communication' },

  // Navigation
  { keys: ['[' , ']'], description: 'Collapse / expand sidebar', category: 'navigation' },
  { keys: ['?'], description: 'Toggle keyboard shortcuts guide', category: 'navigation' },
  { keys: ['Esc'], description: 'Close modals / exit overlays', category: 'navigation' },
];

export const KeyboardShortcutsModal: React.FC<KeyboardShortcutsModalProps> = ({
  isOpen,
  onClose,
}) => {
  // Listen for Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg glass-panel rounded-2xl border border-void-600/80 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-void-700/60 bg-void-950/60">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-violet-950/80 border border-violet-800 flex items-center justify-center text-violet-400">
              <Keyboard className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <span>Keyboard Shortcuts</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-violet-950 text-violet-300 border border-violet-800">
                  ショートカット
                </span>
              </h3>
              <p className="text-xs text-ink-muted">Quick access controls for your watch party</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-ink-muted hover:text-white hover:bg-void-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Shortcuts list */}
        <div className="p-5 max-h-[60vh] overflow-y-auto space-y-5 scrollbar-thin">
          {/* Section: Playback */}
          <div>
            <h4 className="text-[11px] font-mono uppercase tracking-wider text-violet-400 font-bold mb-2.5">
              Video & Playback
            </h4>
            <div className="space-y-2">
              {SHORTCUTS.filter((s) => s.category === 'playback').map((item, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-2.5 rounded-xl bg-void-900/70 border border-void-800/80"
                >
                  <span className="text-xs text-ink">{item.description}</span>
                  <div className="flex items-center gap-1 shrink-0 ml-2">
                    {item.keys.map((k, kIdx) => (
                      <kbd
                        key={kIdx}
                        className="px-2 py-1 text-[11px] font-mono font-semibold text-white bg-void-800 border border-void-600 rounded-md shadow-sm"
                      >
                        {k}
                      </kbd>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Section: Communication */}
          <div>
            <h4 className="text-[11px] font-mono uppercase tracking-wider text-pink-400 font-bold mb-2.5">
              Communication & Voice
            </h4>
            <div className="space-y-2">
              {SHORTCUTS.filter((s) => s.category === 'communication').map((item, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-2.5 rounded-xl bg-void-900/70 border border-void-800/80"
                >
                  <span className="text-xs text-ink">{item.description}</span>
                  <div className="flex items-center gap-1 shrink-0 ml-2">
                    {item.keys.map((k, kIdx) => (
                      <kbd
                        key={kIdx}
                        className="px-2 py-1 text-[11px] font-mono font-semibold text-white bg-void-800 border border-void-600 rounded-md shadow-sm"
                      >
                        {k}
                      </kbd>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Section: Navigation */}
          <div>
            <h4 className="text-[11px] font-mono uppercase tracking-wider text-cyan-400 font-bold mb-2.5">
              Workspace Navigation
            </h4>
            <div className="space-y-2">
              {SHORTCUTS.filter((s) => s.category === 'navigation').map((item, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-2.5 rounded-xl bg-void-900/70 border border-void-800/80"
                >
                  <span className="text-xs text-ink">{item.description}</span>
                  <div className="flex items-center gap-1 shrink-0 ml-2">
                    {item.keys.map((k, kIdx) => (
                      <kbd
                        key={kIdx}
                        className="px-2 py-1 text-[11px] font-mono font-semibold text-white bg-void-800 border border-void-600 rounded-md shadow-sm"
                      >
                        {k}
                      </kbd>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-void-700/60 bg-void-950/80 flex items-center justify-between">
          <span className="text-[11px] font-mono text-ink-dim">
            Shortcuts are disabled while typing in chat or input fields.
          </span>
          <Button variant="outline" size="sm" onClick={onClose} className="text-xs">
            Done
          </Button>
        </div>
      </div>
    </div>
  );
};

