import { socket, systemState } from '../../front-end.js';

export const resyncActions = () => {
  const data = {
    roomId: systemState.roomId,
    actionData: systemState.selfActionData,
  };
  socket.emit('catchUpActions', data);
};
