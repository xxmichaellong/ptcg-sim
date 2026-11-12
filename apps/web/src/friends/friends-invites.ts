import { t } from '@lingui/core/macro';

import { AccountRequestError } from '../account/account-api.js';
import { refreshAccount } from '../account/account-state.js';
import { requestRoomJoin } from '../session/room-join-request.js';
import { confirmAction } from '../ui/dialog-requests.js';
import { toast, toastManager } from '../ui/toast.js';
import {
  postInvite,
  readInviteMessage,
  type FriendProfile,
  type InviteKind,
  type InviteMessage,
} from './friends-api.js';
import { currentWhere, onLiveMessage } from './friends-live.js';
import { presenceOf, subscribePresence } from './friends-presence.js';

/**
 * Playing together (ADR-055 step 3): Invite a friend to this room, Ask to
 * join a friend's, and Watch a friend's game. Invites travel on the live
 * line to the friend's open tabs as a notice with Join; nothing is stored,
 * and an invite lapses after 30 minutes or once its sender leaves that
 * room. Let in answers an ask with an invite the asker joins at once.
 */

const ASK_ANSWERED_WITHIN_MS = 5 * 60 * 1000;

/** Friends this tab asked to join, and when. */
const asked = new Map<string, number>();

/** The invites showing, by sender: their room, to drop when they leave. */
const showing = new Map<
  string,
  { readonly room: string; readonly id: string }
>();

const inviteNoticeId = (from: string) => `friend-invite-${from}`;

/**
 * Goes to a room: after asking, when this tab is in an online room it
 * would leave.
 */
export const goToRoom = async (
  room: string,
  role: 'player' | 'spectator',
  name: string
): Promise<void> => {
  const where = currentWhere();
  if (where.kind === 'room' && where.room === room) return;
  if (where.kind === 'room') {
    const leave = await confirmAction({
      title:
        role === 'player'
          ? t`Leave this room to join ${name}?`
          : t`Leave this room to watch ${name}?`,
      confirmLabel: t`Leave room`,
      cancelLabel: t({ message: 'Stay', context: 'stay in the room' }),
    });
    if (!leave) return;
  }
  requestRoomJoin({ code: room, role });
};

const sentNotice = (
  kind: InviteKind,
  outcome: string,
  name: string
): { readonly title: string; readonly tone: 'success' | 'warning' } => {
  switch (outcome) {
    case 'sent':
      return kind === 'ask'
        ? { title: t`Asked ${name} to let you in`, tone: 'success' }
        : { title: t`Invite sent to ${name}`, tone: 'success' };
    case 'offline':
      return { title: t`${name} isn't online`, tone: 'warning' };
    case 'not_in_room':
      return { title: t`Open a room to invite friends`, tone: 'warning' };
    case 'not_friends':
      return { title: t`You're not friends with ${name}`, tone: 'warning' };
    default:
      return { title: t`Couldn't do that. Try again.`, tone: 'warning' };
  }
};

/** Invites a friend to this room, or asks to join theirs. */
export const inviteFriend = async (
  friend: Pick<FriendProfile, 'id' | 'name'>,
  kind: InviteKind,
  answering = false
): Promise<void> => {
  try {
    let outcome = await postInvite(friend.id, kind, answering);
    if (outcome === 'slow_down') {
      await new Promise((resolve) => setTimeout(resolve, 1100));
      outcome = await postInvite(friend.id, kind, answering);
    }
    if (kind === 'ask' && outcome === 'sent') asked.set(friend.id, Date.now());
    // Letting in says nothing more: the asker joins.
    if (!answering || outcome !== 'sent') {
      toast({
        id: 'friend-invite-sent',
        ...sentNotice(kind, outcome, friend.name),
      });
    }
  } catch (error) {
    if (error instanceof AccountRequestError && error.status === 401) {
      void refreshAccount();
      return;
    }
    toast({
      id: 'friend-invite-sent',
      title: t`Couldn't do that. Try again.`,
      tone: 'danger',
    });
  }
};

const received = (message: InviteMessage): void => {
  const { from } = message;
  if (Date.now() > message.expiresAt) return;
  if (message.kind === 'ask') {
    toast({
      id: `friend-ask-${from.id}`,
      title: t`${from.name} wants to join you`,
      timeout: 60_000,
      action: {
        label: t({ message: 'Let in', context: 'let a friend into the room' }),
        onAction: () => void inviteFriend(from, 'invite', true),
      },
    });
    return;
  }
  const room = message.room;
  if (!room) return;
  // Asked a moment ago, and let in: straight there.
  const askedAt = asked.get(from.id);
  if (
    message.answering &&
    askedAt &&
    Date.now() - askedAt < ASK_ANSWERED_WITHIN_MS
  ) {
    asked.delete(from.id);
    toast({
      id: inviteNoticeId(from.id),
      title: t`${from.name} let you in`,
      tone: 'success',
    });
    void goToRoom(room, 'player', from.name);
    return;
  }
  const id = inviteNoticeId(from.id);
  showing.set(from.id, { room, id });
  toast({
    id,
    title: t`${from.name} invited you to play`,
    timeout: Math.max(1000, message.expiresAt - Date.now()),
    action: {
      label: t({ message: 'Join', context: 'join a friend’s room' }),
      onAction: () => {
        showing.delete(from.id);
        void goToRoom(room, 'player', from.name);
      },
    },
  });
};

let started = false;

/** Hears invites and asks on the live line; the app calls it once. */
export const startFriendInvites = (): void => {
  if (started) return;
  started = true;
  onLiveMessage((data) => {
    const message = readInviteMessage(data);
    if (message) received(message);
  });
  // An invite lapses once its sender leaves that room.
  subscribePresence(() => {
    for (const [from, invite] of showing) {
      const presence = presenceOf(from);
      // Offline may be Appear offline: only a room seen to change ends it.
      if (
        presence &&
        presence.state !== 'offline' &&
        presence.room !== invite.room
      ) {
        toastManager.close(invite.id);
        showing.delete(from);
      }
    }
  });
};
