import { Toast } from '@base-ui/react/toast';
import {
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import { DialogHost } from './DialogHost.js';
import {
  activeOverlayHost,
  OverlayContainerContext,
  registerOverlayHost,
  subscribeOverlayHosts,
} from './overlay-host-registry.js';
import { connectToastHost, toastManager } from './toast.js';
import { ToastViewport } from './ToastViewport.js';
import { TooltipProvider } from './Tooltip.js';

const MAX_VISIBLE_TOASTS = 3;

/**
 * Runs after the sibling `Toast.Provider` has subscribed to the manager
 * (React runs a parent's earlier children's effects first), so notices
 * raised before the host existed are not lost.
 */
const ToastConnection = () => {
  useEffect(() => {
    connectToastHost(true);
    return () => connectToastHost(false);
  }, []);
  return null;
};

const ActiveOverlays = ({
  container,
}: {
  readonly container: HTMLElement | undefined;
}) => (
  <OverlayContainerContext.Provider value={container}>
    <Toast.Provider toastManager={toastManager} limit={MAX_VISIBLE_TOASTS}>
      <ToastViewport />
    </Toast.Provider>
    <ToastConnection />
    <DialogHost />
  </OverlayContainerContext.Provider>
);

export interface OverlayHostProps {
  /** Portal target for dialogs and toasts; `document.body` by default. */
  readonly container?: HTMLElement;
  readonly children?: ReactNode;
}

/**
 * Mount once near the root of every React tree that can raise a dialog or a
 * toast. It renders the `confirmAction` / `promptValue` queue and the toast
 * stack, and provides the shared tooltip delay to its children. When more
 * than one host is mounted, the newest renders and the others stand by.
 */
export const OverlayHost = ({ container, children }: OverlayHostProps) => {
  const [token] = useState(() => Symbol('ptcgsim-overlay-host'));
  useEffect(() => registerOverlayHost(token), [token]);
  const active = useSyncExternalStore(
    subscribeOverlayHosts,
    () => activeOverlayHost() === token,
    () => false
  );
  return (
    <TooltipProvider>
      {children}
      {active ? <ActiveOverlays container={container} /> : null}
    </TooltipProvider>
  );
};
