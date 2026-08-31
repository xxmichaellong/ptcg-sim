import {
  asCardInstanceId,
  asInspectionId,
  asStackId,
  asWorkAreaId,
  type CommandContext,
} from '@ptcgsim/game-core';
import type { AdmissionCrypto, OpaqueIdSource } from '@ptcgsim/room-authority';

const randomBytes = (length: number): Uint8Array => {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
};

const base64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');

const randomToken = (prefix: string, byteLength: number): string =>
  `${prefix}_${base64Url(randomBytes(byteLength))}`;

export class WebCryptoAuthoritySource
  implements AdmissionCrypto, OpaqueIdSource, CommandContext
{
  async digestCapability(capability: string): Promise<string> {
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(capability)
    );
    return base64Url(new Uint8Array(digest));
  }

  equalDigest(left: string, right: string): boolean {
    const maximum = Math.max(left.length, right.length);
    let difference = left.length ^ right.length;
    for (let index = 0; index < maximum; index += 1) {
      difference |=
        (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
    }
    return difference === 0;
  }

  nextSeatCapability(): string {
    return randomToken('seat', 32);
  }

  nextSpectatorCapability(): string {
    return randomToken('spectator', 32);
  }

  nextResumeCapability(): string {
    return randomToken('resume', 32);
  }

  nextSessionId(): string {
    return randomToken('session', 18);
  }

  nextPlayerId(): string {
    return randomToken('player', 18);
  }

  nextOpaqueId(kind: 'card' | 'definition'): string {
    return randomToken(`view_${kind}`, 18);
  }

  nextCardId() {
    return asCardInstanceId(randomToken('card', 18));
  }

  nextStackId() {
    return asStackId(randomToken('stack', 18));
  }

  nextInspectionId() {
    return asInspectionId(randomToken('inspection', 18));
  }

  nextWorkAreaId() {
    return asWorkAreaId(randomToken('work', 18));
  }

  randomInt(exclusiveMaximum: number): number {
    if (
      !Number.isSafeInteger(exclusiveMaximum) ||
      exclusiveMaximum <= 0 ||
      exclusiveMaximum > 0x1_0000_0000
    ) {
      throw new RangeError('Random upper bound must be from 1 through 2^32');
    }
    const range = 0x1_0000_0000;
    const rejectionFloor = range - (range % exclusiveMaximum);
    const values = new Uint32Array(1);
    do {
      crypto.getRandomValues(values);
    } while (values[0]! >= rejectionFloor);
    return values[0]! % exclusiveMaximum;
  }

  shuffle<Value>(values: readonly Value[]): readonly Value[] {
    const result = [...values];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const target = this.randomInt(index + 1);
      [result[index], result[target]] = [result[target]!, result[index]!];
    }
    return result;
  }
}
