// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  BrowserCardBackRequest,
  BrowserCardBackRequestOptions,
} from './browser-card-back.js';
import { useCardBackSelection } from './useCardBackSelection.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const Harness = ({
  applySelection,
  requestCardBack,
}: {
  readonly applySelection: (
    cardBackUrl: string,
    target: string | undefined
  ) => unknown;
  readonly requestCardBack: BrowserCardBackRequest;
}) => {
  const { chooseCardBack } = useCardBackSelection({
    applySelection,
    requestCardBack,
  });
  return (
    <>
      <button id="own" type="button" onClick={() => chooseCardBack()} />
      <button
        id="alternate"
        type="button"
        onClick={() => chooseCardBack('alternate-player')}
      />
    </>
  );
};

const mount = async (
  applySelection: (cardBackUrl: string, target: string | undefined) => unknown,
  requestCardBack: BrowserCardBackRequest
): Promise<{ readonly host: HTMLDivElement; readonly root: Root }> => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <Harness
        applySelection={applySelection}
        requestCardBack={requestCardBack}
      />
    )
  );
  return { host, root };
};

describe('card-back selection hook', () => {
  beforeEach(() => document.body.replaceChildren());

  it('delivers the exact loaded URL for the actor or explicit solo side', async () => {
    const applySelection = vi.fn();
    const requestedUrl = 'https://unlisted.example/player-back.png?exact=yes';
    const requestCardBack = vi.fn(async () => requestedUrl);
    const { host, root } = await mount(applySelection, requestCardBack);

    await act(async () => {
      (host.querySelector('#own') as HTMLButtonElement).click();
      await Promise.resolve();
    });
    expect(applySelection).toHaveBeenLastCalledWith(requestedUrl, undefined);

    await act(async () => {
      (host.querySelector('#alternate') as HTMLButtonElement).click();
      await Promise.resolve();
    });
    expect(applySelection).toHaveBeenLastCalledWith(
      requestedUrl,
      'alternate-player'
    );
    await act(async () => root.unmount());
  });

  it('aborts a superseded request and ignores its stale completion', async () => {
    const applySelection = vi.fn();
    const requests: Array<{
      readonly options: BrowserCardBackRequestOptions | undefined;
      readonly resolve: (value: string | undefined) => void;
    }> = [];
    const requestCardBack: BrowserCardBackRequest = (options) =>
      new Promise((resolve) => requests.push({ options, resolve }));
    const { host, root } = await mount(applySelection, requestCardBack);

    act(() => (host.querySelector('#own') as HTMLButtonElement).click());
    act(() => (host.querySelector('#alternate') as HTMLButtonElement).click());
    expect(requests[0]?.options?.signal?.aborted).toBe(true);
    expect(requests[1]?.options?.signal?.aborted).toBe(false);

    await act(async () => requests[0]?.resolve('/stale.png'));
    expect(applySelection).not.toHaveBeenCalled();
    await act(async () => requests[1]?.resolve('/current.png'));
    expect(applySelection).toHaveBeenCalledOnce();
    expect(applySelection).toHaveBeenCalledWith(
      '/current.png',
      'alternate-player'
    );
    await act(async () => root.unmount());
  });

  it('aborts pending work on unmount and never submits afterwards', async () => {
    const applySelection = vi.fn();
    let options: BrowserCardBackRequestOptions | undefined;
    let resolveRequest: ((value: string | undefined) => void) | undefined;
    const requestCardBack: BrowserCardBackRequest = (requestOptions) => {
      options = requestOptions;
      return new Promise((resolve) => {
        resolveRequest = resolve;
      });
    };
    const { host, root } = await mount(applySelection, requestCardBack);

    act(() => (host.querySelector('#own') as HTMLButtonElement).click());
    await act(async () => root.unmount());
    expect(options?.signal?.aborted).toBe(true);
    await act(async () => resolveRequest?.('/late.png'));
    expect(applySelection).not.toHaveBeenCalled();
  });
});
