// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';

import { isTextEntry } from './text-entry.js';

const input = (type: string): HTMLInputElement => {
  const element = document.createElement('input');
  element.type = type;
  return element;
};

describe('where typed text goes', () => {
  it('is a text field, a text area or an editable region', () => {
    expect(isTextEntry(input('text'))).toBe(true);
    expect(isTextEntry(input('url'))).toBe(true);
    expect(isTextEntry(input('search'))).toBe(true);
    expect(isTextEntry(document.createElement('textarea'))).toBe(true);
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    expect(isTextEntry(editable)).toBe(true);
  });

  it('is not a radio, a checkbox, a button or the page', () => {
    expect(isTextEntry(input('radio'))).toBe(false);
    expect(isTextEntry(input('checkbox'))).toBe(false);
    expect(isTextEntry(input('file'))).toBe(false);
    expect(isTextEntry(document.createElement('button'))).toBe(false);
    expect(isTextEntry(document.body)).toBe(false);
    expect(isTextEntry(null)).toBe(false);
  });
});
