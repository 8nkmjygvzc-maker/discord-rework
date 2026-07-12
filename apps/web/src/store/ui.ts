import { create } from 'zustand';

/**
 * UI-Zustand fürs responsive Layout (Verbesserungs-Runde, Handy-Optimierung):
 * Unter dem md-Breakpoint sind Kanal-/DM-Sidebar und Mitglieder-Panel als
 * ein-/ausblendbare Drawer umgesetzt. Auf dem Desktop haben die Flags keine
 * Wirkung (die Drawer-Klassen greifen nur via max-md:).
 */
interface UiState {
  /** Linker Drawer (Server-Leiste + Kanal-/DM-Sidebar) offen? */
  navOpen: boolean;
  /** Rechter Drawer (Mitglieder-Panel) offen? */
  membersOpen: boolean;

  toggleNav: () => void;
  toggleMembers: () => void;
  closeNav: () => void;
  closeMembers: () => void;
}

export const useUiStore = create<UiState>()((set) => ({
  navOpen: false,
  membersOpen: false,

  toggleNav: () => set((s) => ({ navOpen: !s.navOpen, membersOpen: false })),
  toggleMembers: () => set((s) => ({ membersOpen: !s.membersOpen, navOpen: false })),
  closeNav: () => set({ navOpen: false }),
  closeMembers: () => set({ membersOpen: false }),
}));
