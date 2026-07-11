import Modal from './Modal';
import { useNoticesStore } from '../store/notices';

/**
 * Zeigt globale Hinweis-Dialoge (Phase 15) – z. B. „Du wurdest gekickt/
 * gebannt“. Immer nur der älteste Hinweis; OK (oder Schließen) quittiert ihn,
 * dann kommt ggf. der nächste. Wird einmal in App gerendert, damit Hinweise
 * unabhängig von der aktuellen Ansicht (Haupt/Profil) erscheinen.
 */
export default function NoticeHost() {
  const notice = useNoticesStore((s) => s.notices[0] ?? null);
  const dismissNotice = useNoticesStore((s) => s.dismissNotice);
  if (!notice) return null;

  return (
    <Modal title={notice.title} onClose={() => dismissNotice(notice.id)}>
      <p className="text-sm whitespace-pre-line text-zinc-300">{notice.body}</p>
      <button
        type="button"
        autoFocus
        onClick={() => dismissNotice(notice.id)}
        className="mt-4 w-full rounded-lg bg-indigo-600 px-4 py-2 font-semibold text-white transition hover:bg-indigo-500"
      >
        OK
      </button>
    </Modal>
  );
}
