// @vitest-environment happy-dom

import { StrictMode } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RemoteRoomCreationResult } from '../session/RemoteRoomCreation.js';
import { DevRoomHost } from './DevRoomHost.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const harness = vi.hoisted(() => ({
  createRemoteRoom: vi.fn(),
}));

vi.mock('../session/RemoteRoomCreation.js', () => ({
  createRemoteRoom: harness.createRemoteRoom,
}));

vi.mock('../App.js', () => ({
  App: ({ route }: { readonly route: { readonly kind: string } }) => (
    <main data-app-route={`test-${route.kind}`} />
  ),
}));

const result = (label: string) => {
  const dispose = vi.fn();
  return {
    value: {
      route: {
        kind: 'remote-room',
        runtime: { label },
        rendererKind: 'dom',
      },
      dispose,
    } as unknown as RemoteRoomCreationResult,
    dispose,
  };
};

const flushEffects = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('DevRoomHost ownership', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    delete (globalThis as Record<string, unknown>)['__ptcgsimDevRoom'];
    vi.clearAllMocks();
  });

  it('owns the created room through route unmount and aborts outstanding work', async () => {
    const created = result('single');
    harness.createRemoteRoom.mockResolvedValueOnce(created.value);
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<DevRoomHost displayName=" Blue " rendererKind="dom" />);
      await flushEffects();
    });

    expect(harness.createRemoteRoom).toHaveBeenCalledOnce();
    const input = harness.createRemoteRoom.mock.calls[0]?.[0] as
      { readonly signal?: AbortSignal } | undefined;
    expect(input).toMatchObject({
      buildId: 'local-development',
      displayName: ' Blue ',
      rendererKind: 'dom',
    });
    expect(input?.signal?.aborted).toBe(false);
    expect(host.querySelector('main')?.dataset.appRoute).toBe(
      'test-remote-room'
    );
    expect((globalThis as Record<string, unknown>)['__ptcgsimDevRoom']).toBe(
      created.value
    );

    await act(async () => root.unmount());
    expect(input?.signal?.aborted).toBe(true);
    expect(created.dispose).toHaveBeenCalledOnce();
    expect(
      (globalThis as Record<string, unknown>)['__ptcgsimDevRoom']
    ).toBeUndefined();
  });

  it('coalesces the StrictMode probe into one durable room creation', async () => {
    const active = result('active');
    harness.createRemoteRoom.mockResolvedValueOnce(active.value);
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <StrictMode>
          <DevRoomHost displayName="Blue" rendererKind="dom" />
        </StrictMode>
      );
      await flushEffects();
    });

    expect(harness.createRemoteRoom).toHaveBeenCalledOnce();
    expect(active.dispose).not.toHaveBeenCalled();
    expect((globalThis as Record<string, unknown>)['__ptcgsimDevRoom']).toBe(
      active.value
    );

    await act(async () => root.unmount());
    expect(active.dispose).toHaveBeenCalledOnce();
  });

  it('does not let an older owner delete a newer global room handle', async () => {
    const first = result('first');
    const second = result('second');
    harness.createRemoteRoom
      .mockResolvedValueOnce(first.value)
      .mockResolvedValueOnce(second.value);
    const firstHost = document.createElement('div');
    const secondHost = document.createElement('div');
    document.body.append(firstHost, secondHost);
    const firstRoot = createRoot(firstHost);
    const secondRoot = createRoot(secondHost);

    await act(async () => {
      firstRoot.render(<DevRoomHost displayName="One" rendererKind="dom" />);
      await flushEffects();
      secondRoot.render(<DevRoomHost displayName="Two" rendererKind="dom" />);
      await flushEffects();
    });
    expect((globalThis as Record<string, unknown>)['__ptcgsimDevRoom']).toBe(
      second.value
    );

    await act(async () => firstRoot.unmount());
    expect(first.dispose).toHaveBeenCalledOnce();
    expect((globalThis as Record<string, unknown>)['__ptcgsimDevRoom']).toBe(
      second.value
    );

    await act(async () => secondRoot.unmount());
    expect(second.dispose).toHaveBeenCalledOnce();
    expect(
      (globalThis as Record<string, unknown>)['__ptcgsimDevRoom']
    ).toBeUndefined();
  });
});
