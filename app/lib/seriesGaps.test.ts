import { describe, expect, it } from 'vitest';

import { seriesGaps } from './seriesGaps';

describe('seriesGaps', () => {
  it('lists the whole parts missing up to the highest known one', () => {
    expect(seriesGaps([1, 2, 5, 3])).toEqual([4]);
    expect(seriesGaps([3])).toEqual([1, 2]);
    expect(seriesGaps([1, 2, 3])).toEqual([]);
  });

  it('never lists a part after the highest known one', () => {
    expect(seriesGaps([1, 2])).toEqual([]);
  });

  it('counts neither a part 2.5 nor a book without a part', () => {
    expect(seriesGaps([1, 2.5, 3, null])).toEqual([2]);
    expect(seriesGaps([1, 2, 2.5])).toEqual([]);
    expect(seriesGaps([null, null])).toEqual([]);
    expect(seriesGaps([])).toEqual([]);
  });
});
