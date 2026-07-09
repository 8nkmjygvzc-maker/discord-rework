import { useCallback, useEffect, useState } from 'react';
import {
  AuditAction,
  AuditLogEntryInfo,
  BanInfo,
  hasPermission,
  Permissions,
  permissionsFromString,
} from '@parley/shared';
import { useServersStore } from '../store/servers';
import Modal from './Modal';
import { ApiError } from '../lib/api';

/** Menschlich lesbare Bezeichnung der Audit-Aktionen (Phase 13). */
const ACTION_LABEL: Record<AuditAction, string> = {
  MEMBER_KICK: 'hat gekickt',
  MEMBER_BAN: 'hat gebannt',
  MEMBER_UNBAN: 'hat entbannt',
  MEMBER_TIMEOUT: 'schickte in Auszeit',
  MEMBER_TIMEOUT_REMOVE: 'hob die Auszeit auf für',
  MESSAGE_DELETE: 'löschte eine Nachricht von',
  VOICE_DISCONNECT: 'trennte aus dem Voice',
};

function fmt(iso: string): string {
  return new Date(iso).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Moderations-Übersicht: aktive Bannungen (mit Entbannen) und das Audit-Log. */
export default function ModerationDialog({ onClose }: { onClose: () => void }) {
  const server = useServersStore((s) => s.selectedServer);
  const listBans = useServersStore((s) => s.listBans);
  const loadAuditLog = useServersStore((s) => s.loadAuditLog);
  const unbanMember = useServersStore((s) => s.unbanMember);

  const myPerms = server ? permissionsFromString(server.myPermissions) : 0n;
  const canBans = hasPermission(myPerms, Permissions.BanMembers);
  const canAudit = hasPermission(myPerms, Permissions.ViewAuditLog);

  const [tab, setTab] = useState<'bans' | 'audit'>(canBans ? 'bans' : 'audit');
  const [bans, setBans] = useState<BanInfo[]>([]);
  const [log, setLog] = useState<AuditLogEntryInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refreshBans = useCallback(() => {
    listBans()
      .then(setBans)
      .catch((e: unknown) =>
        setError(e instanceof ApiError ? e.message : 'Bannliste nicht ladbar'),
      );
  }, [listBans]);

  useEffect(() => {
    if (canBans) refreshBans();
    if (canAudit) {
      loadAuditLog()
        .then(setLog)
        .catch((e: unknown) =>
          setError(e instanceof ApiError ? e.message : 'Audit-Log nicht ladbar'),
        );
    }
  }, [canBans, canAudit, refreshBans, loadAuditLog]);

  async function onUnban(userId: string) {
    setError(null);
    try {
      await unbanMember(userId);
      refreshBans();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Entbannen fehlgeschlagen');
    }
  }

  if (!server) return null;

  return (
    <Modal title="Moderation" onClose={onClose}>
      <div className="mb-3 flex gap-1 text-sm">
        {canBans && (
          <TabButton active={tab === 'bans'} onClick={() => setTab('bans')}>
            Bannliste ({bans.length})
          </TabButton>
        )}
        {canAudit && (
          <TabButton active={tab === 'audit'} onClick={() => setTab('audit')}>
            Audit-Log
          </TabButton>
        )}
      </div>

      {error && (
        <p className="mb-2 rounded-lg border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-400">
          {error}
        </p>
      )}

      {tab === 'bans' && (
        <ul className="max-h-80 space-y-1 overflow-y-auto" data-testid="ban-list">
          {bans.length === 0 && (
            <li className="py-6 text-center text-sm text-zinc-500">Keine aktiven Bannungen.</li>
          )}
          {bans.map((ban) => (
            <li
              key={ban.userId}
              className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900/60 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-zinc-200">{ban.username}</p>
                <p className="truncate text-xs text-zinc-500">
                  von {ban.bannedByUsername} · {fmt(ban.createdAt)}
                  {ban.reason ? ` · ${ban.reason}` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void onUnban(ban.userId)}
                className="shrink-0 rounded border border-zinc-600 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
              >
                Entbannen
              </button>
            </li>
          ))}
        </ul>
      )}

      {tab === 'audit' && (
        <ul className="max-h-80 space-y-1 overflow-y-auto" data-testid="audit-log">
          {log.length === 0 && (
            <li className="py-6 text-center text-sm text-zinc-500">
              Noch keine moderativen Aktionen.
            </li>
          )}
          {log.map((e) => (
            <li key={e.id} className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-1.5">
              <p className="text-sm text-zinc-300">
                <span className="font-semibold text-zinc-200">{e.actorUsername}</span>{' '}
                {ACTION_LABEL[e.action]}
                {e.targetUsername ? (
                  <span className="font-semibold text-zinc-200"> {e.targetUsername}</span>
                ) : null}
                {e.reason ? <span className="text-zinc-500"> – {e.reason}</span> : null}
              </p>
              <p className="text-[10px] text-zinc-500">{fmt(e.createdAt)}</p>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 ${
        active ? 'bg-indigo-600/30 text-indigo-300' : 'text-zinc-400 hover:bg-zinc-700/50'
      }`}
    >
      {children}
    </button>
  );
}
