import {
  presentationEventsForLevel,
  type ServerMessage,
} from '@ptcgsim/protocol';

/**
 * A frame as a client at `level` can read it: presentation events its schema
 * would refuse (and so end its session over) are left out.
 */
export const readableBy = (message: ServerMessage, level: number): ServerMessage => {
  if (
    (message.type !== 'StatePublication' && message.type !== 'ReplayFrame') ||
    !message.presentationEvents
  ) {
    return message;
  }
  const events = presentationEventsForLevel(message.presentationEvents, level);
  if (events === message.presentationEvents) return message;
  const { presentationEvents: _all, ...rest } = message;
  return events.length > 0
    ? { ...rest, presentationEvents: [...events] }
    : rest;
};
