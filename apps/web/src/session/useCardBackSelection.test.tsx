// @vitest-environment happy-dom

import type { WireGameCommand } from '@ptcgsim/protocol';
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
  submit,
  requestCardBack,
}: {
  readonly submit: (command: WireGameCommand) => unknown;
  readonly requestCardBack: BrowserCardBackRequest;
}) => {
  const { chooseCardBack } = useCardBackSelection({
    submit,
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
  submit: (command: WireGameCommand) => unknown,
  requestCardBack: BrowserCardBackRequest
): Promise<{ readonly host: HTMLDivElement; readonly root: Root }> => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(<Harness submit={submit} requestCardBack={requestCardBack} />)
  );
  return { host, root };
};

describe('card-back selection hook', () => {
  beforeEach(() => document.body.replaceChildren());

  it('submits the exact loaded URL for the actor or explicit solo side', async () => {
    const submit = vi.fn();
    const requestedUrl = 'https://unlisted.example/player-back.png?exact=yes';
    const requestCardBack = vi.fn(async () => requestedUrl);
    const { host, root } = await mount(submit, requestCardBack);

    await act(async () => {
      (host.querySelector('#own') as HTMLButtonElement).click();
      await Promise.resolve();
    });
    expect(submit).toHaveBeenLastCalledWith({
      type: 'SetCardBack',
      cardBackUrl: requestedUrl,
    });

    await act(async () => {
      (host.querySelector('#alternate') as HTMLButtonElement).click();
      await Promise.resolve();
    });
    expect(submit).toHaveBeenLastCalledWith({
      type: 'SetCardBack',
      targetPlayerId: 'alternate-player',
      cardBackUrl: requestedUrl,
    });
    await act(async () => root.unmount());
  });

  it('aborts a superseded request and ignores its stale completion', async () => {
    const submit = vi.fn();
    const requests: Array<{
      readonly options: BrowserCardBackRequestOptions | undefined;
      readonly resolve: (value: string | undefined) => void;
    }> = [];
    const requestCardBack: BrowserCardBackRequest = (options) =>
      new Promise((resolve) => requests.push({ options, resolve }));
    const { host, root } = await mount(submit, requestCardBack);

    act(() => (host.querySelector('#own') as HTMLButtonElement).click());
    act(() => (host.querySelector('#alternate') as HTMLButtonElement).click());
    expect(requests[0]?.options?.signal?.aborted).toBe(true);
    expect(requests[1]?.options?.signal?.aborted).toBe(false);

    await act(async () => requests[0]?.resolve('/stale.png'));
    expect(submit).not.toHaveBeenCalled();
    await act(async () => requests[1]?.resolve('/current.png'));
    expect(submit).toHaveBeenCalledOnce();
    expect(submit).toHaveBeenCalledWith({
      type: 'SetCardBack',
      targetPlayerId: 'alternate-player',
      cardBackUrl: '/current.png',
    });
    await act(async () => root.unmount());
  });

  it('aborts pending work on unmount and never submits afterwards', async () => {
    const submit = vi.fn();
    let options: BrowserCardBackRequestOptions | undefined;
    let resolveRequest: ((value: string | undefined) => void) | undefined;
    const requestCardBack: BrowserCardBackRequest = (requestOptions) => {
      options = requestOptions;
      return new Promise((resolve) => {
        resolveRequest = resolve;
      });
    };
    const { host, root } = await mount(submit, requestCardBack);

    act(() => (host.querySelector('#own') as HTMLButtonElement).click());
    await act(async () => root.unmount());
    expect(options?.signal?.aborted).toBe(true);
    await act(async () => resolveRequest?.('/late.png'));
    expect(submit).not.toHaveBeenCalled();
  });
});
