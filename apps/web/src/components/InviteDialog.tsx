import { useEffect, useState } from 'react';
import type { CreateInviteRequest, InviteInfo } from '@parley/shared';
import { useAuthStore } from '../store/auth';
import Modal from './Modal';

/**
 * Einladungen verwalten (Phase 12): neuen Link erstellen (optional mit Ablauf
 * und Nutzungslimit) und bestehende auflisten/widerrufen. Sichtbar nur mit dem
 * CreateInvite-Recht (der Aufrufer im Sidebar prüft das).
 */
export default function InviteDialog({
  serverId,
  onClose,
}: {
  serverId: string;
  onClose: () => void;
}) {
  const [invites, setInvites] = useState<InviteInfo[] | null>(null);
  const [expiry, setExpiry] = useState<string>('604800'); // 7 Tage
  const [maxUses, setMaxUses] = useState<string>('0'); // 0 = unbegrenzt
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const authFetch = useAuthStore.getState().authFetch;

  useEffect(() => {
    void authFetch<InviteInfo[]>(`/api/servers/${serverId}/invites`)
      .then(setInvites)
      .catch(() => setInvites([]));
  }, [serverId, authFetch]);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const body: CreateInviteRequest = {
        expiresInSeconds: expiry === '0' ? null : Number(expiry),
        maxUses: maxUses === '0' ? null : Number(maxUses),
      };
      const invite = await authFetch<InviteInfo>(`/api/servers/${serverId}/invites`, {
        method: 'POST',
        body,
      });
      setInvites((prev) => [invite, ...(prev ?? [])]);
    } catch {
      setError('Einladung konnte nicht erstellt werden');
    } finally {
      setBusy(false);
    }
  }

  async function revoke(code: string) {
    setInvites((prev) => (prev ?? []).filter((i) => i.code !== code));
    await authFetch<void>(`/api/invites/${code}`, { method: 'DELETE' }).catch(() => undefined);
  }

  return (
    <Modal title="Zum Server einladen" onClose={onClose}>
      <div className="space-y-3">
        <div className="flex gap-2">
          <label className="flex-1 text-xs text-zinc-400">
            Ablauf
            <select
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-600 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 focus:border-indigo-500 focus:outline-none"
            >
              <option value="0">Nie</option>
              <option value="1800">30 Minuten</option>
              <option value="86400">1 Tag</option>
              <option value="604800">7 Tage</option>
            </select>
          </label>
          <label className="flex-1 text-xs text-zinc-400">
            Max. Nutzungen
            <select
              value={maxUses}
              onChange={(e) => setMaxUses(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-600 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 focus:border-indigo-500 focus:outline-none"
            >
              <option value="0">Unbegrenzt</option>
              <option value="1">1</option>
              <option value="5">5</option>
              <option value="10">10</option>
              <option value="25">25</option>
              <option value="100">100</option>
            </select>
          </label>
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={() => void create()}
          className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50"
        >
          {busy ? 'Erstelle …' : 'Einladungslink erstellen'}
        </button>
        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="max-h-56 space-y-2 overflow-y-auto">
          {invites === null && <p className="text-sm text-zinc-500">Lade …</p>}
          {invites?.length === 0 && (
            <p className="text-sm text-zinc-500">Noch keine aktiven Einladungen.</p>
          )}
          {invites?.map((invite) => (
            <InviteRow
              key={invite.code}
              invite={invite}
              onRevoke={() => void revoke(invite.code)}
            />
          ))}
        </div>
      </div>
    </Modal>
  );
}

function InviteRow({ invite, onRevoke }: { invite: InviteInfo; onRevoke: () => void }) {
  const [copied, setCopied] = useState(false);
  const link = `${window.location.origin}/invite/${invite.code}`;

  function copy() {
    void navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const usesLabel =
    invite.maxUses === null ? `${invite.uses}×` : `${invite.uses}/${invite.maxUses}`;
  const expiryLabel = invite.expiresAt
    ? `bis ${new Date(invite.expiresAt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}`
    : 'kein Ablauf';

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-2">
      <div className="flex items-center gap-2">
        <code className="flex-1 truncate rounded bg-zinc-800 px-2 py-1 font-mono text-xs text-indigo-300">
          {invite.code}
        </code>
        <button
          type="button"
          onClick={copy}
          className="rounded bg-zinc-700 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-600"
        >
          {copied ? 'Kopiert' : 'Link'}
        </button>
        <button
          type="button"
          onClick={onRevoke}
          title="Einladung widerrufen"
          className="rounded px-1.5 py-1 text-xs text-zinc-500 hover:bg-red-950 hover:text-red-400"
        >
          ✕
        </button>
      </div>
      <p className="mt-1 text-[11px] text-zinc-500">
        {usesLabel} · {expiryLabel} · von {invite.createdBy}
      </p>
    </div>
  );
}
