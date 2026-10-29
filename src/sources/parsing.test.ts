import { describe, expect, it } from 'vitest';

import { cleanText, isbnFrom, parseCount, parsePrice } from './parsing.js';

describe('parsePrice', () => {
  it.each([
    ['139 kr', 139],
    ['1 299 kr', 1299],
    ['1 299,50 kr', 1299.5],
    ['16,60 €', 16.6],
    ['7.30 €', 7.3],
  ])('reads %j as %d', (text, expected) => {
    expect(parsePrice(text)).toBe(expected);
  });

  it('returns null when there is no number', () => {
    expect(parsePrice('Slutsåld')).toBeNull();
  });
});

describe('parseCount', () => {
  it('reads counts with thousand separators', () => {
    expect(parseCount('1 204 osumaa')).toBe(1204);
    expect(parseCount('27 produkter')).toBe(27);
  });
});

describe('cleanText', () => {
  it('collapses all whitespace, including non-breaking spaces', () => {
    expect(cleanText('  Viveca  \n Sten ')).toBe('Viveca Sten');
  });
});

describe('isbnFrom', () => {
  it('finds an ISBN-13 in either store URL shape', () => {
    expect(isbnFrom('/bok/9789137138466/i-stundens-hetta')).toBe('9789137138466');
    expect(isbnFrom('/fi/kirja/hotelli-tulagi-9789525701616')).toBe('9789525701616');
  });

  it('ignores numbers that are not ISBN-13s', () => {
    expect(isbnFrom('/bok/12345/x')).toBeNull();
    expect(isbnFrom('/fi/kirja/x-97895257016161')).toBeNull();
    expect(isbnFrom(undefined)).toBeNull();
  });
});
