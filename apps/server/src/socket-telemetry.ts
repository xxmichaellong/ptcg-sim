/** The terminal callback socket can remain in getWebSockets until return. */
export const activeSocketCountExcluding = <Socket>(
  acceptedSockets: readonly Socket[],
  terminalSocket: Socket
): number =>
  acceptedSockets.filter((candidate) => candidate !== terminalSocket).length;
