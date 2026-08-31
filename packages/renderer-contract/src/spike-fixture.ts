import {
  asPlayerId,
  asViewCardId,
  asViewDefinitionId,
  type MatchViewState,
  type PlayerId,
  type ViewCard,
} from '@ptcgsim/game-core';

const cardImage = (index: number): string => {
  const hue = (index * 47) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="630" height="880" viewBox="0 0 630 880"><rect width="630" height="880" rx="32" fill="hsl(${hue} 52% 72%)"/><rect x="28" y="28" width="574" height="824" rx="24" fill="none" stroke="#fff" stroke-width="18"/><circle cx="315" cy="410" r="170" fill="hsl(${(hue + 80) % 360} 55% 50%)"/><text x="315" y="740" text-anchor="middle" font-family="sans-serif" font-size="72" fill="#111">${index + 1}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
};

const cardBack = (color: string): string => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="630" height="880"><rect width="630" height="880" rx="32" fill="${color}"/><circle cx="315" cy="440" r="180" fill="#fff" opacity=".8"/><circle cx="315" cy="440" r="135" fill="${color}"/><path d="M135 440h360" stroke="#111" stroke-width="28"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
};

/** A deterministic 61-card scene input shared by the DOM and Pixi spikes. */
export const createRendererSpikeView = (): MatchViewState => {
  const p1 = asPlayerId('spike-blue');
  const p2 = asPlayerId('spike-red');
  const blueBack = cardBack('#465fa7');
  const redBack = cardBack('#a7465f');
  const definitions: Record<string, MatchViewState['definitions'][string]> = {};
  let nextCard = 0;
  const known = (ownerId: PlayerId): ViewCard => {
    const index = nextCard++;
    const id = asViewCardId(`spike-card-${index}`);
    const definitionId = asViewDefinitionId(`spike-definition-${index}`);
    definitions[definitionId] = {
      id: definitionId,
      name: `Parity fixture card ${index + 1}`,
      category:
        index % 4 === 0 ? 'Pokémon' : index % 3 === 0 ? 'Energy' : 'Trainer',
      imageUrl: cardImage(index),
    };
    return {
      kind: 'known',
      id,
      definitionId,
      ownerId,
      category: definitions[definitionId]!.category,
      face: 'up',
      orientationQuarterTurns: 0,
    };
  };
  const concealed = (ownerId: PlayerId, back: string): ViewCard => ({
    kind: 'concealed',
    id: asViewCardId(`spike-card-${nextCard++}`),
    ownerId,
    cardBackUrl: back,
  });
  const many = (count: number, create: () => ViewCard): ViewCard[] =>
    Array.from({ length: count }, create);

  const zones: Record<string, MatchViewState['zones'][string]> = {};
  const zone = (
    playerId: PlayerId,
    kind: Exclude<MatchViewState['zones'][string]['kind'], 'stadium'>,
    cards: readonly ViewCard[]
  ) => {
    const id = `zone:${playerId}:${kind}`;
    zones[id] = { id, kind, ownerId: playerId, cards };
  };
  zone(
    p1,
    'hand',
    many(7, () => known(p1))
  );
  zone(
    p1,
    'prizes',
    many(6, () => concealed(p1, blueBack))
  );
  zone(
    p1,
    'board',
    many(6, () => known(p1))
  );
  zone(
    p1,
    'deck',
    many(5, () => concealed(p1, blueBack))
  );
  zone(
    p1,
    'discard',
    many(3, () => known(p1))
  );
  zone(
    p1,
    'lostZone',
    many(2, () => known(p1))
  );

  zone(
    p2,
    'hand',
    many(7, () => concealed(p2, redBack))
  );
  zone(
    p2,
    'prizes',
    many(6, () => concealed(p2, redBack))
  );
  zone(
    p2,
    'board',
    many(4, () => known(p2))
  );
  zone(
    p2,
    'deck',
    many(5, () => concealed(p2, redBack))
  );
  zone(
    p2,
    'discard',
    many(2, () => known(p2))
  );
  zone(
    p2,
    'lostZone',
    many(1, () => known(p2))
  );
  const stadium = known(p1);
  zones['zone:shared:stadium'] = {
    id: 'zone:shared:stadium',
    kind: 'stadium',
    ownerId: null,
    cards: [stadium],
  };

  const blueActive = [known(p1), known(p1), known(p1)];
  const redActive = [known(p2), known(p2), known(p2)];
  return {
    matchId: 'renderer-parity-spike',
    revision: 1,
    lifecycle: 'playing',
    viewer: { kind: 'player', playerId: p1 },
    playerOrder: [p1, p2],
    players: {
      [p1]: {
        id: p1,
        displayName: 'Blue',
        cardBackUrl: blueBack,
        coachingConsent: false,
        oncePerGame: { gxUsed: false, vstarUsed: false },
      },
      [p2]: {
        id: p2,
        displayName: 'Red',
        cardBackUrl: redBack,
        coachingConsent: false,
        oncePerGame: { gxUsed: false, vstarUsed: false },
      },
    },
    definitions,
    zones,
    boards: {
      [p1]: { activeStackId: 'stack:blue:active', benchStackIds: [] },
      [p2]: { activeStackId: 'stack:red:active', benchStackIds: [] },
    },
    stacks: {
      'stack:blue:active': {
        id: 'stack:blue:active',
        boardPlayerId: p1,
        slot: 'active',
        evolutionCards: blueActive.slice(0, 2),
        attachmentCards: blueActive.slice(2),
        rotationQuarterTurns: 0,
        damage: 120,
        specialCondition: 'Poisoned',
        abilityUsed: true,
      },
      'stack:red:active': {
        id: 'stack:red:active',
        boardPlayerId: p2,
        slot: 'active',
        evolutionCards: redActive.slice(0, 2),
        attachmentCards: redActive.slice(2),
        rotationQuarterTurns: 1,
        damage: 30,
        specialCondition: null,
        abilityUsed: false,
      },
    },
    workAreas: {
      [p1]: { inspection: null, attachmentResolution: null },
      [p2]: { inspection: null, attachmentResolution: null },
    },
    turn: { number: 4, currentPlayerId: p1 },
  };
};
