import type { MessageDescriptor } from '@lingui/core';
import { msg, plural, select } from '@lingui/core/macro';
import type { MatchViewState } from '@ptcgsim/game-core';
import type { PresentationEvent, ServerMessage } from '@ptcgsim/protocol';

import type {
  PresentationMessage,
  PresentationValue,
} from './presentation-message.js';

export type ChatMessage = Extract<ServerMessage, { type: 'ChatMessage' }>;
export type PresenceMessage = Extract<ServerMessage, { type: 'Presence' }>;
type PresentationEventType =
  PresentationEvent['type'] | ChatMessage['type'] | PresenceMessage['type'];

interface PresentationEffectBase {
  /** Chat uses the locally observed live revision; it is still not replayed. */
  readonly revision: number;
  readonly eventType: PresentationEventType;
}

export interface ActivityPresentationEffect extends PresentationEffectBase {
  readonly kind: 'activity';
  readonly category: 'player' | 'announcement' | 'message' | 'spectator';
  /** Worded when shown (presentationText), in the page's language then. */
  readonly message: PresentationMessage;
  /** Used only for existing blue/red visual treatment, never message content. */
  readonly playerId?: string;
}

export interface AccessibilityPresentationEffect extends PresentationEffectBase {
  readonly kind: 'accessibility';
  /** Worded when announced. */
  readonly message: PresentationMessage;
  readonly politeness: 'polite';
}

export interface AnimationPresentationEffect extends PresentationEffectBase {
  readonly kind: 'animation';
  readonly eventType: 'CoinFlipped';
  readonly animation: {
    readonly kind: 'coinFlip';
    readonly playerId: string;
    /** The face it lands on: the last coin's of several. */
    readonly result: 'heads' | 'tails';
    /** Several coins at once: each, in the order thrown. */
    readonly results?: readonly ('heads' | 'tails')[];
    /** Thrown until one landed tails, rather than so many. */
    readonly untilTails?: true;
  };
}

export type PresentationEffect =
  | ActivityPresentationEffect
  | AccessibilityPresentationEffect
  | AnimationPresentationEffect;

export interface PresentationEffectAdapters {
  readonly appendActivity?: (effect: ActivityPresentationEffect) => void;
  readonly announceAccessibility?: (
    effect: AccessibilityPresentationEffect
  ) => void;
  readonly presentAnimation?: (effect: AnimationPresentationEffect) => void;
}

export type PresentationEffectFailureReporter = (
  error: unknown,
  effect: PresentationEffect,
  event: PresentationEvent
) => void;

export type ChatPresentationEffectFailureReporter = (
  error: unknown,
  effect: PresentationEffect,
  message: ChatMessage
) => void;

export type PresencePresentationEffectFailureReporter = (
  error: unknown,
  effect: PresentationEffect,
  message: PresenceMessage
) => void;

export type PresentationEventSink = (event: PresentationEvent) => void;

export type PresentationView = Pick<MatchViewState, 'players'>;

/** A macro's descriptor, whose values are the names, counts and keys put in. */
const line = (message: MessageDescriptor): PresentationMessage =>
  message as PresentationMessage;

/**
 * A player's projected name, or the word for a player when the name is
 * blank. Opaque player IDs are routing metadata, never a label.
 */
const playerName = (
  view: PresentationView | undefined,
  playerId: string
): PresentationValue => {
  const displayName = view?.players[playerId]?.displayName.trim();
  return displayName
    ? displayName
    : line(
        msg({
          message: 'Player',
          context: 'a player with no name',
          comment:
            "Stands in a Log line for a player's name when they have none.",
        })
      );
};

/**
 * A card's public name, or the word v1 prints for a card the reader may not
 * see ("moved card from hand to deck").
 */
const narratedCardName = (cardName: string | undefined): PresentationValue =>
  cardName ??
  line(
    msg({
      message: 'card',
      context: 'a hidden card in a Log line',
      comment:
        'Stands in a Log line for a card\'s name when the reader may not see the card, as in "Ash moved card from hand to deck". Lowercase, no article.',
    })
  );

/**
 * The cards a group's line was about, by name in order ("Fire Energy,
 * Switch"), then how many went unnamed (face down); nothing when none
 * was named. Each language joins the names its own way.
 */
const namedCards = (
  names: readonly (string | null)[] | undefined
): PresentationValue | undefined => {
  const known = (names ?? []).filter((name): name is string => name !== null);
  if (known.length === 0) return undefined;
  const unnamed = names!.length - known.length;
  const items: PresentationValue[] = [...known];
  if (unnamed > 0) {
    items.push(
      line(
        msg({
          message: `${plural(unnamed, {
            one: '# other card',
            other: '# other cards',
          })}`,
          comment:
            'Ends the list of card names in a Log line: how many more cards went unnamed, being face down.',
        })
      )
    );
  }
  return items.reduce((list, item) =>
    line(
      msg({
        message: `${list}, ${item}`,
        context: 'a list of card names in a Log line',
        comment:
          'Adds one card name to a list in a Log line: "Fire Energy, Switch". {list} is the names so far, {item} the next. Use the list separator of your language.',
      })
    )
  );
};

/**
 * Several coins thrown at once, each face in order, then how many came up
 * heads: "Ash flipped 3 coins: heads, tails, heads (2 heads)", or "Ash
 * flipped until tails: heads, heads, tails (2 heads)".
 */
const coinSeriesLine = (
  name: PresentationValue,
  results: readonly ('heads' | 'tails')[],
  untilTails: boolean
): MessageDescriptor => {
  const faces = results
    .map((face): PresentationValue =>
      line(
        msg({
          message: `${select(face, { heads: 'heads', other: 'tails' })}`,
          context: 'a coin face in a list of coin flips',
          comment:
            'One coin\'s face in a Log line listing several flips: "heads" or "tails", lowercase.',
        })
      )
    )
    .reduce((list, item) =>
      line(
        msg({
          message: `${list}, ${item}`,
          context: 'a list of coin faces in a Log line',
          comment:
            'Adds one coin face to a list in a Log line: "heads, tails". {list} is the faces so far, {item} the next. Use the list separator of your language.',
        })
      )
    );
  const heads = results.filter((face) => face === 'heads').length;
  const count = results.length;
  return untilTails
    ? msg({
        message: `${name} flipped until tails: ${faces} (${plural(heads, {
          one: '# heads',
          other: '# heads',
        })})`,
        comment:
          'Log line: a player flipped coins one after another until one landed tails. {name} is a player\'s name, {faces} the faces in order ("heads, heads, tails"), then how many came up heads.',
      })
    : msg({
        message: `${name} flipped ${plural(count, {
          one: '# coin',
          other: '# coins',
        })}: ${faces} (${plural(heads, { one: '# heads', other: '# heads' })})`,
        comment:
          'Log line: a player flipped several coins at once. {name} is a player\'s name, then how many coins, {faces} the faces in order ("heads, tails, heads"), then how many came up heads.',
      });
};

/** A line about several cards, then the cards by name where they were seen. */
const withCardNames = (
  message: MessageDescriptor,
  names: readonly (string | null)[] | undefined
): MessageDescriptor => {
  const cards = namedCards(names);
  if (cards === undefined) return message;
  const said = line(message);
  return msg({
    message: `${said}: ${cards}`,
    comment:
      'Log line: a line about several cards, then their names. {said} is the line ("Ash moved 3 cards from hand to discard"), {cards} the names.',
  });
};

/** The four card kinds, as select keys (ICU keys are plain words). */
const categoryKey = (
  category: Extract<
    PresentationEvent,
    { readonly type: 'CardCategoryChanged' }
  >['category']
): 'energy' | 'pokemon' | 'trainer' | 'unknown' =>
  category === 'Energy'
    ? 'energy'
    : category === 'Pokémon'
      ? 'pokemon'
      : category === 'Trainer'
        ? 'trainer'
        : 'unknown';

const playerEffects = (
  event: PresentationEvent,
  playerId: string,
  message: MessageDescriptor
): readonly PresentationEffect[] => [
  activity(event, 'player', message, playerId),
  accessibility(event, message),
];

const activity = (
  event: PresentationEvent,
  category: ActivityPresentationEffect['category'],
  message: MessageDescriptor,
  playerId?: string
): ActivityPresentationEffect => ({
  kind: 'activity',
  revision: event.revision,
  eventType: event.type,
  category,
  message: line(message),
  ...(playerId ? { playerId } : {}),
});

const accessibility = (
  event: PresentationEvent,
  message: MessageDescriptor
): AccessibilityPresentationEffect => ({
  kind: 'accessibility',
  revision: event.revision,
  eventType: event.type,
  message: line(message),
  politeness: 'polite',
});

/**
 * The lines for one card moving (v1's grammar). `source` and `target` are
 * zone keys worded by each message's select, so a language can give each
 * zone the form its sentence needs; `inspection` (the deck viewer) and an
 * unnamed destination read as the deck, as in v1.
 */
const cardMovedMessage = (
  event: Extract<PresentationEvent, { readonly type: 'CardMoved' }>,
  view: PresentationView | undefined
): MessageDescriptor => {
  const actor = playerName(view, event.playerId);
  const card = narratedCardName(event.cardName);
  const source = event.source;
  const target = event.destination ?? 'deck';
  const targetCard = event.targetCardName;
  switch (event.verb) {
    case 'moved':
      // A Pokémon that changed boards: whose board it went to.
      if (event.destinationPlayerId !== undefined && targetCard === undefined) {
        const boardOwner = playerName(view, event.destinationPlayerId);
        return msg({
          message: `${actor} moved ${card} from ${select(source, {
            hand: 'hand',
            prizes: 'prizes',
            discard: 'discard',
            board: 'board',
            stadium: 'stadium',
            active: 'active',
            bench: 'bench',
            lostZone: 'lost zone',
            attachmentResolution: 'attached cards',
            other: 'deck',
          })} to ${boardOwner}'s ${select(target, {
            hand: 'hand',
            prizes: 'prizes',
            discard: 'discard',
            board: 'board',
            stadium: 'stadium',
            active: 'active',
            bench: 'bench',
            lostZone: 'lost zone',
            attachmentResolution: 'attached cards',
            other: 'deck',
          })}`,
          comment:
            "Log line for a Pokémon moved onto another player's side of the table. {actor} is the card owner's name, {card} a card's name, {boardOwner} the name of the player whose Active or Bench it went to; {source} is the spot it left and {target} the spot it went to.",
        });
      }
      return targetCard !== undefined
        ? msg({
            message: `${actor} moved ${card} from ${select(source, {
              hand: 'hand',
              prizes: 'prizes',
              discard: 'discard',
              board: 'board',
              stadium: 'stadium',
              active: 'active',
              bench: 'bench',
              lostZone: 'lost zone',
              attachmentResolution: 'attached cards',
              other: 'deck',
            })} to ${targetCard}`,
            comment:
              "Log line. {actor} is a player's name, {card} and {targetCard} card names; {source} is the zone the card left.",
          })
        : msg({
            message: `${actor} moved ${card} from ${select(source, {
              hand: 'hand',
              prizes: 'prizes',
              discard: 'discard',
              board: 'board',
              stadium: 'stadium',
              active: 'active',
              bench: 'bench',
              lostZone: 'lost zone',
              attachmentResolution: 'attached cards',
              other: 'deck',
            })} to ${select(target, {
              hand: 'hand',
              prizes: 'prizes',
              discard: 'discard',
              board: 'board',
              stadium: 'stadium',
              active: 'active',
              bench: 'bench',
              lostZone: 'lost zone',
              attachmentResolution: 'attached cards',
              other: 'deck',
            })}`,
            comment:
              "Log line. {actor} is a player's name, {card} a card's name; {source} is the zone the card left and {target} the zone it went to.",
          });
    case 'attached':
      return targetCard !== undefined
        ? msg({
            message: `${actor} attached ${card} from ${select(source, {
              hand: 'hand',
              prizes: 'prizes',
              discard: 'discard',
              board: 'board',
              stadium: 'stadium',
              active: 'active',
              bench: 'bench',
              lostZone: 'lost zone',
              attachmentResolution: 'attached cards',
              other: 'deck',
            })} to ${targetCard}`,
            comment:
              "Log line. {actor} is a player's name; {card} is the card attached (Energy, a Tool) and {targetCard} the Pokémon it went on; {source} is the zone it came from.",
          })
        : msg({
            message: `${actor} attached ${card} from ${select(source, {
              hand: 'hand',
              prizes: 'prizes',
              discard: 'discard',
              board: 'board',
              stadium: 'stadium',
              active: 'active',
              bench: 'bench',
              lostZone: 'lost zone',
              attachmentResolution: 'attached cards',
              other: 'deck',
            })} to ${select(target, {
              hand: 'hand',
              prizes: 'prizes',
              discard: 'discard',
              board: 'board',
              stadium: 'stadium',
              active: 'active',
              bench: 'bench',
              lostZone: 'lost zone',
              attachmentResolution: 'attached cards',
              other: 'deck',
            })}`,
            comment:
              "Log line. {actor} is a player's name, {card} the card attached; {source} is the zone it came from and {target} where it went.",
          });
    case 'evolved':
      return targetCard !== undefined
        ? msg({
            message: `${actor} evolved ${targetCard} into ${card}`,
            comment:
              "Log line. {actor} is a player's name; {targetCard} is the Pokémon that evolved and {card} what it evolved into.",
          })
        : msg({
            message: `${actor} evolved ${select(target, {
              hand: 'hand',
              prizes: 'prizes',
              discard: 'discard',
              board: 'board',
              stadium: 'stadium',
              active: 'active',
              bench: 'bench',
              lostZone: 'lost zone',
              attachmentResolution: 'attached cards',
              other: 'deck',
            })} into ${card}`,
            comment:
              "Log line. {actor} is a player's name, {card} the card it evolved into; {target} names the zone of the Pokémon that evolved, when its name is hidden.",
          });
    case 'shuffledIntoDeck':
      return msg({
        message: `${actor} shuffled ${card} from ${select(source, {
          hand: 'hand',
          prizes: 'prizes',
          discard: 'discard',
          board: 'board',
          stadium: 'stadium',
          active: 'active',
          bench: 'bench',
          lostZone: 'lost zone',
          attachmentResolution: 'attached cards',
          other: 'deck',
        })} into deck`,
        comment:
          "Log line. {actor} is a player's name, {card} a card's name; {source} is the zone the card left.",
      });
    case 'movedToDeckTop':
      return msg({
        message: `${actor} moved ${card} from ${select(source, {
          hand: 'hand',
          prizes: 'prizes',
          discard: 'discard',
          board: 'board',
          stadium: 'stadium',
          active: 'active',
          bench: 'bench',
          lostZone: 'lost zone',
          attachmentResolution: 'attached cards',
          other: 'deck',
        })} to top of deck`,
        comment:
          "Log line. {actor} is a player's name, {card} a card's name; {source} is the zone the card left.",
      });
    case 'movedToDeckBottom':
      return msg({
        message: `${actor} moved ${card} from ${select(source, {
          hand: 'hand',
          prizes: 'prizes',
          discard: 'discard',
          board: 'board',
          stadium: 'stadium',
          active: 'active',
          bench: 'bench',
          lostZone: 'lost zone',
          attachmentResolution: 'attached cards',
          other: 'deck',
        })} to bottom of deck`,
        comment:
          "Log line. {actor} is a player's name, {card} a card's name; {source} is the zone the card left.",
      });
    case 'switchedWithDeckTop':
      return msg({
        message: `${actor} switched ${card} from ${select(source, {
          hand: 'hand',
          prizes: 'prizes',
          discard: 'discard',
          board: 'board',
          stadium: 'stadium',
          active: 'active',
          bench: 'bench',
          lostZone: 'lost zone',
          attachmentResolution: 'attached cards',
          other: 'deck',
        })} with top of deck`,
        comment:
          "Log line. {actor} is a player's name, {card} a card's name; {source} is the zone the card left, and the top card of the deck took its place.",
      });
  }
};

/** The line for several cards moving at once ("moved 3 cards from …"). */
const cardsResolvedMessage = (
  event: Extract<PresentationEvent, { readonly type: 'CardsResolved' }>,
  view: PresentationView | undefined
): MessageDescriptor => {
  const actor = playerName(view, event.playerId);
  const count = event.cardCount;
  const source = event.source;
  const destination = event.destination;
  switch (event.verb) {
    case 'left':
      return msg({
        message: `${actor} left ${plural(count, {
          one: '# attached card',
          other: '# attached cards',
        })} in play`,
        comment:
          "Log line: a player kept the cards attached to a Pokémon on the table. {actor} is a player's name, {count} how many cards.",
      });
    case 'discarded':
      return source === 'attachmentResolution'
        ? msg({
            message: `${actor} discarded ${plural(count, {
              one: '# attached card',
              other: '# attached cards',
            })}`,
            comment:
              "Log line: a player discarded the cards attached to a Pokémon. {actor} is a player's name, {count} how many cards.",
          })
        : msg({
            message: `${actor} discarded ${plural(count, {
              one: '# card',
              other: '# cards',
            })}`,
            comment:
              "Log line. {actor} is a player's name, {count} how many cards.",
          });
    case 'shuffled':
      if (destination === 'deckBottom') {
        return source === 'prizes'
          ? msg({
              message: `${actor} shuffled prizes to bottom of deck`,
              comment: "Log line. {actor} is a player's name.",
            })
          : msg({
              message: `${actor} shuffled ${plural(count, {
                one: '# card',
                other: '# cards',
              })} to bottom of deck`,
              comment:
                "Log line. {actor} is a player's name, {count} how many cards.",
            });
      }
      return source === 'discard'
        ? msg({
            message: `${actor} shuffled discard into deck`,
            comment:
              "Log line: a player shuffled their discard pile into their deck. {actor} is a player's name.",
          })
        : source === 'attachmentResolution'
          ? msg({
              message: `${actor} shuffled ${plural(count, {
                one: '# attached card',
                other: '# attached cards',
              })} into deck`,
              comment:
                "Log line: a player shuffled the cards attached to a Pokémon into their deck. {actor} is a player's name, {count} how many cards.",
            })
          : source === 'board'
            ? msg({
                message: `${actor} shuffled ${plural(count, {
                  one: '# card',
                  other: '# cards',
                })} from board to deck`,
                comment:
                  "Log line. {actor} is a player's name, {count} how many cards.",
              })
            : msg({
                message: `${actor} shuffled ${plural(count, {
                  one: '# card',
                  other: '# cards',
                })} into deck`,
                comment:
                  "Log line. {actor} is a player's name, {count} how many cards.",
              });
    case 'moved':
      return msg({
        message: `${actor} moved ${plural(count, {
          one: '# card',
          other: '# cards',
        })} from ${select(source, {
          hand: 'hand',
          prizes: 'prizes',
          discard: 'discard',
          board: 'board',
          stadium: 'stadium',
          active: 'active',
          bench: 'bench',
          lostZone: 'lost zone',
          attachmentResolution: 'attached cards',
          other: 'deck',
        })} to ${select(destination, {
          hand: 'hand',
          discard: 'discard',
          lostZone: 'lost zone',
          deckBottom: 'bottom of deck',
          play: 'play',
          prizes: 'prizes',
          board: 'board',
          other: 'deck',
        })}`,
        comment:
          "Log line. {actor} is a player's name, {count} how many cards; {source} is the zone they left and {destination} where they went (play: onto the table).",
      });
  }
};

/** A player's whole hand going away, and what they drew instead. */
const handReplacedMessage = (
  event: Extract<PresentationEvent, { readonly type: 'HandReplaced' }>,
  view: PresentationView | undefined
): MessageDescriptor => {
  const actor = playerName(view, event.playerId);
  const count = event.drawCount;
  const drew = count > 0;
  switch (event.mode) {
    case 'discard':
      return drew
        ? msg({
            message: `${actor} discarded hand and drew ${plural(count, {
              one: '# card',
              other: '# cards',
            })}`,
            comment:
              "Log line. {actor} is a player's name, {count} how many cards they drew.",
          })
        : msg({
            message: `${actor} discarded hand`,
            comment: "Log line. {actor} is a player's name.",
          });
    case 'shuffleIntoDeck':
      return drew
        ? msg({
            message: `${actor} shuffled hand into deck and drew ${plural(
              count,
              { one: '# card', other: '# cards' }
            )}`,
            comment:
              "Log line. {actor} is a player's name, {count} how many cards they drew.",
          })
        : msg({
            message: `${actor} shuffled hand into deck`,
            comment: "Log line. {actor} is a player's name.",
          });
    case 'shuffleToDeckBottom':
      return drew
        ? msg({
            message: `${actor} shuffled hand to bottom of deck and drew ${plural(
              count,
              { one: '# card', other: '# cards' }
            )}`,
            comment:
              "Log line. {actor} is a player's name, {count} how many cards they drew.",
          })
        : msg({
            message: `${actor} shuffled hand to bottom of deck`,
            comment: "Log line. {actor} is a player's name.",
          });
  }
};

/**
 * Pure exhaustive mapping from a recipient-safe fact to local-only UI effects.
 * Lines are messages, worded when shown; they use projected display names
 * and never fall back to opaque IDs.
 */
export const presentationEffectsForEvent = (
  event: PresentationEvent,
  view?: PresentationView
): readonly PresentationEffect[] => {
  switch (event.type) {
    case 'CardMoved':
      return playerEffects(
        event,
        event.playerId,
        cardMovedMessage(event, view)
      );
    case 'CardsDrawn': {
      const name = playerName(view, event.playerId);
      const count = event.cardCount;
      return playerEffects(
        event,
        event.playerId,
        msg({
          message: `${name} drew ${plural(count, {
            one: 'a card',
            other: '# cards',
          })}`,
          comment:
            "Log line. {name} is a player's name, {count} how many cards they drew.",
        })
      );
    }
    case 'ZoneShuffled': {
      const name = playerName(view, event.playerId);
      const source = event.source;
      return playerEffects(
        event,
        event.playerId,
        msg({
          message: `${name} shuffled ${select(source, {
            hand: 'hand',
            prizes: 'prizes',
            discard: 'discard',
            board: 'board',
            stadium: 'stadium',
            active: 'active',
            bench: 'bench',
            lostZone: 'lost zone',
            attachmentResolution: 'attached cards',
            other: 'deck',
          })}`,
          comment:
            "Log line. {name} is a player's name; {source} is the zone they shuffled, almost always their deck.",
        })
      );
    }
    case 'DeckCardsLooked': {
      const name = playerName(view, event.playerId);
      const count = event.cardCount;
      return playerEffects(
        event,
        event.playerId,
        event.edge === 'top'
          ? msg({
              message: `${name} looked at top ${plural(count, {
                one: '# card',
                other: '# cards',
              })} of deck`,
              comment:
                "Log line. {name} is a player's name, {count} how many cards from the top of their deck they looked at.",
            })
          : msg({
              message: `${name} looked at bottom ${plural(count, {
                one: '# card',
                other: '# cards',
              })} of deck`,
              comment:
                "Log line. {name} is a player's name, {count} how many cards from the bottom of their deck they looked at.",
            })
      );
    }
    case 'CardsResolved':
      return playerEffects(
        event,
        event.playerId,
        withCardNames(cardsResolvedMessage(event, view), event.cardNames)
      );
    case 'HandReplaced':
      return playerEffects(
        event,
        event.playerId,
        handReplacedMessage(event, view)
      );
    case 'CardCategoryChanged': {
      const name = playerName(view, event.playerId);
      const card = narratedCardName(event.cardName);
      const category = categoryKey(event.category);
      return playerEffects(
        event,
        event.playerId,
        msg({
          message: `${name} changed ${card} into ${select(category, {
            energy: 'an energy',
            pokemon: 'a Pokémon',
            trainer: 'a tool',
            other: 'an unknown type',
          })}`,
          comment:
            "Log line: a player made a card count as another kind of card. {name} is a player's name, {card} a card's name; {category} is the kind it now counts as.",
        })
      );
    }
    case 'AbilityUsed': {
      const name = playerName(view, event.playerId);
      const card = narratedCardName(event.cardName);
      return playerEffects(
        event,
        event.playerId,
        event.source === 'stadium'
          ? msg({
              message: `${name} used ${card}`,
              comment:
                "Log line: a player used a Stadium card's effect. {name} is a player's name, {card} the Stadium's name.",
            })
          : msg({
              message: `${name} used ${card}'s ability`,
              comment:
                "Log line: a player used a Pokémon's Ability. {name} is a player's name, {card} the Pokémon's name.",
            })
      );
    }
    case 'ReminderSet': {
      const name = playerName(view, event.playerId);
      const card = narratedCardName(event.cardName);
      const reminder = event.reminder;
      return playerEffects(
        event,
        event.playerId,
        event.on
          ? msg({
              message: `${name} put a reminder on ${card}: ${select(reminder, {
                cantAttack: "can't attack",
                cantRetreat: "can't retreat",
                takesLess: 'takes less damage',
                hitsHarder: 'attacks do more',
                other: 'no Abilities',
              })}`,
              comment:
                "Log line: a player put a reminder of a lasting effect on a Pokémon. {name} is a player's name, {card} the Pokémon's name; {reminder} is what the reminder says.",
            })
          : msg({
              message: `${name} took the reminder off ${card}: ${select(
                reminder,
                {
                  cantAttack: "can't attack",
                  cantRetreat: "can't retreat",
                  takesLess: 'takes less damage',
                  hitsHarder: 'attacks do more',
                  other: 'no Abilities',
                }
              )}`,
              comment:
                "Log line: a player took the reminder of a lasting effect off a Pokémon. {name} is a player's name, {card} the Pokémon's name; {reminder} is what the reminder said.",
            })
      );
    }
    case 'CoinFlipped': {
      const name = playerName(view, event.playerId);
      const result = event.result;
      const message = event.results
        ? coinSeriesLine(name, event.results, event.untilTails === true)
        : msg({
            message: `${name} flipped ${select(result, {
              heads: 'heads',
              other: 'tails',
            })}`,
            comment:
              "Log line: a coin flip's result. {name} is a player's name; {result} is heads or tails.",
          });
      return [
        activity(event, 'player', message, event.playerId),
        accessibility(event, message),
        {
          kind: 'animation',
          revision: event.revision,
          eventType: event.type,
          animation: {
            kind: 'coinFlip',
            playerId: event.playerId,
            result: event.result,
            ...(event.results ? { results: event.results } : {}),
            ...(event.untilTails ? { untilTails: true } : {}),
          },
        },
      ];
    }
    case 'PlayerReset': {
      const name = playerName(view, event.playerId);
      const message = msg({
        message: `${name} reset`,
        comment:
          "Log line: a player cleared their side of the table. {name} is a player's name.",
      });
      return [
        activity(event, 'player', message, event.playerId),
        accessibility(event, message),
      ];
    }
    case 'DeckLoaded': {
      const name = playerName(view, event.playerId);
      const message = msg({
        message: `${name} loaded deck`,
        comment: "Log line. {name} is a player's name.",
      });
      return [
        activity(event, 'announcement', message),
        accessibility(event, message),
      ];
    }
    case 'PlayerSetup': {
      const name = playerName(view, event.playerId);
      // Set Up with no deck loaded still resets the board, but there is
      // nothing to draw. v1 announces that ("has an invalid deck!") rather
      // than claiming a hand was drawn.
      if (event.handCount === 0 && event.prizeCount === 0) {
        const message = msg({
          message: `${name} has no deck loaded`,
          comment:
            "Log line: a player pressed Set up without a deck. {name} is a player's name.",
        });
        return [
          activity(event, 'announcement', message),
          accessibility(event, message),
        ];
      }
      const message = msg({
        message: `${name} drew starting hand and set prizes`,
        comment:
          "Log line: a player set up for a game (seven cards in hand, Prize cards laid out). {name} is a player's name.",
      });
      return [
        activity(event, 'player', message, event.playerId),
        accessibility(event, message),
      ];
    }
    case 'RandomCardPlayedFaceDown': {
      const actor = playerName(view, event.actorPlayerId);
      const target = playerName(view, event.targetPlayerId);
      const message = msg({
        message: `${actor} moved a random card from ${target}'s hand to board`,
        comment:
          'Log line. {actor} is the player who moved the card, {target} the player whose hand it came from.',
      });
      return [
        activity(event, 'player', message, event.actorPlayerId),
        accessibility(event, message),
      ];
    }
    case 'TurnStarted': {
      const name = playerName(view, event.playerId);
      const turn = event.turnNumber;
      return [
        activity(
          event,
          'announcement',
          msg({
            message: `Turn ${turn}`,
            comment:
              'The Log\'s divider at the start of a turn. {turn} is the turn number, as in "Turn 3".',
          })
        ),
        activity(
          event,
          'player',
          msg({
            message: `${name} drew for turn`,
            comment:
              "Log line: the player whose turn begins drew their card for the turn. {name} is a player's name.",
          }),
          event.playerId
        ),
        accessibility(
          event,
          msg({
            message: `${name} started turn ${turn}`,
            comment:
              "Read aloud by screen readers. {name} is a player's name, {turn} the turn number.",
          })
        ),
      ];
    }
    case 'TurnStartFailedNoDeck': {
      const name = playerName(view, event.playerId);
      const message = msg({
        message: `${name} has no cards left to draw`,
        comment:
          "Log line: a turn began and the player's deck was empty. {name} is a player's name.",
      });
      return [
        activity(event, 'announcement', message),
        accessibility(event, message),
      ];
    }
    case 'AttackDeclared': {
      const name = playerName(view, event.playerId);
      const message = msg({
        message: `${name} attacked`,
        comment: "Log line. {name} is a player's name.",
      });
      return [
        activity(event, 'player', message, event.playerId),
        accessibility(event, message),
      ];
    }
    case 'PassDeclared': {
      const name = playerName(view, event.playerId);
      const message = msg({
        message: `${name} passed`,
        comment:
          "Log line: a player ended their turn without attacking. {name} is a player's name.",
      });
      return [
        activity(event, 'player', message, event.playerId),
        accessibility(event, message),
      ];
    }
    case 'PublicCardsRevealed': {
      const actor = playerName(view, event.actorPlayerId);
      const owner = playerName(view, event.playerId);
      const card = narratedCardName(event.cardName);
      const source = event.source;
      const message =
        event.scope === 'zone'
          ? msg({
              message: `${actor} revealed ${owner}'s ${select(source, {
                hand: 'hand',
                prizes: 'prizes',
                discard: 'discard',
                board: 'board',
                stadium: 'stadium',
                active: 'active',
                bench: 'bench',
                lostZone: 'lost zone',
                attachmentResolution: 'attached cards',
                inspection: 'inspection',
                other: 'deck',
              })}`,
              comment:
                'Log line: a player showed a whole zone to everyone. {actor} is who showed it, {owner} whose zone it is; {source} is the zone.',
            })
          : event.cardCount > 1
            ? withCardNames(
                msg({
                  message: `${actor} revealed ${plural(event.cardCount, {
                    one: '# card',
                    other: '# cards',
                  })} in ${owner}'s ${select(source, {
                    hand: 'hand',
                    prizes: 'prizes',
                    discard: 'discard',
                    board: 'board',
                    stadium: 'stadium',
                    active: 'active',
                    bench: 'bench',
                    lostZone: 'lost zone',
                    attachmentResolution: 'attached cards',
                    inspection: 'inspection',
                    other: 'deck',
                  })}`,
                  comment:
                    'Log line: a player showed several cards to everyone at once. {actor} is who showed them, {owner} whose cards they are, {count} how many; {source} is the zone they are in.',
                }),
                event.cardNames
              )
            : msg({
                message: `${actor} revealed ${card} in ${owner}'s ${select(
                  source,
                  {
                    hand: 'hand',
                    prizes: 'prizes',
                    discard: 'discard',
                    board: 'board',
                    stadium: 'stadium',
                    active: 'active',
                    bench: 'bench',
                    lostZone: 'lost zone',
                    attachmentResolution: 'attached cards',
                    inspection: 'inspection',
                    other: 'deck',
                  }
                )}`,
                comment:
                  "Log line: a player showed one card to everyone. {actor} is who showed it, {owner} whose card it is, {card} the card's name; {source} is the zone it is in.",
              });
      return [
        activity(event, 'player', message, event.actorPlayerId),
        accessibility(event, message),
      ];
    }
    case 'PublicCardsHidden': {
      const actor = playerName(view, event.actorPlayerId);
      const owner = playerName(view, event.playerId);
      const source = event.source;
      const message =
        event.scope === 'zone'
          ? msg({
              message: `${actor} hid ${owner}'s ${select(source, {
                hand: 'hand',
                prizes: 'prizes',
                discard: 'discard',
                board: 'board',
                stadium: 'stadium',
                active: 'active',
                bench: 'bench',
                lostZone: 'lost zone',
                attachmentResolution: 'attached cards',
                inspection: 'inspection',
                other: 'deck',
              })}`,
              comment:
                'Log line: a player hid a zone they had shown to everyone. {actor} is who hid it, {owner} whose zone it is; {source} is the zone.',
            })
          : event.cardCount > 1
            ? msg({
                message: `${actor} hid ${plural(event.cardCount, {
                  one: '# card',
                  other: '# cards',
                })} in ${owner}'s ${select(source, {
                  hand: 'hand',
                  prizes: 'prizes',
                  discard: 'discard',
                  board: 'board',
                  stadium: 'stadium',
                  active: 'active',
                  bench: 'bench',
                  lostZone: 'lost zone',
                  attachmentResolution: 'attached cards',
                  inspection: 'inspection',
                  other: 'deck',
                })}`,
                comment:
                  'Log line: a player hid several cards they had shown to everyone. {actor} is who hid them, {owner} whose cards they are, {count} how many; {source} is the zone they are in.',
              })
            : msg({
                message: `${actor} hid card in ${owner}'s ${select(source, {
                  hand: 'hand',
                  prizes: 'prizes',
                  discard: 'discard',
                  board: 'board',
                  stadium: 'stadium',
                  active: 'active',
                  bench: 'bench',
                  lostZone: 'lost zone',
                  attachmentResolution: 'attached cards',
                  inspection: 'inspection',
                  other: 'deck',
                })}`,
                comment:
                  'Log line: a player hid a card they had shown to everyone. {actor} is who hid it, {owner} whose card it is; {source} is the zone it is in.',
              });
      return [
        activity(event, 'player', message, event.actorPlayerId),
        accessibility(event, message),
      ];
    }
    case 'PrivateInspectionStarted': {
      const viewer = playerName(view, event.viewerPlayerId);
      const owner = playerName(view, event.sourcePlayerId);
      const source = event.source;
      const message =
        event.scope === 'zone'
          ? msg({
              message: `${viewer} looked at ${owner}'s ${select(source, {
                hand: 'hand',
                prizes: 'prizes',
                discard: 'discard',
                board: 'board',
                stadium: 'stadium',
                active: 'active',
                bench: 'bench',
                lostZone: 'lost zone',
                attachmentResolution: 'attached cards',
                inspection: 'inspection',
                other: 'deck',
              })}`,
              comment:
                'Log line: a player began looking at a zone only they can see. {viewer} is who is looking, {owner} whose zone it is; {source} is the zone.',
            })
          : msg({
              message: `${viewer} looked at card in ${owner}'s ${select(
                source,
                {
                  hand: 'hand',
                  prizes: 'prizes',
                  discard: 'discard',
                  board: 'board',
                  stadium: 'stadium',
                  active: 'active',
                  bench: 'bench',
                  lostZone: 'lost zone',
                  attachmentResolution: 'attached cards',
                  inspection: 'inspection',
                  other: 'deck',
                }
              )}`,
              comment:
                'Log line: a player began looking at a card only they can see. {viewer} is who is looking, {owner} whose card it is; {source} is the zone it is in.',
            });
      return [
        activity(event, 'player', message, event.viewerPlayerId),
        accessibility(event, message),
      ];
    }
    case 'PrivateInspectionEnded': {
      const viewer = playerName(view, event.viewerPlayerId);
      const owner = playerName(view, event.sourcePlayerId);
      const source = event.source;
      const message =
        event.scope === 'zone'
          ? msg({
              message: `${viewer} stopped looking at ${owner}'s ${select(
                source,
                {
                  hand: 'hand',
                  prizes: 'prizes',
                  discard: 'discard',
                  board: 'board',
                  stadium: 'stadium',
                  active: 'active',
                  bench: 'bench',
                  lostZone: 'lost zone',
                  attachmentResolution: 'attached cards',
                  inspection: 'inspection',
                  other: 'deck',
                }
              )}`,
              comment:
                'Log line. {viewer} is who stopped looking, {owner} whose zone it is; {source} is the zone.',
            })
          : msg({
              message: `${viewer} stopped looking at card in ${owner}'s ${select(
                source,
                {
                  hand: 'hand',
                  prizes: 'prizes',
                  discard: 'discard',
                  board: 'board',
                  stadium: 'stadium',
                  active: 'active',
                  bench: 'bench',
                  lostZone: 'lost zone',
                  attachmentResolution: 'attached cards',
                  inspection: 'inspection',
                  other: 'deck',
                }
              )}`,
              comment:
                'Log line. {viewer} is who stopped looking, {owner} whose card it is; {source} is the zone it is in.',
            });
      return [
        activity(event, 'player', message, event.viewerPlayerId),
        accessibility(event, message),
      ];
    }
    case 'UndoApplied': {
      const actor = playerName(view, event.actorPlayerId);
      const target = playerName(view, event.targetPlayerId);
      const message =
        event.actorPlayerId === event.targetPlayerId
          ? msg({
              message: `${target} took back their last move`,
              comment:
                "Log line: a player undid their own last move. {target} is the player's name.",
            })
          : msg({
              message: `${actor} took back ${target}'s last move`,
              comment:
                "Log line: one player undid the other's last move. {actor} is who undid it, {target} whose move it was.",
            });
      return [
        activity(event, 'announcement', message),
        accessibility(event, message),
      ];
    }
    case 'OncePerGameMarkerSet': {
      const name = playerName(view, event.playerId);
      const marker = event.marker === 'gx' ? 'GX' : 'VSTAR';
      const message = event.used
        ? msg({
            message: `${name} used their ${marker}`,
            comment:
              "Log line: a player used their once-per-game power. {name} is a player's name; {marker} is GX or VSTAR (keep as is).",
          })
        : msg({
            message: `${name} reset their ${marker}`,
            comment:
              "Log line: a player turned their once-per-game marker back to unused. {name} is a player's name; {marker} is GX or VSTAR (keep as is).",
          });
      return [
        activity(event, 'player', message, event.playerId),
        accessibility(event, message),
      ];
    }
    case 'MulliganDeclared': {
      const name = playerName(view, event.playerId);
      const message = msg({
        message: `${name} mulligans`,
        comment:
          "Log line: a player had no Basic Pokémon in their opening hand and redraws. {name} is a player's name.",
      });
      return [
        activity(event, 'announcement', message),
        accessibility(event, message),
      ];
    }
    case 'DeckViewDeclared': {
      const name = playerName(view, event.playerId);
      const message = msg({
        message: `${name} is looking through ${name}'s deck`,
        comment:
          "Log line: a player is searching their own deck. {name} is the player's name (both times).",
      });
      return [
        activity(event, 'player', message, event.playerId),
        accessibility(event, message),
      ];
    }
  }
  const unhandled: never = event;
  return unhandled;
};

/** Rebuilds seekable activity state without replaying one-shot local effects. */
export const activityPresentationEffectsForEvents = (
  events: readonly PresentationEvent[],
  view?: PresentationView
): readonly ActivityPresentationEffect[] =>
  events.flatMap((event) =>
    presentationEffectsForEvent(event, view).filter(
      (effect): effect is ActivityPresentationEffect =>
        effect.kind === 'activity'
    )
  );

/**
 * Maps authenticated ephemeral chat into the same bounded local feed. What
 * was said is a value: it is shown as written, in any language.
 */
export const presentationEffectsForChatMessage = (
  message: ChatMessage,
  observedRevision = 0
): readonly PresentationEffect[] => {
  const speaker = message.displayName;
  const text = message.message;
  const visibleMessage = line(
    msg({
      message: `${speaker}: ${text}`,
      comment:
        'A chat line in the Log. {speaker} is who wrote it, {text} what they wrote (shown as written).',
    })
  );
  return [
    {
      kind: 'activity',
      revision: observedRevision,
      eventType: 'ChatMessage',
      category: message.playerId ? 'message' : 'spectator',
      message: visibleMessage,
      ...(message.playerId ? { playerId: message.playerId } : {}),
    },
    {
      kind: 'accessibility',
      revision: observedRevision,
      eventType: 'ChatMessage',
      message: visibleMessage,
      politeness: 'polite',
    },
  ];
};

/** Maps authenticated session lifecycle into the legacy announcement style. */
export const presentationEffectsForPresence = (
  presence: PresenceMessage,
  observedRevision = 0
): readonly PresentationEffect[] => {
  const name = presence.displayName;
  const message = line(
    presence.status === 'joined'
      ? msg({
          message: `${name} joined`,
          comment:
            'Log line: someone came into the room. {name} is their name.',
        })
      : presence.status === 'disconnected'
        ? msg({
            message: `${name} disconnected`,
            comment:
              "Log line: someone's connection to the room dropped. {name} is their name.",
          })
        : presence.status === 'reconnected'
          ? msg({
              message: `${name} reconnected`,
              comment:
                'Log line: someone came back after their connection dropped. {name} is their name.',
            })
          : msg({
              message: `${name} left the room`,
              comment: 'Log line. {name} is their name.',
            })
  );
  return [
    {
      kind: 'activity',
      revision: observedRevision,
      eventType: 'Presence',
      category: 'announcement',
      message,
    },
    {
      kind: 'accessibility',
      revision: observedRevision,
      eventType: 'Presence',
      message,
      politeness: 'polite',
    },
  ];
};

const deliverEffect = (
  effect: PresentationEffect,
  adapters: PresentationEffectAdapters
): void => {
  switch (effect.kind) {
    case 'activity':
      adapters.appendActivity?.(effect);
      return;
    case 'accessibility':
      adapters.announceAccessibility?.(effect);
      return;
    case 'animation':
      adapters.presentAnimation?.(effect);
      return;
  }
  const unhandled: never = effect;
  return unhandled;
};

/** Creates the same isolated sink for live publications and replay playback. */
export const createPresentationEffectSink =
  (
    getView: () => PresentationView | undefined,
    adapters: PresentationEffectAdapters,
    reportFailure: PresentationEffectFailureReporter = (error, effect) =>
      console.error('Presentation effect failed', effect, error),
    shouldDeliver: () => boolean = () => true
  ): PresentationEventSink =>
  (event) => {
    const effects = presentationEffectsForEvent(event, getView());
    for (const effect of effects) {
      if (!shouldDeliver()) return;
      try {
        deliverEffect(effect, adapters);
      } catch (error) {
        try {
          reportFailure(error, effect, event);
        } catch {
          // One diagnostics adapter cannot suppress later UI effects.
        }
      }
    }
  };

/** Creates the live-only isolated sink for authenticated ephemeral chat. */
export const createChatPresentationEffectSink =
  (
    getObservedRevision: () => number,
    adapters: PresentationEffectAdapters,
    reportFailure: ChatPresentationEffectFailureReporter = (error, effect) =>
      console.error('Chat presentation effect failed', effect, error),
    shouldDeliver: () => boolean = () => true
  ) =>
  (message: ChatMessage): void => {
    if (!shouldDeliver()) return;
    for (const effect of presentationEffectsForChatMessage(
      message,
      getObservedRevision()
    )) {
      try {
        deliverEffect(effect, adapters);
      } catch (error) {
        try {
          reportFailure(error, effect, message);
        } catch {
          // Diagnostics must not prevent later deterministic effects.
        }
      }
    }
  };

/** Creates the live-only isolated sink for authenticated presence notices. */
export const createPresencePresentationEffectSink =
  (
    getObservedRevision: () => number,
    adapters: PresentationEffectAdapters,
    reportFailure: PresencePresentationEffectFailureReporter = (
      error,
      effect
    ) => console.error('Presence presentation effect failed', effect, error),
    shouldDeliver: () => boolean = () => true
  ) =>
  (presence: PresenceMessage): void => {
    if (!shouldDeliver()) return;
    for (const effect of presentationEffectsForPresence(
      presence,
      getObservedRevision()
    )) {
      try {
        deliverEffect(effect, adapters);
      } catch (error) {
        try {
          reportFailure(error, effect, presence);
        } catch {
          // Diagnostics must not prevent later deterministic effects.
        }
      }
    }
  };
