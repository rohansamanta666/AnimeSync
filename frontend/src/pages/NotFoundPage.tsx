import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Ghost, ArrowLeft } from 'lucide-react';
import { Button } from '../components/common/Button';

export const NotFoundPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-[70vh] flex flex-col items-center justify-center p-6 text-center">
      <div className="w-16 h-16 rounded-2xl bg-void-800 border border-void-600 flex items-center justify-center mb-6 text-violet-400">
        <Ghost className="w-8 h-8" />
      </div>
      <h1 className="text-3xl font-extrabold text-white mb-2">404 — Page Not Found</h1>
      <p className="text-sm text-ink-muted max-w-sm mb-6">
        The page or watch room you are looking for does not exist or has been moved.
      </p>
      <Button variant="primary" onClick={() => navigate('/')} leftIcon={<ArrowLeft className="w-4 h-4" />}>
        Back to AnimeSync
      </Button>
    </div>
  );
};

