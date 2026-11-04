import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { Modal } from '../common/Modal';
import { Input } from '../common/Input';
import { Button } from '../common/Button';
import { api, sessionStore } from '../../services/api';

interface CreateRoomModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CreateRoomModal: React.FC<CreateRoomModalProps> = ({ isOpen, onClose }) => {
  const navigate = useNavigate();
  const [roomName, setRoomName] = useState('');
  const [hostUsername, setHostUsername] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomName.trim() || !hostUsername.trim()) {
      setError('Please fill in both the room name and your display name');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const auth = await api.createRoom(roomName.trim(), hostUsername.trim());
      sessionStore.save(auth.room.code, auth);
      onClose();
      navigate(`/room/${auth.room.code}`);
    } catch (err: any) {
      setError(err.message || 'Failed to create room. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Create Watch Room"
      description="Create a private room. You'll receive a 6-character code to invite your friend."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Room Name"
          placeholder="e.g. Friday Anime Night, Frieren Ep 1-4"
          value={roomName}
          onChange={(e) => setRoomName(e.target.value)}
          autoFocus
          required
        />

        <Input
          label="Your Display Name (Host)"
          placeholder="e.g. Rohan"
          value={hostUsername}
          onChange={(e) => setHostUsername(e.target.value)}
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
            variant="primary"
            type="submit"
            isLoading={isLoading}
            leftIcon={<Sparkles className="w-4 h-4" />}
          >
            Create Room
          </Button>
        </div>
      </form>
    </Modal>
  );
};

