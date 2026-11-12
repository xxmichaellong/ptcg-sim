import { useSyncExternalStore } from 'react';

/**
 * A room to join that came from outside Play online: a friend's invite, a
 * friend let in, or Watch on a friend (ADR-055). The lobby takes it when
 * it is free (RemoteRoomLobby.tsx), as it takes a lesson's request, and
 * joins by the room's code as Play online's field would.
 */

export interface RoomJoinRequest {
  readonly code: string;
  readonly role: 'player' | 'spectator';
}

let request: RoomJoinRequest | undefined;
const listeners = new Set<() => void>();

const publish = (next: RoomJoinRequest | undefined): void => {
  request = next;
  for (const listener of listeners) listener();
};

export const requestRoomJoin = (next: RoomJoinRequest): void => publish(next);

/** The lobby took it. */
export const takeRoomJoinRequest = (taken: RoomJoinRequest): void => {
  if (request === taken) publish(undefined);
};

export const useRoomJoinRequest = (): RoomJoinRequest | undefined =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => request,
    () => request
  );
