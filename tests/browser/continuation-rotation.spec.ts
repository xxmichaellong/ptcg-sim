import { resolve } from 'node:path';

import {
  parseContinuationHandoffText,
  parseRoomInvitationText,
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
  expectContinuationRestoreSuccess,
  boardIdentity,
  createRoomAndInvite,
  inviteOpponent,
  downloadText,
  exposedBrowserState,
  expectReadyRoom,
  joinReadyRoom,
  openLobby,
  pasteInvitation,
  roomCode,
  type OpenedLobby,
} from './continuation-browser-helpers.js';
import { chooseMenuItem, openActivity } from './support/table-shell.js';

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
  const invitation = await createRoomAndInvite(owner.page, ownerName);
  await pasteInvitation(opponent.page, invitation, opponentName);
  await joinReadyRoom(opponent.page);
  const createdRoomCode = await roomCode(owner.page);
  expect(await roomCode(opponent.page)).toBe(createdRoomCode);
  return { owner, opponent, roomCode: createdRoomCode, invitation };
};

const createSave = async (pair: ReadyPair): Promise<CreatedSave> => {
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
    chooseMenuItem(pair.owner.page, 'saveOnlineGame'),
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
  const fileChooserPromise = page.waitForEvent('filechooser');
  await chooseMenuItem(page, 'resumeSavedGame');
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
  await fileChooser.setFiles({
    name: 'private-rotation-handoff.ptcgsave',
    mimeType: 'text/plain',
    buffer: Buffer.from(artifact.handoffText),
  });
  const [restoreResponse, revokeResponse] = await Promise.all([
    restoreResponsePromise,
    revokeResponsePromise,
  ]);
  expect(restoreResponse.status()).toBe(201);
  expect(restoreResponse.headers()['cache-control']).toContain('no-store');
  expect(revokeResponse.status()).toBe(204);
  expect(revokeResponse.headers()['cache-control']).toContain('no-store');
  await expectContinuationRestoreSuccess(page);
  return inviteOpponent(page);
};

const assertBearerIsolation = async (
  pages: readonly Page[],
  requestUrls: readonly string[],
  bearerValues: readonly string[]
): Promise<void> => {
  for (const requestUrl of requestUrls) {
    const url = new URL(requestUrl);
    // The room's and the save's own endpoints carry nothing in their
    // address (others, such as the deck screen's tournament list, may
    // have a query); no address carries a bearer (below).
    if (/^\/v2\/(?:rooms|continuations)\b/u.test(url.pathname)) {
      expect(url.search).toBe('');
    }
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
    // No deck yet: the opponent's action before a game is the coin
    // (ADR-030 offers no Attack until a seat is playing).
    await opponent.page.locator('#flipCoinButton').click();
    await openActivity(owner.page);
    await expect(
      owner.page
        .locator('#p2Chatbox')
        .getByText(/^Rotation Opponent flipped (heads|tails)$/u)
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
    await expectReadyRoom(owner.page);
    const restoredRoomCode = await roomCode(owner.page);
    expect(restoredRoomCode).not.toBe(stagingPair.roomCode);
    expect(await boardIdentity(owner.page)).toEqual(input.manifest.checkpoint);

    const parsedInvitation = parseRoomInvitationText(restoredInvitation);
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

    await restoredOpponent.page.locator('#flipCoinButton').click();
    await openActivity(owner.page);
    await expect(
      owner.page
        .locator('#p2Chatbox')
        .getByText(/^Restored Opponent flipped (heads|tails)$/u)
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
