import { describe, expect, it } from 'vitest';

import {
  chordCandidates,
  chordFromInput,
  chordHint,
  chordKeycaps,
  chordText,
  parseChord,
  type KeyInput,
} from './chords.js';

const press = (
  key: string,
  code: string,
  modifiers: Partial<
    Pick<KeyInput, 'altKey' | 'ctrlKey' | 'shiftKey' | 'metaKey'>
  > = {}
): KeyInput => ({ key, code, altKey: false, ...modifiers });

const texts = (input: KeyInput) => chordCandidates(input).map(chordText);

describe('chords', () => {
  it('reads a press by its character, then by its position', () => {
    expect(texts(press('d', 'KeyD'))).toEqual(['d']);
    // Option+D on a Mac types ∂; by position it is still Alt+D.
    expect(texts(press('∂', 'KeyD', { altKey: true }))).toEqual([
      'alt+∂',
      'alt+d',
    ]);
    // A Cyrillic layout types в on the same key.
    expect(texts(press('в', 'KeyD'))).toEqual(['в', 'd']);
    // AZERTY's A sits where QWERTY's Q does: the letter wins.
    expect(texts(press('a', 'KeyQ'))).toEqual(['a', 'q']);
  });

  it('lets a symbol carry the Shift that typed it', () => {
    expect(texts(press('?', 'Slash', { shiftKey: true }))).toEqual([
      '?',
      'shift+/',
    ]);
    expect(texts(press('!', 'Digit1', { shiftKey: true }))).toEqual([
      '!',
      'shift+1',
    ]);
    // Letters keep it: Shift+G is not G.
    expect(texts(press('G', 'KeyG', { shiftKey: true }))).toEqual(['shift+g']);
  });

  it('names special keys', () => {
    expect(texts(press(' ', 'Space'))).toEqual(['space']);
    expect(texts(press('ArrowDown', 'ArrowDown', { altKey: true }))).toEqual([
      'alt+arrowdown',
    ]);
    expect(texts(press('Enter', 'NumpadEnter'))).toEqual(['enter']);
    expect(texts(press('+', 'Equal', { shiftKey: true }))).toEqual([
      'plus',
      'shift+=',
    ]);
    expect(texts(press('Dead', 'BracketLeft'))).toEqual(['[']);
  });

  it('records what the player means while choosing a key', () => {
    expect(
      chordFromInput(press('Shift', 'ShiftLeft', { shiftKey: true }))
    ).toBeNull();
    expect(chordText(chordFromInput(press('x', 'KeyX'))!)).toBe('x');
    expect(
      chordText(chordFromInput(press('∂', 'KeyD', { altKey: true }))!)
    ).toBe('alt+d');
    expect(chordText(chordFromInput(press('в', 'KeyD'))!)).toBe('d');
    expect(
      chordText(chordFromInput(press('?', 'Slash', { shiftKey: true }))!)
    ).toBe('?');
    expect(
      chordText(
        chordFromInput(press('K', 'KeyK', { ctrlKey: true, shiftKey: true }))!
      )
    ).toBe('ctrl+shift+k');
  });

  it('round-trips canonical text and rejects anything else', () => {
    for (const text of ['d', 'alt+d', 'ctrl+alt+shift+meta+f5', '?', 'plus']) {
      expect(chordText(parseChord(text)!)).toBe(text);
    }
    for (const text of [
      '',
      'alt+',
      'hyper+d',
      'alt+alt+d',
      'shift+notakey',
      7,
    ]) {
      expect(parseChord(text)).toBeNull();
    }
  });

  it('draws keycaps and hints for each platform', () => {
    const chord = parseChord('ctrl+alt+d')!;
    expect(chordKeycaps(chord, 'other')).toEqual(['Ctrl', 'Alt', 'D']);
    expect(chordKeycaps(chord, 'mac')).toEqual(['⌃ Control', '⌥ Option', 'D']);
    expect(chordHint(chord, 'other')).toBe('Ctrl+Alt+D');
    expect(chordHint(chord, 'mac')).toBe('⌃⌥D');
    expect(chordHint(parseChord('arrowup')!, 'other')).toBe('↑');
  });
});
