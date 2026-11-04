import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogIn } from 'lucide-react';
import { Modal } from '../common/Modal';
import { Input } from '../common/Input';
import { Button } from '../common/Button';
import { api, sessionStore } from '../../services/api';

interface JoinRoomModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialCode?: string;
}

export const JoinRoomModal: React.FC<JoinRoomModalProps> = ({
  isOpen,
  onClose,
  initialCode = '',
}) => {
  const navigate = useNavigate();
  const [code, setCode] = useState(initialCode);
  const [username, setUsername] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = code.trim().toUpperCase();
    if (cleanCode.length !== 6) {
      setError('Room code must be exactly 6 characters');
      return;
    }
    if (!username.trim()) {
      setError('Please enter your display name');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const auth = await api.joinRoom(cleanCode, username.trim());
      sessionStore.save(auth.room.code, auth);
      onClose();
      navigate(`/room/${auth.room.code}`);
    } catch (err: any) {
      setError(err.message || 'Failed to join room. Please check the code.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Join Watch Party"
      description="Enter the 6-character room invitation code provided by your host."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="6-Character Room Code"
          placeholder="e.g. ASYNC1"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          maxLength={6}
          className="font-mono text-center tracking-widest text-lg font-bold uppercase"
          autoFocus
          required
        />

        <Input
          label="Your Display Name"
          placeholder="e.g. Alex"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />

        {error && (
          <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-800 text-rose-300 text-xs">
            {error}
          </div>
        )}

        <div className="pt-2 flex justify-end gap-2.5">
          <Button variant="ghost" type="button" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            variant="accent"
            type="submit"
            isLoading={isLoading}
            leftIcon={<LogIn className="w-4 h-4" />}
          >
            Enter Room
          </Button>
        </div>
      </form>
    </Modal>
  );
};

