import { describe, expect, it } from 'vitest';

import {
  describeSeries,
  parseAdlibrisSeriesLabel,
  parseBokusSeriesLabel,
  seriesAuthorKey,
  seriesNameKey,
} from './series.js';

describe('parseBokusSeriesLabel', () => {
  it('reads the part and the name', () => {
    expect(parseBokusSeriesLabel('Del 7 - Åremorden')).toEqual({ name: 'Åremorden', part: 7 });
    expect(parseBokusSeriesLabel('Del 11 - Morden i Sandhamn')).toEqual({
      name: 'Morden i Sandhamn',
      part: 11,
    });
  });

  it('reads a fractional part, and tolerates an en dash and extra whitespace', () => {
    expect(parseBokusSeriesLabel('Del 2.5 - Havsfolket')).toEqual({
      name: 'Havsfolket',
      part: 2.5,
    });
    expect(parseBokusSeriesLabel('  Del 3,5 –  Dunne ')).toEqual({ name: 'Dunne', part: 3.5 });
  });

  it('takes any other label as a name without a part', () => {
    expect(parseBokusSeriesLabel('Johnny & Co')).toEqual({ name: 'Johnny & Co', part: null });
  });

  it('gives nothing for an empty label', () => {
    expect(parseBokusSeriesLabel('  ')).toBeNull();
  });
});

describe('parseAdlibrisSeriesLabel', () => {
  it('reads the name and the part', () => {
    expect(parseAdlibrisSeriesLabel('Hildur-serien (osa 01)')).toEqual({
      name: 'Hildur-serien',
      part: 1,
    });
    expect(parseAdlibrisSeriesLabel('Sarja:Hildur-serien (osa 05)')).toEqual({
      name: 'Hildur-serien',
      part: 5,
    });
  });

  it('takes a line without a part as a name without a part', () => {
    expect(parseAdlibrisSeriesLabel('Sarja: Hildur-serien')).toEqual({
      name: 'Hildur-serien',
      part: null,
    });
  });

  it('gives nothing for an empty line', () => {
    expect(parseAdlibrisSeriesLabel('Sarja: ')).toBeNull();
  });
});

describe('seriesNameKey', () => {
  it('gives both stores’ names of one series the same key', () => {
    expect(seriesNameKey('Hildur-serien')).toBe('hildur');
    expect(seriesNameKey('Hildur')).toBe('hildur');
    expect(seriesNameKey('Hildur serien')).toBe('hildur');
    expect(seriesNameKey('Hildur-sarja')).toBe('hildur');
  });

  it('ignores case, diacritics and punctuation', () => {
    expect(seriesNameKey('Åremorden')).toBe(seriesNameKey('aremorden'));
    expect(seriesNameKey('Johnny & Co')).toBe('johnny co');
  });

  it('keeps a name that is only the word "serien"', () => {
    expect(seriesNameKey('Serien')).toBe('serien');
  });

  it('keeps the word within a name', () => {
    expect(seriesNameKey('Krimiserien')).toBe('krimiserien');
  });
});

describe('seriesAuthorKey', () => {
  it('uses the first author, normalized like a listener author', () => {
    expect(seriesAuthorKey(['Rämö, Satu', 'Someone Else'])).toBe('satu ramo');
  });

  it('keeps the same series name by two authors apart', () => {
    const first = [seriesAuthorKey(['Satu Rämö']), seriesNameKey('Hildur')];
    const second = [seriesAuthorKey(['Viveca Sten']), seriesNameKey('Hildur')];
    expect(first).not.toEqual(second);
  });

  it('gives nothing without an author', () => {
    expect(seriesAuthorKey([])).toBeNull();
    expect(seriesAuthorKey([' '])).toBeNull();
  });
});

describe('describeSeries', () => {
  it('gives the name and the part when there is one', () => {
    expect(describeSeries({ name: 'Hildur-serien', part: 1 })).toBe('Hildur-serien, part 1');
    expect(describeSeries({ name: 'Hildur-serien', part: 2.5 })).toBe('Hildur-serien, part 2.5');
    expect(describeSeries({ name: 'Hildur-serien', part: null })).toBe('Hildur-serien');
  });
});
