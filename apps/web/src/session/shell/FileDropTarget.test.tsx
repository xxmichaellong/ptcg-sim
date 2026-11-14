// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FileDropTarget } from './FileDropTarget.js';

vi.mock('../../ui/toast.js', () => ({ toast: vi.fn() }));
const { toast } = await import('../../ui/toast.js');

const fileDrop = (file: File): DragEvent => {
  const event = new Event('drop', {
    bubbles: true,
    cancelable: true,
  }) as DragEvent;
  Object.defineProperty(event, 'dataTransfer', {
    value: { types: ['Files'], files: [file] },
  });
  return event;
};

describe('FileDropTarget', () => {
  let root: Root | undefined;
  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    document.body.replaceChildren();
    vi.mocked(toast).mockClear();
  });

  const mount = (onFile: (file: File) => boolean) => {
    const host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() => root!.render(<FileDropTarget onFile={onFile} />));
    return host;
  };

  it('opens a file dropped on the window, and says so when it cannot', () => {
    const onFile = vi.fn(() => false);
    mount(onFile);
    const replay = new File(['{}'], 'game.json');
    act(() => {
      document.body.dispatchEvent(fileDrop(replay));
    });
    expect(onFile).toHaveBeenCalledExactlyOnceWith(replay);
    expect(toast).toHaveBeenCalledOnce();
  });

  it('leaves a drop something on the page already took', () => {
    const onFile = vi.fn(() => false);
    mount(onFile);
    // The deck screen's own drop zone imports a list and keeps the event.
    const zone = document.createElement('div');
    zone.addEventListener('drop', (event) => event.preventDefault());
    document.body.append(zone);
    act(() => {
      zone.dispatchEvent(fileDrop(new File(['4 Pikachu'], 'deck.txt')));
    });
    expect(onFile).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });
});
