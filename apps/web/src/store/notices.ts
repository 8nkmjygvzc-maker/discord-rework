import { create } from 'zustand';

/**
 * Globale Hinweis-Dialoge (Phase 15): kurze, quittierbare Meldungen an den
 * Nutzer, die nicht an eine bestimmte Ansicht gebunden sind – aktuell die
 * „Du wurdest gekickt/gebannt“-Rückmeldung (SERVER_SELF_REMOVED). Die Queue
 * zeigt immer den ältesten Hinweis zuerst; OK entfernt ihn.
 */
export interface Notice {
  id: string;
  title: string;
  body: string;
}

interface NoticesState {
  notices: Notice[];
  pushNotice: (title: string, body: string) => void;
  dismissNotice: (id: string) => void;
  reset: () => void;
}

let counter = 0;

export const useNoticesStore = create<NoticesState>()((set) => ({
  notices: [],

  pushNotice: (title, body) =>
    set((s) => ({ notices: [...s.notices, { id: `notice-${++counter}`, title, body }] })),

  dismissNotice: (id) => set((s) => ({ notices: s.notices.filter((n) => n.id !== id) })),

  reset: () => set({ notices: [] }),
}));
