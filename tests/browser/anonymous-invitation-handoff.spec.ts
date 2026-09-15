import { expect, test, type BrowserContext, type Page } from '@playwright/test';

interface BrowserRoomHandle {
  readonly runtime: {
    readonly roomCode: string;
    readonly session: {
      readonly getSnapshot: () => {
        readonly phase: string;
        readonly role?: string;
      };
    };
    readonly dispose: () => void;
  };
  readonly dispose?: () => void;
}

interface BrowserCreatorHandle extends BrowserRoomHandle {
  readonly invitations: {
    readonly copyPlayerInvitation: () => Promise<unknown>;
    readonly copySpectatorInvitation: () => Promise<unknown>;
  };
}

interface InvitationTestGlobals {
  __ptcgsimInvitationTestRoom?: BrowserRoomHandle;
  __ptcgsimInvitationTestCreator?: BrowserCreatorHandle;
  __ptcgsimInvitationJoinCustody?: InvitationJoinCustody;
  __ptcgsimInvitationReceipt?: {
    readonly roomCode: string;
    readonly requestedRole: string;
  };
}

interface InvitationJoinCustody {
  readonly acceptPaste: (event: {
    readonly clipboardData: {
      readonly getData: (format: string) => string;
    } | null;
    readonly preventDefault: () => void;
  }) => {
    readonly roomCode: string;
    readonly requestedRole: string;
  };
  readonly bootstrap: (input: {
    readonly buildId: string;
    readonly displayName: string;
    readonly rendererKind: 'dom';
  }) => Promise<BrowserRoomHandle>;
}

interface HandoffModuleShape {
  readonly RemoteRoomInvitationJoinCustody: new () => InvitationJoinCustody;
}

interface CreationModuleShape {
  readonly createRemoteRoom: (input: {
    readonly buildId: string;
    readonly displayName: string;
    readonly mode: 'multiplayer';
    readonly rendererKind: 'dom';
  }) => Promise<BrowserCreatorHandle & { readonly mode: string }>;
}

const creationModulePath = '/src/session/RemoteRoomCreation.ts';
const handoffModulePath = '/src/session/RemoteRoomInvitationHandoff.ts';

const openIsolatedPage = async (
  context: BrowserContext,
  errors: string[]
): Promise<Page> => {
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  await page.goto('/');
  return page;
};

const copyInvitation = (
  page: Page,
  role: 'player' | 'spectator'
): Promise<string> =>
  page.evaluate(async (requestedRole) => {
    const creator = (globalThis as InvitationTestGlobals)
      .__ptcgsimInvitationTestCreator;
    if (!creator) throw new Error('Missing invitation-test creator');
    if (requestedRole === 'player') {
      await creator.invitations.copyPlayerInvitation();
    } else {
      await creator.invitations.copySpectatorInvitation();
    }
    const copied = await globalThis.navigator.clipboard.readText();
    if (!copied) throw new Error('Invitation handoff was not copied');
    return copied;
  }, role);

const joinFromHandoff = async (
  page: Page,
  handoffText: string,
  displayName: string
): Promise<{
  roomCode: string;
  requestedRole: string;
  custodyJson: string;
}> => {
  await page.evaluate(
    async ({ text, modulePath }) => {
      await globalThis.navigator.clipboard.writeText(text);
      const module = (await import(modulePath)) as HandoffModuleShape;
      const custody = new module.RemoteRoomInvitationJoinCustody();
      const input = globalThis.document.createElement('input');
      input.id = 'invitation-handoff-paste-target';
      input.addEventListener('paste', (event) => {
        const receipt = custody.acceptPaste(event);
        input.value = receipt.roomCode;
        const globals = globalThis as InvitationTestGlobals;
        globals.__ptcgsimInvitationReceipt = receipt;
      });
      globalThis.document.body.append(input);
      (globalThis as InvitationTestGlobals).__ptcgsimInvitationJoinCustody =
        custody;
    },
    { text: handoffText, modulePath: handoffModulePath }
  );
  const input = page.locator('#invitation-handoff-paste-target');
  await input.focus();
  await page.keyboard.press('Control+V');
  await expect(input).toHaveValue(/^[A-HJ-NP-Z2-9]{12}$/u);
  return page.evaluate(async (name) => {
    const globals = globalThis as InvitationTestGlobals;
    const custody = globals.__ptcgsimInvitationJoinCustody;
    const receipt = globals.__ptcgsimInvitationReceipt;
    if (!custody || !receipt) {
      throw new Error('Invitation paste was not intercepted');
    }
    const result = await custody.bootstrap({
      buildId: 'local-development',
      displayName: name,
      rendererKind: 'dom',
    });
    globals.__ptcgsimInvitationTestRoom = {
      runtime: result.runtime,
      dispose: () => result.runtime.dispose(),
    };
    return {
      roomCode: receipt.roomCode,
      requestedRole: receipt.requestedRole,
      custodyJson: JSON.stringify(custody),
    };
  }, displayName);
};

const waitForReadyRole = async (
  page: Page,
  role: 'player' | 'spectator'
): Promise<void> => {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const room = (globalThis as InvitationTestGlobals)
          .__ptcgsimInvitationTestRoom;
        const snapshot = room?.runtime.session.getSnapshot();
        return snapshot?.phase === 'ready' ? snapshot.role : snapshot?.phase;
      })
    )
    .toBe(role);
};

test('manual handoff admits player two and distinct repeat spectators across isolated browser contexts', async ({
  browser,
}) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  const requestUrls: string[] = [];
  const contextOptions = {
    baseURL: 'http://127.0.0.1:4173',
    permissions: ['clipboard-read', 'clipboard-write'],
  };
  const contexts = await Promise.all([
    browser.newContext(contextOptions),
    browser.newContext(contextOptions),
    browser.newContext(contextOptions),
    browser.newContext(contextOptions),
    browser.newContext(contextOptions),
  ]);
  try {
    const pages = await Promise.all(
      contexts.map((context) => openIsolatedPage(context, errors))
    );
    for (const page of pages) {
      page.on('request', (request) => {
        const url = new URL(request.url());
        if (url.pathname.startsWith('/v2/')) requestUrls.push(url.href);
      });
      page.on('websocket', (socket) => {
        const url = new URL(socket.url());
        if (url.pathname.startsWith('/v2/')) requestUrls.push(url.href);
      });
    }
    const [creator, rotatedGuest, playerTwo, spectatorOne, spectatorTwo] =
      pages as [Page, Page, Page, Page, Page];

    const created = await creator.evaluate(
      async ({ modulePath }) => {
        const module = (await import(modulePath)) as CreationModuleShape;
        const result = await module.createRemoteRoom({
          buildId: 'local-development',
          displayName: 'Blue',
          mode: 'multiplayer',
          rendererKind: 'dom',
        });
        (globalThis as InvitationTestGlobals).__ptcgsimInvitationTestCreator =
          result;
        (globalThis as InvitationTestGlobals).__ptcgsimInvitationTestRoom =
          result;
        return { roomCode: result.runtime.roomCode, mode: result.mode };
      },
      { modulePath: creationModulePath }
    );
    expect(created).toEqual({
      roomCode: expect.stringMatching(/^[A-HJ-NP-Z2-9]{12}$/u),
      mode: 'multiplayer',
    });
    await waitForReadyRole(creator, 'player');

    const rotatedPlayerHandoff = await copyInvitation(creator, 'player');
    const activePlayerHandoff = await copyInvitation(creator, 'player');
    expect(activePlayerHandoff).not.toBe(rotatedPlayerHandoff);

    const rotatedResult = await rotatedGuest.evaluate(
      async ({ text, modulePath }) => {
        const module = (await import(modulePath)) as HandoffModuleShape;
        const custody = new module.RemoteRoomInvitationJoinCustody();
        custody.acceptPaste({
          clipboardData: { getData: () => text },
          preventDefault: () => undefined,
        });
        try {
          await custody.bootstrap({
            buildId: 'local-development',
            displayName: 'Rotated',
            rendererKind: 'dom',
          });
          return 'accepted';
        } catch (error) {
          return error instanceof Error && 'code' in error
            ? String(error.code)
            : 'redacted_failure';
        }
      },
      { text: rotatedPlayerHandoff, modulePath: handoffModulePath }
    );
    expect(rotatedResult).toBe('exchange_failed');

    const playerReceipt = await joinFromHandoff(
      playerTwo,
      activePlayerHandoff,
      'Red'
    );
    expect(playerReceipt).toEqual({
      roomCode: created.roomCode,
      requestedRole: 'player',
      custodyJson: '{}',
    });
    await waitForReadyRole(playerTwo, 'player');

    const spectatorOneHandoff = await copyInvitation(creator, 'spectator');
    const spectatorTwoHandoff = await copyInvitation(creator, 'spectator');
    expect(spectatorOneHandoff).not.toBe(spectatorTwoHandoff);
    for (const [page, handoffText, name] of [
      [spectatorOne, spectatorOneHandoff, 'Watcher One'],
      [spectatorTwo, spectatorTwoHandoff, 'Watcher Two'],
    ] as const) {
      const receipt = await joinFromHandoff(page, handoffText, name);
      expect(receipt).toEqual({
        roomCode: created.roomCode,
        requestedRole: 'spectator',
        custodyJson: '{}',
      });
      await waitForReadyRole(page, 'spectator');
    }

    const secrets = [
      rotatedPlayerHandoff,
      activePlayerHandoff,
      spectatorOneHandoff,
      spectatorTwoHandoff,
    ];
    const bearerSecrets = secrets.flatMap((text) => {
      const value = JSON.parse(text.slice('PTCGSIM2-INVITE:'.length)) as {
        readonly invitation: string;
      };
      return [text, value.invitation];
    });
    for (const url of requestUrls) {
      for (const secret of bearerSecrets) expect(url).not.toContain(secret);
      expect(new URL(url).search).toBe('');
      expect(new URL(url).hash).toBe('');
    }
    for (const page of pages) {
      const exposed = await page.evaluate(() => ({
        href: globalThis.location.href,
        html: globalThis.document.documentElement.outerHTML,
        localStorage: Array.from(
          { length: globalThis.localStorage.length },
          (_, index) =>
            globalThis.localStorage.getItem(globalThis.localStorage.key(index)!)
        ),
        sessionStorage: Array.from(
          { length: globalThis.sessionStorage.length },
          (_, index) =>
            globalThis.sessionStorage.getItem(
              globalThis.sessionStorage.key(index)!
            )
        ),
      }));
      for (const secret of bearerSecrets) {
        expect(JSON.stringify(exposed)).not.toContain(secret);
      }
    }
    // Chromium reports a failed-resource console error for the deliberate 403
    // above even though Fetch resolves and the client handles it. Require that
    // exact rejection signal, and no unrelated page or console failures.
    expect(errors).toEqual([
      'console: Failed to load resource: the server responded with a status of 403 (Forbidden)',
    ]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
