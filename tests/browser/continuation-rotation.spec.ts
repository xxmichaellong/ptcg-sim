import { resolve } from 'node:path';

import {
  parseContinuationHandoffText,
  parseRoomInvitationHandoffText,
} from '../../packages/protocol/src/index.js';
import {
  prepareContinuationRotationArtifactDirectory,
  readContinuationRotationArtifact,
  writeContinuationRotationArtifact,
  type ContinuationRotationArtifact,
} from '../../scripts/continuation-rotation-artifact.js';
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';

import {
  CONTINUATION_RESTORE_SUCCESS_MESSAGE,
  ROOM_CODE,
  boardIdentity,
  copyInvitation,
  downloadText,
  exposedBrowserState,
  joinReadyRoom,
  openLobby,
  pasteInvitation,
  readClipboard,
  roomCode,
  type OpenedLobby,
} from './continuation-browser-helpers.js';

const repositoryRoot = resolve('.');
const inputDirectory =
  process.env['PTCGSIM_CONTINUATION_ROTATION_INPUT']?.trim();
const outputDirectory =
  process.env['PTCGSIM_CONTINUATION_ROTATION_OUTPUT']?.trim();

interface ReadyPair {
  readonly owner: OpenedLobby;
  readonly opponent: OpenedLobby;
  readonly roomCode: string;
  readonly invitation: string;
}

interface CreatedSave {
  readonly handoffText: string;
  readonly capability: string;
}

const createContexts = async (
  browser: Browser,
  baseURL: string,
  count: number
): Promise<BrowserContext[]> =>
  Promise.all(
    Array.from({ length: count }, () =>
      browser.newContext({
        baseURL,
        permissions: ['clipboard-read', 'clipboard-write'],
      })
    )
  );

const trackV2Requests = (page: Page, requestUrls: string[]): void => {
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/v2/')) requestUrls.push(url.href);
  });
  page.on('websocket', (socket) => {
    const url = new URL(socket.url());
    if (url.pathname.startsWith('/v2/')) requestUrls.push(url.href);
  });
};

const createReadyPair = async (
  owner: OpenedLobby,
  opponent: OpenedLobby,
  ownerName: string,
  opponentName: string
): Promise<ReadyPair> => {
  await owner.page.locator('#nameInput').fill(ownerName);
  await owner.page.locator('#generateIdButton').click();
  await expect(owner.page.locator('#roomIdInput')).toHaveValue(ROOM_CODE);
  const invitation = await copyInvitation(owner.page);
  await pasteInvitation(opponent.page, invitation, opponentName);
  await joinReadyRoom(opponent.page);
  await joinReadyRoom(owner.page);
  const createdRoomCode = await roomCode(owner.page);
  expect(await roomCode(opponent.page)).toBe(createdRoomCode);
  return { owner, opponent, roomCode: createdRoomCode, invitation };
};

const createSave = async (pair: ReadyPair): Promise<CreatedSave> => {
  await pair.owner.page.locator('#p2OptionsButton').click();
  const responsePromise = pair.owner.page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.request().method() === 'POST' &&
      url.pathname === `/v2/rooms/${pair.roomCode}/continuations`
    );
  });
  const [download, response] = await Promise.all([
    pair.owner.page.waitForEvent('download'),
    responsePromise,
    pair.owner.page.locator('#saveOnlineGame').click(),
  ]);
  expect(response.status()).toBe(201);
  expect(response.headers()['cache-control']).toContain('no-store');
  expect(download.suggestedFilename()).toBe('ptcgsim-online-save.ptcgsave');
  const handoffText = await downloadText(download);
  const parsed = parseContinuationHandoffText(handoffText);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error('Downloaded rotation handoff is invalid');
  return {
    handoffText,
    capability: parsed.value.capability,
  };
};

const restoreSave = async (
  page: Page,
  artifact: ContinuationRotationArtifact
): Promise<string> => {
  await page.locator('#p2OptionsButton').click();
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.locator('#resumeSavedGame').click();
  const fileChooser = await fileChooserPromise;
  const restorePath = `/v2/continuations/${artifact.manifest.saveId}/restore`;
  const revokePath = `/v2/continuations/${artifact.manifest.saveId}`;
  const restoreResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.request().method() === 'POST' && url.pathname === restorePath
    );
  });
  const revokeResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.request().method() === 'DELETE' && url.pathname === revokePath
    );
  });
  const successDialog = new Promise<string>((accept) => {
    page.once('dialog', async (dialog) => {
      accept(dialog.message());
      await dialog.accept();
    });
  });
  await fileChooser.setFiles({
    name: 'private-rotation-handoff.ptcgsave',
    mimeType: 'text/plain',
    buffer: Buffer.from(artifact.handoffText),
  });
  const [restoreResponse, revokeResponse, message] = await Promise.all([
    restoreResponsePromise,
    revokeResponsePromise,
    successDialog,
  ]);
  expect(restoreResponse.status()).toBe(201);
  expect(restoreResponse.headers()['cache-control']).toContain('no-store');
  expect(revokeResponse.status()).toBe(204);
  expect(revokeResponse.headers()['cache-control']).toContain('no-store');
  expect(message).toBe(CONTINUATION_RESTORE_SUCCESS_MESSAGE);
  return readClipboard(page);
};

const assertBearerIsolation = async (
  pages: readonly Page[],
  requestUrls: readonly string[],
  bearerValues: readonly string[]
): Promise<void> => {
  for (const requestUrl of requestUrls) {
    const url = new URL(requestUrl);
    expect(url.search).toBe('');
    expect(url.hash).toBe('');
    for (const bearer of bearerValues) {
      if (requestUrl.includes(bearer)) {
        throw new Error('A private bearer entered a request URL');
      }
    }
  }
  for (const page of pages) {
    const exposed = JSON.stringify(await exposedBrowserState(page));
    for (const bearer of bearerValues) {
      if (exposed.includes(bearer)) {
        throw new Error('A private bearer entered browser-visible state');
      }
    }
  }
};

const capture = async (
  browser: Browser,
  baseURL: string,
  preparedOutput: string
): Promise<void> => {
  const contexts = await createContexts(browser, baseURL, 2);
  const requestUrls: string[] = [];
  try {
    const [owner, opponent] = (await Promise.all(contexts.map(openLobby))) as [
      OpenedLobby,
      OpenedLobby,
    ];
    const pages = [owner.page, opponent.page];
    for (const page of pages) trackV2Requests(page, requestUrls);
    const pair = await createReadyPair(
      owner,
      opponent,
      'Rotation Owner',
      'Rotation Opponent'
    );
    await opponent.page.locator('#p2AttackButton').click();
    await expect(
      owner.page
        .locator('#p2Chatbox')
        .getByText('Rotation Opponent attacked', { exact: true })
    ).toBeVisible();
    const checkpoint = await boardIdentity(owner.page);
    expect(await boardIdentity(opponent.page)).toEqual(checkpoint);
    const save = await createSave(pair);
    await writeContinuationRotationArtifact({
      directory: preparedOutput,
      repositoryRoot,
      origin: baseURL,
      handoffText: save.handoffText,
      checkpoint,
    });
    await assertBearerIsolation(pages, requestUrls, [
      pair.invitation,
      save.handoffText,
      save.capability,
    ]);
    expect(owner.errors).toEqual([]);
    expect(opponent.errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
};

const transition = async (
  browser: Browser,
  baseURL: string,
  input: ContinuationRotationArtifact,
  preparedOutput?: string
): Promise<void> => {
  const contexts = await createContexts(browser, baseURL, 3);
  const requestUrls: string[] = [];
  try {
    const [owner, stagingOpponent, restoredOpponent] = (await Promise.all(
      contexts.map(openLobby)
    )) as [OpenedLobby, OpenedLobby, OpenedLobby];
    const pages = [owner.page, stagingOpponent.page, restoredOpponent.page];
    for (const page of pages) trackV2Requests(page, requestUrls);
    const stagingPair = await createReadyPair(
      owner,
      stagingOpponent,
      'Transition Owner',
      'Staging Opponent'
    );
    const stagingCheckpoint = await boardIdentity(stagingOpponent.page);
    const restoredInvitation = await restoreSave(owner.page, input);
    await expect(owner.page.locator('#roomHeaderText')).toHaveAttribute(
      'data-session-phase',
      'ready'
    );
    const restoredRoomCode = await roomCode(owner.page);
    expect(restoredRoomCode).not.toBe(stagingPair.roomCode);
    expect(await boardIdentity(owner.page)).toEqual(input.manifest.checkpoint);

    const parsedInvitation = parseRoomInvitationHandoffText(restoredInvitation);
    expect(parsedInvitation.ok).toBe(true);
    if (!parsedInvitation.ok) {
      throw new Error('Restored rotation invitation is invalid');
    }
    expect(parsedInvitation.value.roomCode).toBe(restoredRoomCode);
    expect(parsedInvitation.value.requestedRole).toBe('player');
    await pasteInvitation(
      restoredOpponent.page,
      restoredInvitation,
      'Restored Opponent'
    );
    await joinReadyRoom(restoredOpponent.page);
    expect(await boardIdentity(restoredOpponent.page)).toEqual(
      input.manifest.checkpoint
    );
    expect(await boardIdentity(stagingOpponent.page)).toEqual(
      stagingCheckpoint
    );

    await restoredOpponent.page.locator('#p2AttackButton').click();
    await expect(
      owner.page
        .locator('#p2Chatbox')
        .getByText('Restored Opponent attacked', { exact: true })
    ).toBeVisible();
    const advancedCheckpoint = await boardIdentity(owner.page);
    expect(advancedCheckpoint.matchId).toBe(input.manifest.checkpoint.matchId);
    expect(Number(advancedCheckpoint.revision)).toBeGreaterThan(
      Number(input.manifest.checkpoint.revision)
    );
    expect(await boardIdentity(restoredOpponent.page)).toEqual(
      advancedCheckpoint
    );

    const bearerValues = [
      input.handoffText,
      restoredInvitation,
      parsedInvitation.value.invitation,
      stagingPair.invitation,
    ];
    if (preparedOutput) {
      const outputSave = await createSave({
        owner,
        opponent: restoredOpponent,
        roomCode: restoredRoomCode,
        invitation: restoredInvitation,
      });
      await writeContinuationRotationArtifact({
        directory: preparedOutput,
        repositoryRoot,
        origin: baseURL,
        handoffText: outputSave.handoffText,
        checkpoint: advancedCheckpoint,
      });
      bearerValues.push(outputSave.handoffText, outputSave.capability);
    }
    await assertBearerIsolation(pages, requestUrls, bearerValues);
    expect(owner.errors).toEqual([]);
    expect(stagingOpponent.errors).toEqual([]);
    expect(restoredOpponent.errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
};

test(
  inputDirectory
    ? 'restores a private save across a key transition and optionally captures the next save'
    : 'captures a private save for a later key transition',
  async ({ browser, baseURL }) => {
    if (!baseURL) throw new Error('Continuation preview base URL is required');
    const input = inputDirectory
      ? await readContinuationRotationArtifact(
          inputDirectory,
          repositoryRoot,
          baseURL
        )
      : undefined;
    const preparedOutput = outputDirectory
      ? await prepareContinuationRotationArtifactDirectory(
          outputDirectory,
          repositoryRoot
        )
      : undefined;
    if (!input) {
      if (!preparedOutput) {
        throw new Error('Rotation capture output directory is required');
      }
      await capture(browser, baseURL, preparedOutput);
      return;
    }
    await transition(browser, baseURL, input, preparedOutput);
  }
);
