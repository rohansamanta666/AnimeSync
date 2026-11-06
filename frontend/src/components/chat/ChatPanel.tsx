/**
 * ChatPanel — Phase 7 Task 7.1
 *
 * Real-time text chat panel with message history, timestamps, sender badges,
 * and input sanitization.
 */
import React, { useState, useRef, useEffect } from 'react';
import { Send, MessageSquare, AlertCircle } from 'lucide-react';
import { ChatMessage } from '../../types';
import { Button } from '../common/Button';

export interface ChatPanelProps {
  messages: ChatMessage[];
  onSendMessage: (content: string) => Promise<void>;
  currentParticipantId?: string | null;
  hostParticipantId?: string | null;
  isLoading?: boolean;
  className?: string;
}

function formatTime(isoString: string): string {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
  messages,
  onSendMessage,
  currentParticipantId,
  hostParticipantId,
  isLoading = false,
  className = '',
}) => {
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = inputText.trim();
    if (!trimmed || isSending) return;

    setIsSending(true);
    setSendError(null);
    try {
      await onSendMessage(trimmed);
      setInputText('');
    } catch (err: any) {
      setSendError(err.message || 'Failed to send message');
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className={`p-4 glass-panel rounded-2xl flex flex-col h-[420px] ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-void-700/60 mb-3 shrink-0">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-violet-400" />
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">
            Room Chat ({messages.length})
          </h3>
        </div>
        <span className="text-[10px] font-mono text-ink-dim">
          Realtime Persistent
        </span>
      </div>

      {/* Message List */}
      <div className="flex-1 overflow-y-auto space-y-3 pr-1 scrollbar-thin">
        {isLoading && messages.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="w-6 h-6 rounded-full border-2 border-violet-500 border-t-transparent animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-4 text-ink-muted space-y-1">
            <MessageSquare className="w-8 h-8 text-void-600 mb-1" />
            <p className="text-xs">No messages yet</p>
            <p className="text-[10px] text-ink-dim">Send a message to start chatting!</p>
          </div>
        ) : (
          messages.map((msg) => {
            const isOwn = msg.participant_id === currentParticipantId;
            const isHost = msg.participant_id === hostParticipantId;

            return (
              <div
                key={msg.id}
                className={`flex gap-2.5 items-start ${
                  isOwn ? 'flex-row-reverse' : ''
                }`}
              >
                {/* Avatar */}
                <div
                  className={`w-7 h-7 rounded-lg text-xs font-bold flex items-center justify-center shrink-0 shadow-sm ${
                    isOwn
                      ? 'bg-violet-600 text-white'
                      : 'bg-void-800 text-ink-muted border border-void-700'
                  }`}
                >
                  {msg.username.charAt(0).toUpperCase()}
                </div>

                {/* Message Body */}
                <div
                  className={`max-w-[80%] rounded-xl px-3 py-2 text-xs leading-relaxed space-y-1 shadow-sm ${
                    isOwn
                      ? 'bg-violet-950/80 border border-violet-600/50 text-white rounded-tr-none'
                      : 'bg-void-900 border border-void-700/80 text-ink-text rounded-tl-none'
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-[10px]">
                    <span
                      className={`font-semibold ${
                        isOwn ? 'text-violet-300' : 'text-pink-400'
                      }`}
                    >
                      {msg.username}
                    </span>
                    {isHost && (
                      <span className="text-[8px] font-mono uppercase px-1 py-0.2 rounded bg-violet-950 text-violet-400 border border-violet-800">
                        Host
                      </span>
                    )}
                    {isOwn && (
                      <span className="text-[8px] font-mono text-ink-dim">
                        (You)
                      </span>
                    )}
                    <span className="text-ink-dim font-mono ml-auto">
                      {formatTime(msg.created_at)}
                    </span>
                  </div>

                  <p className="break-words select-text">{msg.content}</p>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Error alert */}
      {sendError && (
        <div className="mt-2 px-3 py-1.5 rounded-lg bg-rose-950/80 border border-rose-800 text-rose-300 text-[11px] flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-400" />
          <span className="flex-1 truncate">{sendError}</span>
        </div>
      )}

      {/* Input Form */}
      <form onSubmit={handleSend} className="mt-3 pt-2 border-t border-void-700/60 shrink-0">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            maxLength={1000}
            disabled={isSending}
            className="flex-1 bg-void-900 border border-void-700 rounded-xl px-3 py-2 text-xs text-white placeholder-ink-dim focus:outline-none focus:border-violet-500 transition-colors"
          />

          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={!inputText.trim() || isSending}
            className="h-8 px-3"
            title="Send Message (Enter)"
          >
            <Send className="w-3.5 h-3.5" />
          </Button>
        </div>
        <div className="flex justify-between items-center px-1 mt-1 text-[9px] font-mono text-ink-dim">
          <span>Press Enter to send</span>
          <span>{inputText.length} / 1000</span>
        </div>
      </form>
    </div>
  );
};
