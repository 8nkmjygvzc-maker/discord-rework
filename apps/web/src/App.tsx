import { useEffect } from 'react';
import { useAuthStore } from './store/auth';
import AuthPage from './pages/AuthPage';
import ProfilePage from './pages/ProfilePage';

export default function App() {
  const user = useAuthStore((s) => s.user);
  const initialized = useAuthStore((s) => s.initialized);
  const initSession = useAuthStore((s) => s.initSession);

  // Beim Laden einmal versuchen, die Sitzung über das Refresh-Cookie wiederherzustellen.
  useEffect(() => {
    void initSession();
  }, [initSession]);

  if (!initialized) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-900 text-zinc-400">
        Lade …
      </div>
    );
  }

  return user ? <ProfilePage /> : <AuthPage />;
}
