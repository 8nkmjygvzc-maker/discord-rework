import type { ChannelInfo } from '@parley/shared';
import { useVoiceStore } from '../store/voice';
import { useDmsStore } from '../store/dms';
import Avatar from './Avatar';

/**
 * Eingehender privater Anruf (CALL_RING): ansichtsunabhängiges Overlay mit
 * Annehmen/Ablehnen – wie der NoticeHost in App gerendert. Das Klingeln
 * steuert der Voice-Store (startet mit CALL_RING, endet bei Annehmen/Ablehnen,
 * Auflegen der Gegenseite oder nach dem Verpasst-Timeout).
 */
export default function CallOverlay() {
  const call = useVoiceStore((s) => s.incomingCall);
  const joinVoice = useVoiceStore((s) => s.joinVoice);
  const declineCall = useVoiceStore((s) => s.declineCall);
  const selectDm = useDmsStore((s) => s.selectDm);

  if (!call) return null;

  function accept() {
    if (!call) return;
    // In die DM-Ansicht wechseln und dem Anruf beitreten (Roster + Medien).
    selectDm(call.channelId);
    const channel: ChannelInfo = {
      id: call.channelId,
      serverId: null,
      type: 'DM',
      name: call.caller.username,
      position: 0,
      isPrivate: false,
    };
    void joinVoice(channel);
  }

  return (
    <div className="fixed inset-x-0 top-6 z-50 flex justify-center px-4">
      <div
        className="animate-pop-in flex w-full max-w-sm items-center gap-3 rounded-xl border border-zinc-700 bg-zinc-900/95 p-4 shadow-2xl"
        data-testid="incoming-call"
        role="alertdialog"
        aria-label={`Eingehender Anruf von ${call.caller.username}`}
      >
        <Avatar
          name={call.caller.username}
          avatarUrl={call.caller.avatarUrl}
          sizeClass="h-12 w-12 text-lg"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-zinc-100">{call.caller.username}</p>
          <p className="text-sm text-zinc-400">📞 ruft dich an …</p>
        </div>
        <button
          type="button"
          title="Anruf annehmen"
          onClick={accept}
          className="rounded-full bg-emerald-600 p-3 text-white transition hover:bg-emerald-500"
          data-testid="call-accept"
        >
          📞
        </button>
        <button
          type="button"
          title="Anruf ablehnen"
          onClick={() => void declineCall()}
          className="rounded-full bg-red-600 p-3 text-white transition hover:bg-red-500"
          data-testid="call-decline"
        >
          ✖
        </button>
      </div>
    </div>
  );
}
