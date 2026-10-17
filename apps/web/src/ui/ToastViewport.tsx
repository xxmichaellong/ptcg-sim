import { CheckCircleIcon } from '@phosphor-icons/react/dist/csr/CheckCircle';
import { InfoIcon } from '@phosphor-icons/react/dist/csr/Info';
import { WarningIcon } from '@phosphor-icons/react/dist/csr/Warning';
import { WarningCircleIcon } from '@phosphor-icons/react/dist/csr/WarningCircle';
import { XIcon } from '@phosphor-icons/react/dist/csr/X';
import { Toast } from '@base-ui/react/toast';
import { useContext } from 'react';

import { OVERLAY_SURFACE_ATTRIBUTE } from './overlay-surface.js';
import { OverlayContainerContext } from './overlay-host-registry.js';
import type { ToastTone } from './toast.js';
import './overlays.css';

const toneOf = (type: string | undefined): ToastTone =>
  type === 'success' || type === 'warning' || type === 'danger'
    ? type
    : 'default';

const ToneIcon = ({ tone }: { readonly tone: ToastTone }) => {
  const props = {
    className: 'ptcgsim-ui-toast__icon',
    size: 20,
    weight: 'fill' as const,
    'aria-hidden': true,
  };
  switch (tone) {
    case 'success':
      return <CheckCircleIcon {...props} />;
    case 'warning':
      return <WarningIcon {...props} />;
    case 'danger':
      return <WarningCircleIcon {...props} />;
    default:
      return <InfoIcon {...props} />;
  }
};

const ToastList = () => {
  const { toasts } = Toast.useToastManager();
  return toasts.map((entry) => {
    const tone = toneOf(entry.type);
    return (
      <Toast.Root
        key={entry.id}
        toast={entry}
        className="ptcgsim-ui-toast"
        data-tone={tone}
        swipeDirection={['down', 'left', 'right']}
        {...{ [OVERLAY_SURFACE_ATTRIBUTE]: 'toast' }}
      >
        <Toast.Content className="ptcgsim-ui-toast__content">
          <ToneIcon tone={tone} />
          <div className="ptcgsim-ui-toast__text">
            <Toast.Title className="ptcgsim-ui-toast__title" />
            <Toast.Description className="ptcgsim-ui-toast__body" />
          </div>
          <Toast.Close
            className="ptcgsim-ui-toast__close"
            aria-label="Dismiss notification"
          >
            <XIcon size={16} weight="bold" aria-hidden />
          </Toast.Close>
        </Toast.Content>
      </Toast.Root>
    );
  });
};

/** The stack of notices, bottom-centre above the hand. */
export const ToastViewport = () => {
  const container = useContext(OverlayContainerContext);
  return (
    <Toast.Portal
      container={container}
      {...{ [OVERLAY_SURFACE_ATTRIBUTE]: 'portal' }}
    >
      <Toast.Viewport className="ptcgsim-ui-toast-viewport">
        <ToastList />
      </Toast.Viewport>
    </Toast.Portal>
  );
};
