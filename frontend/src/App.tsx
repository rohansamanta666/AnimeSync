import React, { useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Navbar } from './components/common/Navbar';
import { LandingPage } from './pages/LandingPage';
import { RoomPage } from './pages/RoomPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { CreateRoomModal } from './components/room/CreateRoomModal';
import { JoinRoomModal } from './components/room/JoinRoomModal';

export const App: React.FC = () => {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isJoinOpen, setIsJoinOpen] = useState(false);

  return (
    <BrowserRouter>
      <div className="min-h-screen flex flex-col bg-void-950 text-ink-text">
        <Navbar
          onCreateRoom={() => setIsCreateOpen(true)}
          onJoinRoom={() => setIsJoinOpen(true)}
        />

        <main className="flex-1">
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/room/:code" element={<RoomPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </main>

        <footer className="border-t border-void-800/80 py-8 px-4 text-center text-xs text-ink-dim font-mono">
          <p>AnimeSync — Private Desktop-First Anime Watch Party • Built for high-quality synchronized viewing.</p>
        </footer>

        {/* Global Nav Modals */}
        <CreateRoomModal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} />
        <JoinRoomModal isOpen={isJoinOpen} onClose={() => setIsJoinOpen(false)} />
      </div>
    </BrowserRouter>
  );
};

export default App;

