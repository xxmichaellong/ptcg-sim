export interface SessionSocketCloseEvent {
  readonly code: number;
  readonly reason: string;
  readonly wasClean: boolean;
}

export interface SessionSocketHandlers {
  readonly open: () => void;
  readonly message: (frame: string) => void;
  readonly close: (event: SessionSocketCloseEvent) => void;
  readonly error: () => void;
}

export interface SessionSocket {
  readonly send: (frame: string) => void;
  readonly close: (code?: number, reason?: string) => void;
}

export interface SessionSocketFactory {
  /** Handler callbacks must not run synchronously before open returns. */
  readonly open: (
    url: string,
    handlers: SessionSocketHandlers
  ) => SessionSocket;
}

export const createBrowserWebSocketFactory = (): SessionSocketFactory => ({
  open: (url, handlers) => {
    const socket = new WebSocket(url);
    socket.addEventListener('open', handlers.open);
    socket.addEventListener('message', (event) => {
      if (typeof event.data === 'string') handlers.message(event.data);
      else handlers.message('');
    });
    socket.addEventListener('close', (event) =>
      handlers.close({
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
      })
    );
    socket.addEventListener('error', handlers.error);
    return {
      send: (frame) => socket.send(frame),
      close: (code, reason) => socket.close(code, reason),
    };
  },
});
