import { useEffect, useState } from 'react';
import { useAuthStore } from './store/auth';
import { gateway } from './lib/gatewayConnection';
import AuthPage from './pages/AuthPage';
import ProfilePage from './pages/ProfilePage';
import MainPage from './pages/MainPage';

export default function App() {
  const user = useAuthStore((s) => s.user);
  const initialized = useAuthStore((s) => s.initialized);
  const initSession = useAuthStore((s) => s.initSession);
  const [view, setView] = useState<'main' | 'profile'>('main');

  // Beim Laden einmal versuchen, die Sitzung über das Refresh-Cookie wiederherzustellen.
  useEffect(() => {
    void initSession();
  }, [initSession]);

  // Gateway-Verbindung an den Login-Zustand koppeln.
  const userId = user?.id ?? null;
  useEffect(() => {
    if (!userId) return;
    gateway.connect();
    return gateway.disconnect;
  }, [userId]);

  if (!initialized) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-900 text-zinc-400">
        Lade …
      </div>
    );
  }

  if (!user) return <AuthPage />;
  return view === 'profile' ? (
    <ProfilePage onBack={() => setView('main')} />
  ) : (
    <MainPage onOpenProfile={() => setView('profile')} />
  );
}
