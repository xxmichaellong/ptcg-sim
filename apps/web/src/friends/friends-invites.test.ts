import { beforeEach, expect, it, vi } from 'vitest';

const model = vi.hoisted(() => ({
  account: 'a_AAAAAAAAAAAAAAAA' as string | undefined,
  where: { kind: 'none' } as
    { kind: 'none' } | { kind: 'room'; role: 'player'; room: string },
  message: undefined as ((message: unknown) => void) | undefined,
  accountChanged: undefined as (() => void) | undefined,
  whereChanged: undefined as (() => void) | undefined,
  notices: new Map<string, { action?: { onAction: () => void } }>(),
  join: vi.fn(),
  post: vi.fn(async () => 'sent'),
}));
vi.mock('../account/account-state.js', () => ({
  accountSnapshot: () => ({
    account: model.account ? { id: model.account } : null,
  }),
  subscribeAccount: (listener: () => void) => {
    model.accountChanged = listener;
  },
  refreshAccount: vi.fn(),
}));
vi.mock('./friends-live.js', () => ({
  currentWhere: () => model.where,
  onLiveMessage: (listener: (value: unknown) => void) => {
    model.message = listener;
  },
  subscribeWhere: (listener: () => void) => {
    model.whereChanged = listener;
  },
}));
vi.mock('./friends-presence.js', () => ({
  subscribePresence: vi.fn(),
  presenceOf: vi.fn(),
}));
vi.mock('./friends-api.js', async (original) => ({
  ...(await original<typeof import('./friends-api.js')>()),
  postInvite: model.post,
}));
vi.mock('../session/room-join-request.js', () => ({
  requestRoomJoin: model.join,
}));
vi.mock('../ui/dialog-requests.js', () => ({
  confirmAction: vi.fn(async () => true),
}));
vi.mock('../ui/toast.js', () => ({
  toast: (notice: { id: string; action?: { onAction: () => void } }) => {
    model.notices.set(notice.id, notice);
  },
  toastManager: { close: (id: string) => model.notices.delete(id) },
}));
const friend = { id: 'a_BBBBBBBBBBBBBBBB', name: 'Friend', avatar: 'initials' };
const message = (kind: 'ask' | 'invite', answering = false) => ({
  type: kind,
  from: friend,
  room: 'K7PQ',
  answering,
  sentAt: Date.now(),
  expiresAt: Date.now() + 60000,
});
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  model.account = 'a_AAAAAAAAAAAAAAAA';
  model.where = { kind: 'none' };
  model.notices.clear();
});
it('joins an answered ask only while still in the place that asked', async () => {
  const { startFriendInvites, inviteFriend } =
    await import('./friends-invites.js');
  startFriendInvites();
  await inviteFriend(friend, 'ask');
  model.where = { kind: 'room', role: 'player', room: 'ABCD' };
  model.whereChanged?.();
  model.message?.(message('invite', true));
  expect(model.join).not.toHaveBeenCalled();
  expect(model.notices.get(`friend-invite-${friend.id}`)?.action).toBeDefined();
});
it('ends a Let in action when its host leaves the room', async () => {
  const { startFriendInvites } = await import('./friends-invites.js');
  model.where = { kind: 'room', role: 'player', room: 'ABCD' };
  startFriendInvites();
  model.message?.(message('ask'));
  const action = model.notices.get(`friend-ask-${friend.id}`)?.action;
  expect(action).toBeDefined();
  model.where = { kind: 'room', role: 'player', room: 'K7PQ' };
  model.whereChanged?.();
  action?.onAction();
  expect(model.post).not.toHaveBeenCalled();
});
it('clears pending invites and automatic joins when the account changes', async () => {
  const { startFriendInvites, inviteFriend } =
    await import('./friends-invites.js');
  startFriendInvites();
  await inviteFriend(friend, 'ask');
  model.message?.(message('invite'));
  expect(model.notices.has(`friend-invite-${friend.id}`)).toBe(true);
  model.account = 'a_CCCCCCCCCCCCCCCC';
  model.accountChanged?.();
  expect(model.notices.has(`friend-invite-${friend.id}`)).toBe(false);
  model.message?.(message('invite', true));
  expect(model.join).not.toHaveBeenCalled();
});
it('still joins an answer to a current ask', async () => {
  const { startFriendInvites, inviteFriend } =
    await import('./friends-invites.js');
  startFriendInvites();
  await inviteFriend(friend, 'ask');
  model.message?.(message('invite', true));
  expect(model.join).toHaveBeenCalledWith({ code: 'K7PQ', role: 'player' });
});
