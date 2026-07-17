import { FormEvent, useRef, useState } from 'react';
import { hasPermission, Permissions, permissionsFromString } from '@parley/shared';
import { useAuthStore } from '../store/auth';
import { useServersStore } from '../store/servers';
import { ApiError } from '../lib/api';
import { uploadServerIcon } from '../lib/profileImage';
import Avatar from './Avatar';
import Modal from './Modal';

interface ServerSettingsDialogProps {
  onClose: () => void;
  /** Schnellzugriff auf die bestehenden Verwaltungs-Dialoge. */
  onOpenRoles: () => void;
  onOpenInvite: () => void;
  onOpenModeration: () => void;
}

/**
 * Servereinstellungen (Verbesserungs-Runde): Name ändern, Icon hochladen/
 * entfernen, Schnellzugriff auf Rollen/Einladungen/Moderation und die
 * Gefahrenzone (Server löschen bzw. verlassen). Erreichbar über das
 * Server-Menü im Sidebar-Kopf.
 */
export default function ServerSettingsDialog({
  onClose,
  onOpenRoles,
  onOpenInvite,
  onOpenModeration,
}: ServerSettingsDialogProps) {
  const server = useServersStore((s) => s.selectedServer);
  const updateServer = useServersStore((s) => s.updateServer);
  const deleteServer = useServersStore((s) => s.deleteServer);
  const leaveServer = useServersStore((s) => s.leaveServer);
  const user = useAuthStore((s) => s.user);

  const iconInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(server?.name ?? '');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  if (!server || !user) return null;
  const isOwner = server.ownerId === user.id;
  const myPerms = permissionsFromString(server.myPermissions);
  const canManageServer = hasPermission(myPerms, Permissions.ManageServer);
  const canManageRoles = hasPermission(myPerms, Permissions.ManageRoles);
  const canInvite = hasPermission(myPerms, Permissions.CreateInvite);
  const canModerate =
    hasPermission(myPerms, Permissions.KickMembers) ||
    hasPermission(myPerms, Permissions.BanMembers) ||
    hasPermission(myPerms, Permissions.ModerateMembers) ||
    canManageServer;

  async function run(what: string, action: () => Promise<unknown>, okText?: string) {
    setBusy(true);
    setFeedback(null);
    try {
      await action();
      if (okText) setFeedback({ ok: true, text: okText });
    } catch (err) {
      setFeedback({
        ok: false,
        text:
          err instanceof ApiError || err instanceof Error
            ? `${what}: ${err.message}`
            : `${what} fehlgeschlagen`,
      });
    } finally {
      setBusy(false);
    }
  }

  function onRename(e: FormEvent) {
    e.preventDefault();
    const next = name.trim();
    if (!server || next.length < 2 || next === server.name) return;
    void run('Umbenennen', () => updateServer(server.id, { name: next }), 'Name gespeichert.');
  }

  function onIconSelected(files: FileList | null) {
    const file = files?.[0];
    if (!file || !server) return;
    void run('Icon-Upload', () => uploadServerIcon(server.id, file), 'Icon aktualisiert.');
  }

  return (
    <Modal title="Servereinstellungen" onClose={onClose}>
      {/* Übersicht: Icon + Name */}
      <div className="flex items-center gap-4">
        <input
          ref={iconInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          data-testid="settings-icon-input"
          onChange={(e) => {
            onIconSelected(e.target.files);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          title={canManageServer ? 'Server-Icon ändern' : server.name}
          disabled={!canManageServer || busy}
          onClick={() => iconInputRef.current?.click()}
          className="group relative shrink-0 rounded-full disabled:cursor-default"
        >
          <Avatar name={server.name} avatarUrl={server.iconUrl} sizeClass="h-16 w-16 text-xl" />
          {canManageServer && (
            <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 text-xs font-semibold text-white opacity-0 transition group-hover:opacity-100">
              Ändern
            </span>
          )}
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-zinc-100">{server.name}</p>
          <p className="text-xs text-zinc-500">
            {server.ownerId === user.id ? 'Du bist der Owner' : 'Mitglied'}
          </p>
          {canManageServer && server.iconUrl && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(
                  'Icon entfernen',
                  () => updateServer(server.id, { iconUrl: '' }),
                  'Icon entfernt.',
                )
              }
              className="mt-1 text-xs text-zinc-500 hover:text-red-400"
            >
              Icon entfernen
            </button>
          )}
        </div>
      </div>

      {canManageServer && (
        <form onSubmit={onRename} className="mt-5">
          <label className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
            Servername
          </label>
          <div className="mt-1 flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              data-testid="settings-server-name"
              className="min-w-0 flex-1 rounded-lg border border-zinc-600 bg-zinc-900 px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={busy || name.trim().length < 2 || name.trim() === server.name}
              className="shrink-0 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50"
            >
              Speichern
            </button>
          </div>
        </form>
      )}

      {/* Schnellzugriff auf die Verwaltungs-Dialoge */}
      {(canManageRoles || canInvite || canModerate) && (
        <div className="mt-5">
          <p className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">Verwaltung</p>
          <div className="mt-2 space-y-1">
            {canInvite && <SettingsLink icon="📨" label="Einladungen" onClick={onOpenInvite} />}
            {canManageRoles && (
              <SettingsLink icon="🏷️" label="Rollen & Berechtigungen" onClick={onOpenRoles} />
            )}
            {canModerate && (
              <SettingsLink
                icon="🛡️"
                label="Moderation (Banns & Audit-Log)"
                onClick={onOpenModeration}
              />
            )}
          </div>
        </div>
      )}

      {/* Gefahrenzone */}
      <div className="mt-5 rounded-lg border border-red-900/60 p-3">
        <p className="text-xs font-semibold tracking-wide text-red-400/80 uppercase">
          Gefahrenzone
        </p>
        {isOwner ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (window.confirm(`Server „${server.name}“ endgültig löschen?`)) {
                void run('Server löschen', async () => {
                  await deleteServer(server.id);
                  onClose();
                });
              }
            }}
            className="mt-2 rounded-lg border border-red-900 px-3 py-1.5 text-sm text-red-400 hover:bg-red-950/50"
          >
            Server endgültig löschen
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run('Server verlassen', async () => {
                await leaveServer(server.id);
                onClose();
              })
            }
            className="mt-2 rounded-lg border border-red-900 px-3 py-1.5 text-sm text-red-400 hover:bg-red-950/50"
          >
            Server verlassen
          </button>
        )}
      </div>

      {feedback && (
        <p
          className={`mt-4 rounded-lg border px-3 py-2 text-sm ${
            feedback.ok
              ? 'border-emerald-900 bg-emerald-950/40 text-emerald-400'
              : 'border-red-900 bg-red-950/50 text-red-400'
          }`}
        >
          {feedback.text}
        </p>
      )}
    </Modal>
  );
}

function SettingsLink({
  icon,
  label,
  onClick,
}: {
  icon: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-left text-sm text-zinc-200 transition hover:border-zinc-500 hover:bg-zinc-800"
    >
      <span aria-hidden>{icon}</span>
      {label}
      <span className="ml-auto text-zinc-500">›</span>
    </button>
  );
}
