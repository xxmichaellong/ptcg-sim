import { expect, test, type Page } from '@playwright/test';

import { dismissWelcome } from './support/table-shell.js';

/**
 * A seat's colour follows the player, not the half of the table it sits in
 * (SeatTone): at a Solo table the viewer's seat, Blue, is in the "you"
 * colour and Red in the opponent's, and turning the board around moves the
 * seats without swapping their colours -- the empty deck's +, the half's
 * glow and the hand's pill. The rail, which acts for the seat at the
 * bottom, takes that seat's colour.
 */

interface SeatColours {
  readonly side: string;
  readonly plus: string;
  readonly glow: string;
  readonly pill: string;
}

const openSolo = async (page: Page): Promise<void> => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?renderer=dom');
  await expect(
    page.locator('[data-app-route="remote-room"][data-session-phase="ready"]')
  ).toBeVisible({ timeout: 30_000 });
  await dismissWelcome(page);
  await expect(page.locator('[data-load-deck-player]')).toHaveCount(2);
};

/** Each seat's colours as painted, and the two seat colours they should be. */
const paint = (page: Page) =>
  page.evaluate(() => {
    const probe = document.createElement('div');
    document.body.append(probe);
    const resolve = (value: string): string => {
      probe.style.backgroundColor = value;
      return getComputedStyle(probe).backgroundColor;
    };
    const tokens = {
      you: resolve('var(--color-accent)'),
      opponent: resolve('var(--color-opponent)'),
      youGlow: resolve('var(--color-you-soft)'),
      opponentGlow: resolve('var(--color-opponent-soft)'),
      youHand: resolve('rgba(90, 110, 188, 0.864)'),
      opponentHand: resolve('rgba(188, 90, 113, 0.864)'),
    };
    const seats: Record<string, SeatColours> = {};
    for (const button of document.querySelectorAll<HTMLElement>(
      '[data-load-deck-player]'
    )) {
      const playerId = button.dataset.loadDeckPlayer!;
      const frame = document.querySelector<HTMLElement>(
        `.ptcgsim-player-frame[data-player-frame-id="${playerId}"]`
      )!;
      const pill = document.querySelector<HTMLElement>(
        `.table-hand-pill[data-hand-pill-player="${playerId}"]`
      )!;
      const glow = getComputedStyle(frame).backgroundImage;
      seats[playerId] = {
        side: frame.dataset.playerFrameSide!,
        plus: getComputedStyle(button).color,
        glow: glow.includes(tokens.youGlow)
          ? 'you'
          : glow.includes(tokens.opponentGlow)
            ? 'opponent'
            : glow,
        pill: resolve(
          getComputedStyle(pill).getPropertyValue('--table-hand-tint')
        ),
      };
    }
    probe.remove();
    return {
      tokens,
      seats,
      rail:
        document
          .querySelector<HTMLElement>('.ptcgsim-table-rail__actions')
          ?.getAttribute('data-seat') ?? 'you',
    };
  });

test('turning a Solo table around keeps each seat in its own colour', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await openSolo(page);
  const before = await paint(page);
  // Blue, the viewer's seat, starts at the bottom.
  const seatAt = (side: string) =>
    Object.entries(before.seats).find(([, seat]) => seat.side === side)![0];
  const blue = seatAt('local');
  const red = seatAt('opponent');
  const expectSeats = (
    shown: Awaited<ReturnType<typeof paint>>,
    bottom: string
  ) => {
    const { tokens, seats } = shown;
    expect(seats[blue]).toEqual({
      side: bottom === blue ? 'local' : 'opponent',
      plus: tokens.you,
      glow: 'you',
      pill: tokens.youHand,
    });
    expect(seats[red]).toEqual({
      side: bottom === red ? 'local' : 'opponent',
      plus: tokens.opponent,
      glow: 'opponent',
      pill: tokens.opponentHand,
    });
  };
  expectSeats(before, blue);
  expect(before.rail).toBe('you');

  await page.locator('#flipBoardButton').click();
  await expect(
    page.locator(`.ptcgsim-player-frame[data-player-frame-id="${red}"]`)
  ).toHaveAttribute('data-player-frame-side', 'local');
  // Red now sits at the bottom, still in Red's colour; Blue keeps Blue's.
  const after = await paint(page);
  expectSeats(after, red);
  // The rail acts for the seat at the bottom, Red.
  expect(after.rail).toBe('opponent');

  await page.locator('#flipBoardButton').click();
  await expect(
    page.locator(`.ptcgsim-player-frame[data-player-frame-id="${blue}"]`)
  ).toHaveAttribute('data-player-frame-side', 'local');
  expectSeats(await paint(page), blue);
});
