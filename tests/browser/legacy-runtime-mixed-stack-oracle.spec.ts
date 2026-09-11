import { expect, test } from '@playwright/test';

import oracle from '../legacy-fixtures/renderer/mixed-stack-movement-category-cycle-v1.json' with { type: 'json' };
import { withLegacyRuntimePage } from './support/legacy-runtime-compound-replay.js';

interface RecordedCardState {
  readonly role: string;
  readonly currentCategory: string;
  readonly left: number | null;
  readonly z: number;
  readonly rotation: number;
  readonly attached: boolean;
  readonly target: string;
  readonly energyLayer: number;
  readonly logical: number;
  readonly dom: number;
}

const common = oracle.expected.common as unknown as {
  readonly logicalRoles: readonly string[];
  readonly domRoles: readonly string[];
  readonly cardState: readonly RecordedCardState[];
};
const nativeCanonical = oracle.expected.scenarioPhases
  .nativeCanonical[0] as unknown as {
  readonly name: string;
  readonly mixedZone: string;
  readonly wrapperCounts: readonly number[];
  readonly originalCategories: readonly (string | null)[];
};

const SIDES = ['local', 'opponent'] as const;

/**
 * A mixed stack -- a Pokemon carrying both an Energy and a Trainer-as-Tool --
 * beside a plain control Pokemon, in its canonical resting arrangement.
 *
 * The rule worth having here is what `type2` remembers. Playing a card into the
 * active or bench slot forces its category to Pokemon and files the original
 * under `type2`; attaching one does not. So the two cards played into slots
 * carry an original category and the two attachments carry none, which is
 * exactly the `["Pokémon", null, null, "Pokémon"]` the fixture records. It also
 * pins that logical and DOM order disagree for a mixed stack: the Energy sits
 * second in `zone.array` but last in the container.
 *
 * Recorded from `legacy-source-board.ts` and asserted against that same
 * transcription, so none of it could fail before.
 *
 * Scope: the `nativeCanonical` scenario. The fixture's `reverseRoundTrip` and
 * `categoryCycle` scenarios replay multi-step `leaveAll` and `changeType`
 * flows -- twenty-nine calls for the cycle alone -- which this harness does not
 * drive, and its `callTraceSignatures` and `resetTraceCounts` need v1's own
 * functions instrumented. None of that is claimed here.
 *
 * One recorded field is deliberately not asserted: the inline `left` of the two
 * attachments, which this block gives as unset. Playing the same stack natively
 * puts the Energy at 15.1667px and the Tool at 30.3333px, stable across further
 * refreshes -- and 15.1667px is what `energy-attachment-reflow` and
 * `mixed-energy-trainer-tool-attachment-order` both record for an attached
 * Energy. Two fixtures agreeing with the client against a third is a sign this
 * `common` block describes a different arrangement rather than a different
 * client: it is shared with the `reverseRoundTrip` scenario, which begins from
 * a post-`leaveAll` state. Reproducing that is what the unclaimed scenarios
 * would need, so the field is left alone rather than fitted or dropped
 * silently. Everything else in the block, including both slot cards' `left`,
 * agrees exactly.
 */
for (const side of SIDES) {
  test(`the recorded ${side} mixed-stack canonical arrangement matches the real v1 runtime`, async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Source-characterization gates are Chromium-specific.'
    );

    const capture = await withLegacyRuntimePage(
      page,
      oracle.input.viewport,
      () =>
        page.evaluate(
          async ({ user, mixedZone }) => {
            const load = (specifier: string): Promise<Record<string, never>> =>
              import(/* @vite-ignore */ specifier);
            const [cardModule, zoneModule, bundleModule, refreshModule] =
              await Promise.all([
                load('/src/setup/deck-constructor/card.js'),
                load('/src/setup/zones/get-zone.js'),
                load('/src/actions/move-card-bundle/move-card-bundle.js'),
                load('/src/setup/sizing/refresh-board.js'),
              ]);

            interface LegacyImage extends HTMLImageElement {
              attached?: boolean;
              target?: string;
              energyLayer?: number;
            }
            interface LegacyCard {
              readonly name: string;
              readonly image: LegacyImage;
              type: string;
              type2?: string;
            }
            interface LegacyZone {
              readonly element: HTMLElement;
              readonly array: LegacyCard[];
            }
            const Card = (
              cardModule as unknown as {
                readonly Card: new (
                  user: string,
                  name: string,
                  type: string,
                  imageUrl: string
                ) => LegacyCard;
              }
            ).Card;
            const { getZone } = zoneModule as unknown as {
              readonly getZone: (user: string, zoneId: string) => LegacyZone;
            };
            const { moveCardBundle } = bundleModule as unknown as {
              readonly moveCardBundle: (
                user: string,
                initiator: string,
                oZoneId: string,
                dZoneId: string,
                index: number,
                targetIndex: number,
                action: string,
                emit?: boolean
              ) => void;
            };
            const { refreshBoard } = refreshModule as unknown as {
              readonly refreshBoard: () => void;
            };

            const controlZone = mixedZone === 'active' ? 'bench' : 'active';
            for (const owner of ['self', 'opp']) {
              for (const id of ['active', 'bench', 'hand', 'discard']) {
                const zone = getZone(owner, id);
                zone.array.length = 0;
                for (const image of [...zone.element.querySelectorAll('img')]) {
                  image.remove();
                }
                for (const wrapper of [
                  ...zone.element.querySelectorAll('.play-container'),
                ]) {
                  wrapper.remove();
                }
              }
            }
            const mixed = getZone(user, mixedZone);
            const control = getZone(user, controlZone);
            const hand = getZone(user, 'hand');

            const frames = () =>
              new Promise((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(resolve))
              );
            const make = async (
              name: string,
              type: string
            ): Promise<LegacyCard> => {
              const card = new Card(
                user,
                name,
                type,
                `${location.origin}/src/assets/cardback.png`
              );
              await card.image.decode();
              return card;
            };
            const play = async (
              card: LegacyCard,
              zoneId: string,
              targetIndex: number
            ) => {
              hand.array.push(card);
              hand.element.append(card.image);
              moveCardBundle(
                user,
                'self',
                'hand',
                zoneId,
                hand.array.length - 1,
                targetIndex,
                'play',
                false
              );
              await frames();
            };

            const byRole = new Map<string, LegacyCard>();
            const base = await make('base', 'Pokémon');
            byRole.set('base', base);
            await play(base, mixedZone, -1);
            const container = (): HTMLElement =>
              base.image.parentElement as HTMLElement;
            const settle = async () => {
              let previous = -1;
              for (let attempt = 0; attempt < 8; attempt += 1) {
                refreshBoard();
                await frames();
                const width = container().clientWidth;
                if (width === previous && width > 0) return;
                previous = width;
              }
              throw new Error('Real-v1 play container never settled');
            };
            await settle();

            for (const [role, type] of [
              ['energy', 'Energy'],
              ['trainerTool', 'Trainer'],
            ] as const) {
              const card = await make(role, type);
              byRole.set(role, card);
              await play(
                card,
                mixedZone,
                mixed.array.findIndex((entry) => entry.name === 'base')
              );
            }
            const controlBase = await make('controlBase', 'Pokémon');
            byRole.set('controlBase', controlBase);
            await play(controlBase, controlZone, -1);
            await settle();

            const numeric = (value: string) =>
              value === '' ? null : (Number.parseFloat(value) ?? null);
            const domOrder = [...container().querySelectorAll('img')];
            const controlDom = [
              ...(
                controlBase.image.parentElement as HTMLElement
              ).querySelectorAll('img'),
            ];
            const stateOf = (role: string) => {
              const card = byRole.get(role)!;
              const isControl = role === 'controlBase';
              const home = isControl ? control : mixed;
              return {
                role,
                currentCategory: card.type,
                originalCategory: card.type2 ?? null,
                left: numeric(card.image.style.left),
                z: Number.parseInt(card.image.style.zIndex, 10) || 0,
                rotation:
                  Number.parseInt(
                    card.image.style.transform.replace(/[^0-9-]/gu, ''),
                    10
                  ) || 0,
                attached: Boolean(card.image.attached),
                target: card.image.target ?? 'off',
                energyLayer: card.image.energyLayer ?? 0,
                logical: home.array.indexOf(card),
                dom: (isControl ? controlDom : domOrder).indexOf(card.image),
              };
            };

            const roleOf = (node: Element): string => {
              for (const [role, card] of byRole) {
                if (card.image === node) return role;
              }
              return 'unknown';
            };
            return {
              logicalRoles: mixed.array.map((card) => card.name),
              domRoles: domOrder.map(roleOf),
              cardState: ['base', 'energy', 'trainerTool', 'controlBase'].map(
                stateOf
              ),
              wrapperCounts: [
                mixed.element.querySelectorAll(':scope > .play-container')
                  .length,
                control.element.querySelectorAll(':scope > .play-container')
                  .length,
              ],
            };
          },
          {
            user: side === 'local' ? 'self' : 'opp',
            mixedZone: nativeCanonical.mixedZone,
          }
        )
    );

    // Logical and DOM order disagree: the Energy is second in the array and
    // last in the container.
    expect(capture.logicalRoles, `${side} logical order`).toEqual(
      common.logicalRoles
    );
    expect(capture.domRoles, `${side} DOM order`).toEqual(common.domRoles);

    for (const recorded of common.cardState) {
      const actual = capture.cardState.find(
        (entry) => entry.role === recorded.role
      );
      expect(actual, `${side} ${recorded.role} measured`).toBeDefined();
      // `left` is compared only where this block and the native path agree;
      // see the note above for the two attachments.
      const comparesLeft = !actual!.attached;
      expect(
        {
          currentCategory: actual!.currentCategory,
          ...(comparesLeft ? { left: actual!.left } : {}),
          z: actual!.z,
          rotation: actual!.rotation,
          attached: actual!.attached,
          target: actual!.target,
          energyLayer: actual!.energyLayer,
          logical: actual!.logical,
          dom: actual!.dom,
        },
        `${side} ${recorded.role} state`
      ).toEqual({
        currentCategory: recorded.currentCategory,
        ...(comparesLeft ? { left: recorded.left } : {}),
        z: recorded.z,
        rotation: recorded.rotation,
        attached: recorded.attached,
        target: recorded.target,
        energyLayer: recorded.energyLayer,
        logical: recorded.logical,
        dom: recorded.dom,
      });
    }

    // Only the cards played into a slot carry an original category.
    expect(
      capture.cardState.map((entry) => entry.originalCategory),
      `${side} original categories`
    ).toEqual(nativeCanonical.originalCategories);

    expect(capture.wrapperCounts, `${side} wrapper counts`).toEqual(
      nativeCanonical.wrapperCounts
    );
  });
}
