import { useMemo, useState } from 'react';
import {
  hasPermission,
  PERMISSION_LIST,
  Permissions,
  permissionsFromString,
  permissionsToString,
} from '@parley/shared';
import { useServersStore } from '../store/servers';
import Modal from './Modal';
import { ApiError } from '../lib/api';

/** Rollenverwaltung: Rollen anlegen/bearbeiten/löschen, Mitgliedern zuweisen. */
export default function RolesDialog({ onClose }: { onClose: () => void }) {
  const server = useServersStore((s) => s.selectedServer);
  const createRole = useServersStore((s) => s.createRole);
  const updateRole = useServersStore((s) => s.updateRole);
  const deleteRole = useServersStore((s) => s.deleteRole);
  const setMemberRole = useServersStore((s) => s.setMemberRole);

  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [newRoleName, setNewRoleName] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);

  const role = useMemo(
    () => server?.roles.find((r) => r.id === selectedRoleId) ?? server?.roles[0] ?? null,
    [server, selectedRoleId],
  );

  if (!server || !role) return null;
  const perms = permissionsFromString(role.permissions);

  async function run(action: () => Promise<void>) {
    setFeedback(null);
    try {
      await action();
    } catch (err) {
      setFeedback(err instanceof ApiError ? err.message : 'Aktion fehlgeschlagen');
    }
  }

  return (
    <Modal title="Rollen verwalten" onClose={onClose}>
      <div className="flex gap-4">
        {/* Rollenliste */}
        <div className="w-40 shrink-0">
          <ul className="space-y-1">
            {server.roles.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setSelectedRoleId(r.id)}
                  className={`w-full truncate rounded px-2 py-1.5 text-left text-sm ${
                    r.id === role.id
                      ? 'bg-indigo-600/30 text-indigo-300'
                      : 'text-zinc-300 hover:bg-zinc-700'
                  }`}
                >
                  {r.name}
                  {r.isDefault && <span className="ml-1 text-xs text-zinc-500">(Standard)</span>}
                </button>
              </li>
            ))}
          </ul>
          <form
            className="mt-3 flex gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              const name = newRoleName.trim();
              if (name.length < 2) return;
              void run(async () => {
                await createRole(name);
                setNewRoleName('');
              });
            }}
          >
            <input
              className="min-w-0 flex-1 rounded border border-zinc-600 bg-zinc-900 px-2 py-1 text-sm text-zinc-100 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
              value={newRoleName}
              onChange={(e) => setNewRoleName(e.target.value)}
              placeholder="Neue Rolle"
            />
            <button
              type="submit"
              className="rounded bg-zinc-700 px-2 text-sm text-zinc-200 hover:bg-zinc-600"
            >
              +
            </button>
          </form>
        </div>

        {/* Rechte + Zuweisung */}
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-zinc-200">
            Rechte von „{role.name}“
            {role.isDefault && (
              <span className="ml-1 font-normal text-zinc-500">– gilt für alle Mitglieder</span>
            )}
          </h3>
          <ul className="mt-2 space-y-1">
            {PERMISSION_LIST.map(({ name, label }) => {
              const bit = Permissions[name];
              const checked = (perms & bit) === bit;
              return (
                <li key={name}>
                  <label className="flex items-center gap-2 text-sm text-zinc-300">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        void run(() =>
                          updateRole(role.id, {
                            permissions: permissionsToString(checked ? perms & ~bit : perms | bit),
                          }),
                        )
                      }
                    />
                    {label}
                  </label>
                </li>
              );
            })}
          </ul>

          {!role.isDefault && (
            <>
              <h3 className="mt-4 text-sm font-semibold text-zinc-200">Mitglieder mit dieser Rolle</h3>
              <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto">
                {server.members.map((member) => {
                  const assigned = member.roleIds.includes(role.id);
                  const isOwner = member.userId === server.ownerId;
                  return (
                    <li key={member.userId}>
                      <label
                        className={`flex items-center gap-2 text-sm ${
                          isOwner ? 'text-zinc-500' : 'text-zinc-300'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={assigned}
                          disabled={isOwner}
                          onChange={() =>
                            void run(() => setMemberRole(member.userId, role.id, !assigned))
                          }
                        />
                        {member.username}
                        {isOwner && ' (Owner hat immer alle Rechte)'}
                      </label>
                    </li>
                  );
                })}
              </ul>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`Rolle „${role.name}“ löschen?`)) {
                    void run(async () => {
                      await deleteRole(role.id);
                      setSelectedRoleId(null);
                    });
                  }
                }}
                className="mt-4 rounded border border-red-900 px-3 py-1.5 text-sm text-red-400 hover:bg-red-950/50"
              >
                Rolle löschen
              </button>
            </>
          )}
        </div>
      </div>

      {feedback && (
        <p className="mt-4 rounded-lg border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-400">
          {feedback}
        </p>
      )}
      {/* Anzeige der eigenen Rechte hilft beim Verifizieren der Durchsetzung */}
      {hasPermission(permissionsFromString(server.myPermissions), Permissions.Administrator) && (
        <p className="mt-3 text-xs text-zinc-500">
          Du bist Owner/Administrator – deine eigenen Rechte sind von Rollen unabhängig.
        </p>
      )}
    </Modal>
  );
}
