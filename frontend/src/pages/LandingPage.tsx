import React, { useState } from 'react';
import {
  Play,
  Users,
  ShieldCheck,
  Sliders,
  Sparkles,
  HardDrive,
} from 'lucide-react';
import { Button } from '../components/common/Button';
import { Card } from '../components/common/Card';
import { CreateRoomModal } from '../components/room/CreateRoomModal';
import { JoinRoomModal } from '../components/room/JoinRoomModal';

export const LandingPage: React.FC = () => {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isJoinOpen, setIsJoinOpen] = useState(false);

  return (
    <div className="relative overflow-hidden">
      {/* Background Japanese Aesthetic Glows */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[500px] bg-gradient-to-tr from-violet-600/20 via-pink-600/15 to-transparent blur-[140px] pointer-events-none -z-10" />
      <div className="absolute top-2/3 right-10 w-[400px] h-[400px] bg-cyan-600/10 blur-[120px] pointer-events-none -z-10" />

      {/* Hero Section */}
      <section className="pt-20 pb-24 px-4 sm:px-6 max-w-5xl mx-auto text-center">
        {/* Japanese Top Pill */}
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-void-800/80 border border-void-600/60 text-xs font-mono text-ink-muted mb-8 shadow-sm">
          <span className="w-2 h-2 rounded-full bg-pink-accent animate-pulse" />
          <span>プライベートアニメ同期視聴</span>
          <span className="text-void-600">•</span>
          <span className="text-violet-400 font-semibold">100% Free & Self-Hosted</span>
        </div>

        {/* Headline */}
        <h1 className="text-4xl sm:text-6xl md:text-7xl font-extrabold tracking-tight text-white mb-6 leading-[1.1]">
          Your Anime Night.{' '}
          <span className="text-gradient">Together.</span>
        </h1>

        {/* Supporting Text */}
        <p className="text-lg sm:text-xl text-ink-muted max-w-2xl mx-auto mb-10 leading-relaxed font-normal">
          Sync your screens, grab your snacks, and enjoy every episode together — wherever you are.
        </p>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
          <Button
            size="lg"
            variant="primary"
            leftIcon={<Sparkles className="w-5 h-5" />}
            onClick={() => setIsCreateOpen(true)}
            className="w-full sm:w-auto"
          >
            Create Watch Room
          </Button>

          <Button
            size="lg"
            variant="secondary"
            leftIcon={<Users className="w-5 h-5 text-violet-400" />}
            onClick={() => setIsJoinOpen(true)}
            className="w-full sm:w-auto"
          >
            Join with Code
          </Button>
        </div>

        {/* Visual Preview Card */}
        <div className="relative max-w-4xl mx-auto rounded-3xl p-1 bg-gradient-to-b from-void-600/80 via-void-700/40 to-void-800/20 shadow-2xl">
          <div className="bg-void-950/95 rounded-[22px] p-6 sm:p-8 border border-void-700/60">
            <div className="flex items-center justify-between pb-6 border-b border-void-700/60 mb-6">
              <div className="flex items-center gap-3">
                <span className="w-3 h-3 rounded-full bg-rose-500/80 inline-block" />
                <span className="w-3 h-3 rounded-full bg-amber-500/80 inline-block" />
                <span className="w-3 h-3 rounded-full bg-emerald-500/80 inline-block" />
                <span className="text-xs font-mono text-ink-dim pl-2">AnimeSync Room: ASYNC1</span>
              </div>
              <div className="inline-flex items-center gap-2 text-xs font-mono text-emerald-400 bg-emerald-950/60 px-3 py-1 rounded-full border border-emerald-800/60">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span>Synchronized (0.00s drift)</span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
              <div className="md:col-span-2 space-y-4">
                <div className="aspect-video bg-void-900 rounded-xl border border-void-700/80 flex flex-col items-center justify-center p-6 text-center relative overflow-hidden group">
                  <div className="w-16 h-16 rounded-full bg-violet-600/20 border border-violet-500/30 flex items-center justify-center mb-3">
                    <Play className="w-7 h-7 text-violet-accent fill-violet-accent/20" />
                  </div>
                  <h4 className="text-base font-semibold text-white">Local Desktop Playback</h4>
                  <p className="text-xs text-ink-muted mt-1 max-w-sm">
                    No proxy bandwidth limits. Full 1080p 60fps quality with zero server buffering.
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <div className="p-4 rounded-xl bg-void-900/80 border border-void-700/80">
                  <div className="text-[11px] font-mono text-ink-dim uppercase">Participants</div>
                  <div className="mt-2 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-400" />
                        <span className="text-sm font-medium text-white">Rohan (Host)</span>
                      </div>
                      <span className="text-[10px] font-mono bg-violet-950 text-violet-300 px-2 py-0.5 rounded border border-violet-800">Ready</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-400" />
                        <span className="text-sm font-medium text-white">Friend</span>
                      </div>
                      <span className="text-[10px] font-mono bg-cyan-950 text-cyan-300 px-2 py-0.5 rounded border border-cyan-800">Verified</span>
                    </div>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-void-900/80 border border-void-700/80">
                  <div className="text-[11px] font-mono text-ink-dim uppercase">SHA-256 Checksum</div>
                  <div className="mt-1 font-mono text-[11px] text-cyan-300 truncate">
                    e3b0c44298fc1c149afbf4c8...
                  </div>
                  <div className="mt-2 text-[11px] text-ink-muted flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Exact file match verified</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Feature Pillars */}
      <section className="py-20 px-4 sm:px-6 max-w-6xl mx-auto border-t border-void-700/40">
        <div className="text-center mb-16">
          <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
            Built Specifically for High Quality Anime Watching
          </h2>
          <p className="text-sm text-ink-muted mt-2">
            No laggy screen shares, no choppy Discord streaming, and no paid subscriptions.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card variant="interactive" glow="violet">
            <div className="w-12 h-12 rounded-xl bg-violet-950 border border-violet-800/80 flex items-center justify-center mb-4 text-violet-400">
              <HardDrive className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-white mb-2">Local File Playback</h3>
            <p className="text-sm text-ink-muted leading-relaxed">
              Video is played directly from each participant's local Mac disk. Free tunnels are never overloaded with live video streaming.
            </p>
          </Card>

          <Card variant="interactive" glow="cyan">
            <div className="w-12 h-12 rounded-xl bg-cyan-950 border border-cyan-800/80 flex items-center justify-center mb-4 text-cyan-400">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-white mb-2">SHA-256 Verification</h3>
            <p className="text-sm text-ink-muted leading-relaxed">
              Incremental background Web Worker hashing guarantees both files are identical down to the last byte before the Ready gate unlocks.
            </p>
          </Card>

          <Card variant="interactive" glow="pink">
            <div className="w-12 h-12 rounded-xl bg-pink-950 border border-pink-800/80 flex items-center justify-center mb-4 text-pink-400">
              <Sliders className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-white mb-2">Independent Audio</h3>
            <p className="text-sm text-ink-muted leading-relaxed">
              Turn up anime volume without drowning out your friend's voice. Boost their voice up to 200% with Push-to-Talk (<kbd className="font-mono bg-void-800 px-1.5 py-0.5 rounded text-ink-text border border-void-600">V</kbd>).
            </p>
          </Card>
        </div>
      </section>

      {/* Modals */}
      <CreateRoomModal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} />
      <JoinRoomModal isOpen={isJoinOpen} onClose={() => setIsJoinOpen(false)} />
    </div>
  );
};
