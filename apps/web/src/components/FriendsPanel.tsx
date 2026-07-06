import { FormEvent, useState } from 'react';
import type { PublicUser } from '@parley/shared';
import { useFriendsStore } from '../store/friends';
import { useDmsStore } from '../store/dms';
import { usePresenceStore } from '../store/presence';
import { ApiError } from '../lib/api';

type Tab = 'friends' | 'requests' | 'blocked';

/** Hauptbereich der Home-Ansicht: Freunde, Anfragen, Blockierte. */
export default function FriendsPanel() {
  const list = useFriendsStore((s) => s.list);
  const addFriend = useFriendsStore((s) => s.addFriend);
  const accept = useFriendsStore((s) => s.accept);
  const remove = useFriendsStore((s) => s.remove);
  const block = useFriendsStore((s) => s.block);
  const unblock = useFriendsStore((s) => s.unblock);
  const openDm = useDmsStore((s) => s.openDm);
  const onlineUsers = usePresenceStore((s) => s.onlineUsers);

  const [tab, setTab] = useState<Tab>('friends');
  const [username, setUsername] = useState('');
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const onlineIds = new Set(onlineUsers.map((u) => u.id));
  const requestCount = list.incoming.length;

  /** Fehler der Aktions-Buttons einheitlich anzeigen. */
  function run(action: Promise<void>): void {
    setFeedback(null);
    action.catch((err: unknown) =>
      setFeedback({
        ok: false,
        text: err instanceof ApiError ? err.message : 'Aktion fehlgeschlagen',
      }),
    );
  }

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    const name = username.trim();
    if (!name) return;
    setFeedback(null);
    try {
      await addFriend(name);
      setFeedback({ ok: true, text: `Anfrage an ${name} gesendet.` });
      setUsername('');
    } catch (err) {
      setFeedback({
        ok: false,
        text: err instanceof ApiError ? err.message : 'Anfrage fehlgeschlagen',
      });
    }
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'friends', label: `Freunde – ${list.friends.length}` },
    { id: 'requests', label: `Anfragen${requestCount > 0 ? ` (${requestCount})` : ''}` },
    { id: 'blocked', label: `Blockiert – ${list.blocked.length}` },
  ];

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-4 border-b border-zinc-950/50 px-4 py-3 shadow">
        <span className="font-semibold">Freunde</span>
        <nav className="flex gap-2">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`rounded px-2 py-1 text-sm ${
                tab === t.id
                  ? 'bg-zinc-700/60 text-zinc-100'
                  : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <form onSubmit={(e) => void onAdd(e)} className="mb-4 flex gap-2">
          <input
            className="flex-1 rounded-lg border border-zinc-600 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Freund per Benutzername hinzufügen"
            maxLength={40}
            data-testid="add-friend-input"
          />
          <button
            type="submit"
            disabled={username.trim().length < 3}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Anfrage senden
          </button>
        </form>
        {feedback && (
          <p
            className={`mb-4 rounded-lg border px-3 py-2 text-sm ${
              feedback.ok
                ? 'border-emerald-900 bg-emerald-950/50 text-emerald-400'
                : 'border-red-900 bg-red-950/50 text-red-400'
            }`}
          >
            {feedback.text}
          </p>
        )}

        {tab === 'friends' && (
          <UserList
            users={list.friends}
            emptyText="Noch keine Freunde – schick eine Anfrage!"
            renderStatus={(u) => (onlineIds.has(u.id) ? 'online' : 'offline')}
            actions={(u) => (
              <>
                <ActionButton label="Nachricht" primary onClick={() => run(openDm(u.id))} />
                <ActionButton label="Entfernen" onClick={() => run(remove(u.id))} />
                <ActionButton label="Blockieren" danger onClick={() => run(block(u.id))} />
              </>
            )}
          />
        )}

        {tab === 'requests' && (
          <div className="space-y-6">
            <section>
              <h3 className="mb-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                Eingehend – {list.incoming.length}
              </h3>
              <UserList
                users={list.incoming.map((r) => r.user)}
                emptyText="Keine eingehenden Anfragen."
                actions={(u) => (
                  <>
                    <ActionButton label="Annehmen" primary onClick={() => run(accept(u.id))} />
                    <ActionButton label="Ablehnen" onClick={() => run(remove(u.id))} />
                  </>
                )}
              />
            </section>
            <section>
              <h3 className="mb-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                Ausgehend – {list.outgoing.length}
              </h3>
              <UserList
                users={list.outgoing.map((r) => r.user)}
                emptyText="Keine ausstehenden Anfragen."
                actions={(u) => (
                  <ActionButton label="Zurückziehen" onClick={() => run(remove(u.id))} />
                )}
              />
            </section>
          </div>
        )}

        {tab === 'blocked' && (
          <UserList
            users={list.blocked}
            emptyText="Du hast niemanden blockiert."
            actions={(u) => <ActionButton label="Entblocken" onClick={() => run(unblock(u.id))} />}
          />
        )}
      </div>
    </main>
  );
}

function UserList({
  users,
  emptyText,
  actions,
  renderStatus,
}: {
  users: PublicUser[];
  emptyText: string;
  actions: (user: PublicUser) => React.ReactNode;
  renderStatus?: (user: PublicUser) => 'online' | 'offline';
}) {
  if (users.length === 0) {
    return <p className="text-sm text-zinc-500">{emptyText}</p>;
  }
  return (
    <ul className="space-y-1">
      {users.map((user) => {
        const status = renderStatus?.(user);
        return (
          <li
            key={user.id}
            className="group flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-zinc-700/40"
          >
            <div className="relative">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-700 font-bold text-white">
                {user.username.slice(0, 1).toUpperCase()}
              </div>
              {status && (
                <span
                  title={status === 'online' ? 'Online' : 'Offline'}
                  className={`absolute -right-0.5 -bottom-0.5 h-3 w-3 rounded-full border-2 border-zinc-800 ${
                    status === 'online' ? 'bg-emerald-500' : 'bg-zinc-600'
                  }`}
                />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-zinc-100">{user.username}</p>
              <p className="truncate text-xs text-zinc-500">
                {status ? (status === 'online' ? 'Online' : 'Offline') : user.status || ' '}
              </p>
            </div>
            <div className="flex gap-1.5 opacity-0 transition group-hover:opacity-100">
              {actions(user)}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function ActionButton({
  label,
  onClick,
  primary,
  danger,
}: {
  label: string;
  onClick: () => void;
  primary?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded px-2.5 py-1 text-xs font-semibold transition ${
        primary
          ? 'bg-indigo-600 text-white hover:bg-indigo-500'
          : danger
            ? 'bg-zinc-800 text-red-400 hover:bg-red-950'
            : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
      }`}
    >
      {label}
    </button>
  );
}
