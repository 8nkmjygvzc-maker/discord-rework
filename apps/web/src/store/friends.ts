import { create } from 'zustand';
import type { FriendsList, PublicUser } from '@parley/shared';
import { useAuthStore } from './auth';

/**
 * Freundesliste (Phase 7). Jede Mutation stößt serverseitig ein
 * FRIENDS_UPDATE-Event an beide Beteiligten an – der Store lädt die Liste
 * daraufhin komplett neu (siehe lib/gatewayConnection.ts). Die Mutationen
 * laden hier NICHT selbst nach, damit REST-Antwort und Event nicht doppelt
 * rendern; das eigene Event kommt ohnehin sofort.
 */
interface FriendsState {
  list: FriendsList;
  loaded: boolean;

  loadFriends: () => Promise<void>;
  addFriend: (username: string) => Promise<void>;
  accept: (userId: string) => Promise<void>;
  remove: (userId: string) => Promise<void>;
  block: (userId: string) => Promise<void>;
  unblock: (userId: string) => Promise<void>;
  /** USER_UPDATE (Phase 15): Status/Avatar eines Nutzers in place aktualisieren. */
  applyUserUpdate: (user: PublicUser) => void;
  reset: () => void;
}

const EMPTY: FriendsList = { friends: [], incoming: [], outgoing: [], blocked: [] };

function authFetch<T>(
  path: string,
  options?: { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown },
): Promise<T> {
  return useAuthStore.getState().authFetch<T>(path, options);
}

export const useFriendsStore = create<FriendsState>()((set) => ({
  list: EMPTY,
  loaded: false,

  loadFriends: async () => {
    const list = await authFetch<FriendsList>('/api/friends');
    set({ list, loaded: true });
  },

  addFriend: async (username) => {
    await authFetch<void>('/api/friends', { method: 'POST', body: { username } });
  },

  accept: async (userId) => {
    await authFetch<void>(`/api/friends/${userId}/accept`, { method: 'POST' });
  },

  remove: async (userId) => {
    await authFetch<void>(`/api/friends/${userId}`, { method: 'DELETE' });
  },

  block: async (userId) => {
    await authFetch<void>(`/api/friends/${userId}/block`, { method: 'PUT' });
  },

  unblock: async (userId) => {
    await authFetch<void>(`/api/friends/${userId}/block`, { method: 'DELETE' });
  },

  applyUserUpdate: (user) =>
    set((s) => {
      const patch = (u: PublicUser): PublicUser => (u.id === user.id ? { ...u, ...user } : u);
      return {
        list: {
          friends: s.list.friends.map(patch),
          incoming: s.list.incoming.map((r) => ({ ...r, user: patch(r.user) })),
          outgoing: s.list.outgoing.map((r) => ({ ...r, user: patch(r.user) })),
          blocked: s.list.blocked.map(patch),
        },
      };
    }),

  reset: () => set({ list: EMPTY, loaded: false }),
}));
