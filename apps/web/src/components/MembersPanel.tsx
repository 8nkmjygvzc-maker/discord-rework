import { useEffect, useMemo, useState } from 'react';
import {
  hasPermission,
  Permissions,
  permissionsFromString,
  ServerDetails,
  ServerMember,
} from '@parley/shared';
import { useServersStore } from '../store/servers';
import { usePresenceStore } from '../store/presence';
import { useAuthStore } from '../store/auth';
import { useVoiceStore } from '../store/voice';
import { ApiError } from '../lib/api';
import { memberRoleColor } from '../lib/roleColors';
import Avatar from './Avatar';
import ModerationDialog from './ModerationDialog';

/** Auswahl-Dauern für die Auszeit (Timeout), 60 s … 1 Woche. */
const TIMEOUT_OPTIONS = [
  { label: '60 Sek.', s: 60 },
  { label: '5 Min.', s: 5 * 60 },
  { label: '10 Min.', s: 10 * 60 },
  { label: '1 Std.', s: 60 * 60 },
  { label: '1 Tag', s: 24 * 60 * 60 },
  { label: '1 Woche', s: 7 * 24 * 60 * 60 },
];

/** Höchste Rollen-Position eines Mitglieds; Owner steht über allem. */
function rankOf(server: ServerDetails, userId: string): number {
  if (server.ownerId === userId) return Number.POSITIVE_INFINITY;
  const member = server.members.find((m) => m.userId === userId);
  if (!member) return Number.NEGATIVE_INFINITY;
  let rank = 0;
  for (const roleId of member.roleIds) {
    const role = server.roles.find((r) => r.id === roleId);
    if (role && role.position > rank) rank = role.position;
  }
  return rank;
}

/** Rechte Spalte: Mitglieder mit Online-Status und (Phase 13) Moderations-Menü. */
export default function MembersPanel() {
  const server = useServersStore((s) => s.selectedServer);
  const onlineUsers = usePresenceStore((s) => s.onlineUsers);
  const me = useAuthStore((s) => s.user);
  const voiceStates = useVoiceStore((s) => s.voiceStates);
  const kickMember = useServersStore((s) => s.kickMember);
  const banMember = useServersStore((s) => s.banMember);
  const timeoutMember = useServersStore((s) => s.timeoutMember);
  const removeMemberTimeout = useServersStore((s) => s.removeMemberTimeout);
  const voiceDisconnectMember = useServersStore((s) => s.voiceDisconnectMember);

  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modOpen, setModOpen] = useState(false);

  // ⏳ läuft live ab (Phase 15): beim frühesten Auszeit-Ende neu rendern,
  // statt bis zum nächsten ServerDetails-Reload zu warten. `tick` sorgt dafür,
  // dass nach einem Ablauf der jeweils nächste Termin neu berechnet wird.
  const [timeoutTick, setTimeoutTick] = useState(0);
  const serverMembers = server?.members;
  const nextTimeoutExpiry = useMemo(() => {
    let next = Number.POSITIVE_INFINITY;
    const now = Date.now();
    for (const member of serverMembers ?? []) {
      if (!member.timeoutUntil) continue;
      const at = new Date(member.timeoutUntil).getTime();
      if (at > now && at < next) next = at;
    }
    return next;
    // timeoutTick erzwingt die Neuberechnung nach jedem abgelaufenen Termin.
  }, [serverMembers, timeoutTick]);
  useEffect(() => {
    if (!Number.isFinite(nextTimeoutExpiry)) return;
    const delay = Math.min(Math.max(nextTimeoutExpiry - Date.now(), 0) + 500, 2 ** 31 - 1);
    const timer = window.setTimeout(() => setTimeoutTick((n) => n + 1), delay);
    return () => window.clearTimeout(timer);
  }, [nextTimeoutExpiry]);

  if (!server) return null;
  const onlineIds = new Set(onlineUsers.map((u) => u.id));
  const inVoiceIds = new Set(voiceStates.map((v) => v.userId));

  const myPerms = permissionsFromString(server.myPermissions);
  const canKick = hasPermission(myPerms, Permissions.KickMembers);
  const canBan = hasPermission(myPerms, Permissions.BanMembers);
  const canMod = hasPermission(myPerms, Permissions.ModerateMembers);
  const canOpenModDialog = canBan || hasPermission(myPerms, Permissions.ViewAuditLog);
  const myRank = me ? rankOf(server, me.id) : Number.NEGATIVE_INFINITY;

  // Online-Mitglieder zuerst, innerhalb der Gruppen alphabetisch.
  const members = [...server.members].sort((a, b) => {
    const aOnline = onlineIds.has(a.userId) ? 0 : 1;
    const bOnline = onlineIds.has(b.userId) ? 0 : 1;
    return aOnline - bOnline || a.username.localeCompare(b.username);
  });

  async function run(fn: () => Promise<void>) {
    setError(null);
    try {
      await fn();
      setOpenMenu(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Aktion fehlgeschlagen');
    }
  }

  return (
    <aside className="w-60 shrink-0 overflow-y-auto bg-zinc-900 px-3 py-4">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
          Mitglieder – {server.members.length}
        </h2>
        {canOpenModDialog && (
          <button
            type="button"
            title="Moderation (Bannliste & Audit-Log)"
            data-testid="open-moderation"
            onClick={() => setModOpen(true)}
            className="rounded px-1 text-sm text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
          >
            🛡️
          </button>
        )}
      </div>

      {error && (
        <p className="mt-2 rounded-lg border border-red-900 bg-red-950/50 px-2 py-1.5 text-xs text-red-400">
          {error}
        </p>
      )}

      <ul className="mt-2 space-y-0.5" data-testid="member-list">
        {members.map((member) => {
          const online = onlineIds.has(member.userId);
          const isOwnerMember = member.userId === server.ownerId;
          const isSelf = member.userId === me?.id;
          const timedOut =
            !!member.timeoutUntil && new Date(member.timeoutUntil).getTime() > Date.now();
          const canModerateTarget =
            !isSelf && !isOwnerMember && myRank > rankOf(server, member.userId);
          const showMenu = canModerateTarget && (canKick || canBan || canMod);
          const nameColor = memberRoleColor(server.roles, member.roleIds);

          return (
            <li key={member.userId} className={online ? '' : 'opacity-50'}>
              <div className="flex items-center gap-2 rounded px-1 py-1.5">
                <div className="relative shrink-0">
                  <Avatar
                    name={member.username}
                    avatarUrl={member.avatarUrl}
                    sizeClass="h-8 w-8 text-sm"
                  />
                  <span
                    className={`absolute -right-0.5 -bottom-0.5 h-3 w-3 rounded-full border-2 border-zinc-900 ${
                      online ? 'bg-emerald-500' : 'bg-zinc-600'
                    }`}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span
                      className="truncate text-sm text-zinc-300"
                      style={nameColor ? { color: nameColor } : undefined}
                    >
                      {member.nickname ?? member.username}
                    </span>
                    {timedOut && (
                      <span
                        title={`In Auszeit bis ${new Date(member.timeoutUntil!).toLocaleString('de-DE')}`}
                        className="text-xs"
                      >
                        ⏳
                      </span>
                    )}
                    {member.roleIds.length > 0 && (
                      <span className="flex min-w-0 gap-1">
                        {member.roleIds.map((roleId) => {
                          const role = server.roles.find((r) => r.id === roleId);
                          return role ? (
                            <span
                              key={roleId}
                              className="truncate rounded bg-zinc-800 px-1 text-[10px] text-zinc-400"
                              style={role.color ? { color: role.color } : undefined}
                            >
                              {role.name}
                            </span>
                          ) : null;
                        })}
                      </span>
                    )}
                  </div>
                  {/* Status-Text (Phase 15) – jetzt für ALLE sichtbar, nicht nur für einen selbst. */}
                  {member.status && (
                    <p className="truncate text-xs text-zinc-500" title={member.status}>
                      {member.status}
                    </p>
                  )}
                </div>
                <span className="ml-auto flex items-center gap-1">
                  {isOwnerMember && (
                    <span title="Server-Eigentümer" className="text-xs">
                      👑
                    </span>
                  )}
                  {showMenu && (
                    <button
                      type="button"
                      title="Moderieren"
                      data-testid="member-menu-toggle"
                      onClick={() =>
                        setOpenMenu((cur) => (cur === member.userId ? null : member.userId))
                      }
                      className="rounded px-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                    >
                      ⋯
                    </button>
                  )}
                </span>
              </div>

              {openMenu === member.userId && (
                <MemberModMenu
                  member={member}
                  timedOut={timedOut}
                  inVoice={inVoiceIds.has(member.userId)}
                  canKick={canKick}
                  canBan={canBan}
                  canMod={canMod}
                  run={run}
                  actions={{
                    kickMember,
                    banMember,
                    timeoutMember,
                    removeMemberTimeout,
                    voiceDisconnectMember,
                  }}
                />
              )}
            </li>
          );
        })}
      </ul>

      {modOpen && <ModerationDialog onClose={() => setModOpen(false)} />}
    </aside>
  );
}

interface ModActions {
  kickMember: (userId: string, reason?: string) => Promise<void>;
  banMember: (userId: string, reason?: string) => Promise<void>;
  timeoutMember: (userId: string, durationSeconds: number, reason?: string) => Promise<void>;
  removeMemberTimeout: (userId: string) => Promise<void>;
  voiceDisconnectMember: (userId: string) => Promise<void>;
}

/** Aufklappmenü mit den für dieses Ziel verfügbaren Moderationsaktionen. */
function MemberModMenu({
  member,
  timedOut,
  inVoice,
  canKick,
  canBan,
  canMod,
  run,
  actions,
}: {
  member: ServerMember;
  timedOut: boolean;
  inVoice: boolean;
  canKick: boolean;
  canBan: boolean;
  canMod: boolean;
  run: (fn: () => Promise<void>) => Promise<void>;
  actions: ModActions;
}) {
  const [showDurations, setShowDurations] = useState(false);
  const name = member.nickname ?? member.username;

  return (
    <div
      className="mt-1 mb-1 ml-10 space-y-0.5 rounded-lg border border-zinc-700 bg-zinc-950/60 p-1 text-xs"
      data-testid="mod-menu"
    >
      {canMod && !timedOut && !showDurations && (
        <MenuItem onClick={() => setShowDurations(true)}>⏳ Auszeit …</MenuItem>
      )}
      {canMod && !timedOut && showDurations && (
        <div className="flex flex-wrap gap-1 p-1">
          {TIMEOUT_OPTIONS.map((o) => (
            <button
              key={o.s}
              type="button"
              onClick={() => void run(() => actions.timeoutMember(member.userId, o.s))}
              className="rounded border border-zinc-600 px-1.5 py-0.5 text-zinc-300 hover:bg-zinc-700"
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
      {canMod && timedOut && (
        <MenuItem onClick={() => void run(() => actions.removeMemberTimeout(member.userId))}>
          ▶️ Auszeit aufheben
        </MenuItem>
      )}
      {canMod && inVoice && (
        <MenuItem onClick={() => void run(() => actions.voiceDisconnectMember(member.userId))}>
          🔌 Aus Voice trennen
        </MenuItem>
      )}
      {canKick && (
        <MenuItem
          danger
          onClick={() => {
            if (!window.confirm(`${name} kicken?`)) return;
            const reason = window.prompt('Grund (optional):') ?? '';
            void run(() => actions.kickMember(member.userId, reason || undefined));
          }}
        >
          👢 Kicken
        </MenuItem>
      )}
      {canBan && (
        <MenuItem
          danger
          onClick={() => {
            if (!window.confirm(`${name} bannen? Rückkehr nur über „Entbannen“.`)) return;
            const reason = window.prompt('Grund (optional):') ?? '';
            void run(() => actions.banMember(member.userId, reason || undefined));
          }}
        >
          🔨 Bannen
        </MenuItem>
      )}
    </div>
  );
}

function MenuItem({
  onClick,
  danger,
  children,
}: {
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`block w-full rounded px-2 py-1 text-left ${
        danger ? 'text-red-400 hover:bg-red-950/50' : 'text-zinc-300 hover:bg-zinc-700'
      }`}
    >
      {children}
    </button>
  );
}
