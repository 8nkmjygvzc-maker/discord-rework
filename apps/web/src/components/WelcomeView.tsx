import { useAuthStore } from '../store/auth';

interface WelcomeViewProps {
  /** Wechselt zum Freunde-Panel (dort steht das Anfrage-Formular). */
  onAddFriends: () => void;
  onCreateServer: () => void;
  onJoinServer: () => void;
  /** Blendet die Ansicht für diese Sitzung aus (→ Freunde-Panel). */
  onSkip: () => void;
}

/**
 * Onboarding (Phase 15): Erste-Schritte-Ansicht für frische Konten
 * (keine Server, keine Freunde/Anfragen, keine DMs). Verschwindet von selbst,
 * sobald eine der Aktionen Früchte trägt; „Überspringen“ blendet sie nur für
 * diese Sitzung aus (rein im Speicher, wie die Ungelesen-Zähler).
 */
export default function WelcomeView({
  onAddFriends,
  onCreateServer,
  onJoinServer,
  onSkip,
}: WelcomeViewProps) {
  const username = useAuthStore((s) => s.user?.username);

  return (
    <main className="flex min-w-0 flex-1 overflow-y-auto">
      <div className="m-auto w-full max-w-xl px-6 py-10" data-testid="welcome-view">
        <h2 className="text-2xl font-bold text-zinc-100">
          Willkommen bei Parley{username ? `, ${username}` : ''}!
        </h2>
        <p className="mt-2 text-sm text-zinc-400">Noch ist es hier still – so legst du los:</p>

        <div className="mt-6 space-y-3">
          <WelcomeCard
            icon="📨"
            title="Einladung einlösen"
            description="Dir hat jemand einen Einladungslink geschickt? Füge ihn ein und tritt dem Server bei."
            onClick={onJoinServer}
            testId="welcome-join-server"
          />
          <WelcomeCard
            icon="🚀"
            title="Eigenen Server erstellen"
            description="Starte deine eigene Community mit Text- und Sprachkanälen."
            onClick={onCreateServer}
            testId="welcome-create-server"
          />
          <WelcomeCard
            icon="👥"
            title="Freunde hinzufügen"
            description="Finde Freunde per Benutzername und schreibt euch direkt."
            onClick={onAddFriends}
            testId="welcome-add-friends"
          />
        </div>

        <p className="mt-6 text-xs text-zinc-500">
          🔒 Alle Nachrichten sind Ende-zu-Ende verschlüsselt – nur du und deine Empfänger können
          sie lesen.
        </p>

        <button
          type="button"
          onClick={onSkip}
          className="mt-4 text-xs text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline"
        >
          Überspringen
        </button>
      </div>
    </main>
  );
}

function WelcomeCard({
  icon,
  title,
  description,
  onClick,
  testId,
}: {
  icon: string;
  title: string;
  description: string;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className="flex w-full items-center gap-4 rounded-xl border border-zinc-700 bg-zinc-900 p-4 text-left transition hover:border-indigo-500 hover:bg-zinc-900/60"
    >
      <span className="text-2xl">{icon}</span>
      <span className="min-w-0">
        <span className="block font-semibold text-zinc-100">{title}</span>
        <span className="mt-0.5 block text-sm text-zinc-400">{description}</span>
      </span>
      <span className="ml-auto text-zinc-500">›</span>
    </button>
  );
}
