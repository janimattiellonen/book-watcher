import { describe, expect, it } from 'vitest';

import { parseListenerForm } from './listenerSchema';

function form(fields: Record<string, string | string[]>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    for (const item of Array.isArray(value) ? value : [value]) formData.append(key, item);
  }
  return formData;
}

const valid = {
  name: ' Viveca Sten ',
  author: 'Viveca Sten',
  language: 'sv',
  format: 'ebook',
  minPriceEur: '',
  maxPriceEur: '9,90',
  sources: ['adlibris', 'bokus'],
  enabled: 'on',
};

describe('parseListenerForm', () => {
  it('turns a valid form into a listener', () => {
    expect(parseListenerForm(form(valid))).toEqual({
      ok: true,
      input: {
        name: 'Viveca Sten',
        author: 'Viveca Sten',
        language: 'sv',
        format: 'ebook',
        minPriceEur: null,
        maxPriceEur: 9.9,
        sources: ['adlibris', 'bokus'],
        enabled: true,
      },
    });
  });

  it('reads an unchecked enabled box as disabled', () => {
    const { enabled: _, ...fields } = valid;
    const result = parseListenerForm(form(fields));
    expect(result.ok && result.input.enabled).toBe(false);
  });

  it('rejects an empty author', () => {
    const result = parseListenerForm(form({ ...valid, author: '   ' }));
    expect(result).toMatchObject({ ok: false, errors: { author: 'Author is required' } });
  });

  it('rejects a minimum above the maximum', () => {
    const result = parseListenerForm(form({ ...valid, minPriceEur: '10', maxPriceEur: '5' }));
    expect(result).toMatchObject({
      ok: false,
      errors: { maxPriceEur: 'The maximum price must be at least the minimum' },
    });
  });

  it('rejects a listener without sources', () => {
    const { sources: _, ...fields } = valid;
    const result = parseListenerForm(form(fields));
    expect(result).toMatchObject({ ok: false, errors: { sources: 'Choose at least one source' } });
  });

  it('rejects prices the database column cannot hold or that are not plain decimals', () => {
    for (const bad of ['100000000', '1e9', '0x10', '4.999']) {
      const result = parseListenerForm(form({ ...valid, maxPriceEur: bad }));
      expect(result.ok).toBe(false);
    }
    expect(parseListenerForm(form({ ...valid, maxPriceEur: '99999999.99' })).ok).toBe(true);
  });

  it('rejects negative and non-numeric prices', () => {
    const result = parseListenerForm(form({ ...valid, minPriceEur: '-1', maxPriceEur: 'cheap' }));
    expect(result).toMatchObject({
      ok: false,
      errors: {
        minPriceEur: 'The price cannot be negative',
        maxPriceEur: 'Enter a price in euros, such as 4.99',
      },
    });
  });

  it('rejects an unknown language, format or source', () => {
    const result = parseListenerForm(
      form({ ...valid, language: 'de', format: 'audiobook', sources: ['amazon'] }),
    );
    expect(result).toMatchObject({
      ok: false,
      errors: {
        language: 'Choose a language',
        format: 'Choose a format',
        sources: 'Unknown source',
      },
    });
  });

  it('gives back what was typed, so the form can show it again', () => {
    const result = parseListenerForm(form({ ...valid, author: '', maxPriceEur: '9,90' }));
    expect(result).toMatchObject({
      ok: false,
      values: { author: '', maxPriceEur: '9,90', sources: ['adlibris', 'bokus'], enabled: true },
    });
  });
});
