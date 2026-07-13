import { create } from 'zustand';

/** Daten für die Profilkarte – aus Mitgliederliste/Freunden/DMs zusammengebaut. */
export interface ProfileCardUser {
  id: string;
  username: string;
  /** Server-Nickname, falls im Server-Kontext geöffnet. */
  nickname?: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  status: string;
}

/**
 * UI-Zustand fürs responsive Layout (Verbesserungs-Runde, Handy-Optimierung):
 * Unter dem md-Breakpoint sind Kanal-/DM-Sidebar und Mitglieder-Panel als
 * ein-/ausblendbare Drawer umgesetzt. Auf dem Desktop haben die Flags keine
 * Wirkung (die Drawer-Klassen greifen nur via max-md:).
 *
 * Außerdem: die global geöffnete Profilkarte (Klick auf Avatar/Name).
 */
interface UiState {
  /** Linker Drawer (Server-Leiste + Kanal-/DM-Sidebar) offen? */
  navOpen: boolean;
  /** Rechter Drawer (Mitglieder-Panel) offen? */
  membersOpen: boolean;
  /** Aktuell angezeigte Profilkarte (null = keine). */
  profileUser: ProfileCardUser | null;

  toggleNav: () => void;
  toggleMembers: () => void;
  closeNav: () => void;
  closeMembers: () => void;
  openProfile: (user: ProfileCardUser) => void;
  closeProfile: () => void;
}

export const useUiStore = create<UiState>()((set) => ({
  navOpen: false,
  membersOpen: false,
  profileUser: null,

  toggleNav: () => set((s) => ({ navOpen: !s.navOpen, membersOpen: false })),
  toggleMembers: () => set((s) => ({ membersOpen: !s.membersOpen, navOpen: false })),
  closeNav: () => set({ navOpen: false }),
  closeMembers: () => set({ membersOpen: false }),
  openProfile: (user) => set({ profileUser: user }),
  closeProfile: () => set({ profileUser: null }),
}));
